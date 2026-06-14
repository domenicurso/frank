import { client } from "@/client";
import { estimateTypingMs } from "@/frank/burst";
import { createBurstPlanStream } from "@/frank/character";
import {
  FRANK_CHARACTER_FIRST_CHUNK_IDLE_TIMEOUT_MS,
  FRANK_CHARACTER_STREAM_IDLE_TIMEOUT_MS,
  FRANK_CHARACTER_TIMEOUT_MS,
  FRANK_STREAM_FLUSH_POLL_MS,
  FRANK_TYPING_INDICATOR_START_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import {
  shouldLogPartialPlan,
  summarizeBurstPlan,
  summarizePartialPlan,
} from "@/frank/debugView";
import {
  isAbortLikeError,
  normalizeExecutionAbortReason,
  shouldFinalizeBurstChunk,
} from "@/frank/executionPolicy";
import { toDiscordContent } from "@/frank/messageContext";
import { appendFrankEvent } from "@/frank/store";
import type {
  BurstPlan,
  InvalidationReason,
  ResponseSnapshot,
  SystemEvent,
} from "@/frank/types";
import type { Message, TextChannel } from "discord.js";

type SendableDiscordChannel = {
  sendTyping: () => Promise<void>;
  send: (options: { content: string }) => Promise<Message>;
  messages: {
    fetch: (messageId: string) => Promise<Message>;
  };
};

type ActiveExecution = {
  snapshot: ResponseSnapshot;
  controller: AbortController;
  sentMessageCount: number;
  laneKey: string;
  turnId: string;
  channelId: string;
};

const activeExecutions = new Map<string, ActiveExecution>();
const RECENT_ANCHOR_REPLY_DISTANCE = 3;

export async function sendChannelTyping(channelId: string) {
  const channel =
    (await client.channels.fetch(channelId).catch(() => null)) ??
    client.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) {
    return false;
  }

  await (channel as unknown as SendableDiscordChannel).sendTyping();
  return true;
}

export function interruptLaneExecution(
  laneKey: string,
  reason: InvalidationReason,
) {
  const active = activeExecutions.get(laneKey);
  if (!active) return false;

  active.controller.abort(reason);
  return true;
}

export function hasPendingUnsentExecution(laneKey: string) {
  const active = activeExecutions.get(laneKey);
  if (!active) return false;
  return active.sentMessageCount === 0;
}

export function hasActiveExecution(laneKey: string) {
  return activeExecutions.has(laneKey);
}

export function getActiveExecutionState(laneKey: string) {
  const active = activeExecutions.get(laneKey);
  if (!active) {
    return null;
  }

  return {
    laneKey: active.laneKey,
    turnId: active.turnId,
    channelId: active.channelId,
    sentMessageCount: active.sentMessageCount,
    snapshotId: active.snapshot.id,
  };
}

export async function abortAllActiveExecutions(reason: InvalidationReason) {
  for (const [laneKey, active] of activeExecutions.entries()) {
    frankDebug("executor", "abort_all", {
      laneKey,
      channelId: active.channelId,
      snapshotId: active.snapshot.id,
      reason,
    });
    active.controller.abort(reason);
  }
}

export function getPendingUnsentExecutionSnapshotId(laneKey: string) {
  const active = activeExecutions.get(laneKey);
  if (!active || active.sentMessageCount > 0) {
    return null;
  }

  return active.snapshot.id;
}

export function getPendingUnsentExecutionContext(laneKey: string) {
  const active = activeExecutions.get(laneKey);
  if (!active || active.sentMessageCount > 0) {
    return null;
  }

  const latestVisibleMessage =
    active.snapshot.visibleMessages[active.snapshot.visibleMessages.length - 1] ?? null;

  return {
    snapshotId: active.snapshot.id,
    latestAuthorId: latestVisibleMessage?.authorId ?? null,
    anchorMessageId: active.snapshot.anchorMessageId,
  };
}

export async function executeStreamedBurstPlan(options: {
  snapshot: ResponseSnapshot;
  laneKey: string;
  turnId: string;
  typingStartedAt: string;
  maxBurstMessages: number;
  reactionsEnabled: boolean;
  abortSignal?: AbortSignal;
  beforeSendChunk?: (options: {
    chunk: { text: string; pauseMs?: number };
    isFirst: boolean;
    sentMessageCount: number;
  }) => Promise<void>;
}) {
  const channel =
    (await client.channels.fetch(options.snapshot.channelId).catch(() => null)) ??
    client.channels.cache.get(options.snapshot.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${options.snapshot.channelId} is not available`);
  }
  const textChannel = channel as unknown as SendableDiscordChannel;

  const controller = new AbortController();
  activeExecutions.set(options.laneKey, {
    snapshot: options.snapshot,
    controller,
    sentMessageCount: 0,
    laneKey: options.laneKey,
    turnId: options.turnId,
    channelId: options.snapshot.channelId,
  });

  const signal = AbortSignal.any([
    controller.signal,
    ...(options.abortSignal ? [options.abortSignal] : []),
  ]);
  const streamAbortSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(FRANK_CHARACTER_TIMEOUT_MS),
  ]);
  const typingStartedAt = new Date(options.typingStartedAt).getTime();
  const streamStartedAt =
    Number.isFinite(typingStartedAt) && typingStartedAt > 0
      ? typingStartedAt
      : Date.now();
  const sentMessageIds: string[] = [];
  const sentMessages: Array<{ id: string; text: string; createdAt: string }> = [];
  const chunkStartedAt = new Map<number, number>();
  const chunkUpdatedAt = new Map<number, number>();
  const finalizedChunkIndexes = new Set<number>();
  let latestPlan: BurstPlan = { chunks: [], reactionEmoji: null };
  let lastLoggedPlan: BurstPlan = { chunks: [], reactionEmoji: null };
  let lastLoggedChunkLength = 0;
  let sendChain = Promise.resolve();
  let finalPlanResolved = false;
  let typingIndicatorShown = false;
  let fullyDelivered = false;
  let streamIdleTimer: NodeJS.Timeout | null = null;

  const maybeShowTypingIndicator = (reason: "startup_delay" | "first_chunk") => {
    if (typingIndicatorShown || signal.aborted) {
      return;
    }

    typingIndicatorShown = true;
    frankDebug("executor", "typing_indicator", {
      channelId: options.snapshot.channelId,
      reason,
      snapshotId: options.snapshot.id,
    });
    void sendChannelTyping(options.snapshot.channelId).catch(() => undefined);
  };

  const clearStreamIdleTimer = () => {
    if (!streamIdleTimer) {
      return;
    }

    clearTimeout(streamIdleTimer);
    streamIdleTimer = null;
  };

  const armStreamIdleTimer = (phase: "awaiting_first_chunk" | "awaiting_next_chunk") => {
    clearStreamIdleTimer();
    const timeoutMs =
      phase === "awaiting_first_chunk"
        ? FRANK_CHARACTER_FIRST_CHUNK_IDLE_TIMEOUT_MS
        : FRANK_CHARACTER_STREAM_IDLE_TIMEOUT_MS;
    streamIdleTimer = setTimeout(() => {
      if (signal.aborted) {
        return;
      }

      frankDebug("executor", "streamed_burst.stalled", {
        channelId: options.snapshot.channelId,
        laneKey: options.laneKey,
        phase,
        snapshotId: options.snapshot.id,
        sentMessageCount: sentMessageIds.length,
        partialChunkCount: latestPlan.chunks.length,
      });
      controller.abort("worker_timeout");
    }, timeoutMs);
  };

  const queueChunkSend = (index: number, chunk: BurstPlan["chunks"][number]) => {
    finalizedChunkIndexes.add(index);
    const queuedChunk = { ...chunk };
    sendChain = sendChain.then(async () => {
      if (signal.aborted) return;
      const isFirst = sentMessageIds.length === 0;
      await sendChunkWhenTypingBudgetMet({
        chunk: queuedChunk,
        startedAt: resolveChunkTypingStartedAt({
          isFirst,
          firstChunkStartedAt: chunkStartedAt.get(index) ?? null,
          streamStartedAt,
          now: Date.now(),
        }),
        isFirst,
        laneKey: options.laneKey,
        snapshot: options.snapshot,
        textChannel,
        sentMessageIds,
        sentMessages,
        signal,
        beforeSendChunk: options.beforeSendChunk,
      });
    });
  };

  const flushReadyChunks = (force = false) => {
    const now = Date.now();
    for (let index = 0; index < latestPlan.chunks.length; index += 1) {
      if (finalizedChunkIndexes.has(index)) {
        continue;
      }

      const current = latestPlan.chunks[index];
      if (!current?.text) {
        break;
      }

      const stableForMs = force
        ? Number.MAX_SAFE_INTEGER
        : now - (chunkUpdatedAt.get(index) ?? chunkStartedAt.get(index) ?? now);

      if (
        !shouldFinalizeBurstChunk({
          chunkText: current.text,
          nextChunkText: latestPlan.chunks[index + 1]?.text,
          stableForMs,
          finalPlanResolved,
        })
      ) {
        break;
      }

      queueChunkSend(index, current);
    }
  };

  const flushTimer = setInterval(() => {
    if (!signal.aborted) {
      flushReadyChunks();
    }
  }, FRANK_STREAM_FLUSH_POLL_MS);

  const typingIndicatorDelayMs = Math.max(
    0,
    FRANK_TYPING_INDICATOR_START_MS - (Date.now() - streamStartedAt),
  );
  const typingIndicatorTimer = setTimeout(() => {
    maybeShowTypingIndicator("startup_delay");
  }, typingIndicatorDelayMs);

  try {
    frankDebug("executor", "streamed_burst.input", {
      snapshotId: options.snapshot.id,
      channelId: options.snapshot.channelId,
      laneKey: options.laneKey,
      anchorMessageId: options.snapshot.anchorMessageId,
      typingStartedAt: options.typingStartedAt,
      maxBurstMessages: options.maxBurstMessages,
      reactionsEnabled: options.reactionsEnabled,
    });

    const stream = createBurstPlanStream(
      options.snapshot,
      options.maxBurstMessages,
      { abortSignal: streamAbortSignal },
    );
    const finalPlanPromise = stream.finalPlan.catch((error) => {
      if (
        signal.aborted ||
        options.abortSignal?.aborted ||
        streamAbortSignal.aborted ||
        isAbortLikeError(error)
      ) {
        return latestPlan;
      }

      throw error;
    });

    armStreamIdleTimer("awaiting_first_chunk");
    await raceWithAbortSignal(
      (async () => {
        for await (const partial of stream.partialObjectStream) {
          if (signal.aborted) {
            break;
          }

          const previousPlan = latestPlan;
          latestPlan = coercePartialBurstPlan(partial, options.maxBurstMessages);
          armStreamIdleTimer(
            latestPlan.chunks.length > 0 ? "awaiting_next_chunk" : "awaiting_first_chunk",
          );
          const partialLogState = shouldLogPartialPlan(
            lastLoggedPlan,
            latestPlan,
            lastLoggedChunkLength,
          );
          if (partialLogState.shouldLog) {
            frankDebug("executor", "streamed_burst.partial", {
              snapshotId: options.snapshot.id,
              plan: summarizePartialPlan(latestPlan),
            });
            lastLoggedPlan = {
              chunks: latestPlan.chunks.map((chunk) => ({ ...chunk })),
              reactionEmoji: latestPlan.reactionEmoji,
            };
            lastLoggedChunkLength = partialLogState.nextLoggedLength;
          }

          for (let index = 0; index < latestPlan.chunks.length; index += 1) {
            const chunk = latestPlan.chunks[index];
            if (!chunk || !chunk.text) continue;

            if (!chunkStartedAt.has(index)) {
              chunkStartedAt.set(index, index === 0 ? streamStartedAt : Date.now());
              maybeShowTypingIndicator("first_chunk");
            }

            const previousText = previousPlan.chunks[index]?.text ?? "";
            if (previousText !== chunk.text || !chunkUpdatedAt.has(index)) {
              chunkUpdatedAt.set(index, Date.now());
            }
          }

          flushReadyChunks();
        }
      })(),
      streamAbortSignal,
    );

    armStreamIdleTimer(
      latestPlan.chunks.length > 0 ? "awaiting_next_chunk" : "awaiting_first_chunk",
    );
    latestPlan = await raceWithAbortSignal(finalPlanPromise, streamAbortSignal);
    clearStreamIdleTimer();
    finalPlanResolved = true;
    frankDebug("executor", "streamed_burst.final_plan", {
      snapshotId: options.snapshot.id,
      plan: summarizeBurstPlan(latestPlan),
    });
    if (!options.reactionsEnabled) {
      latestPlan.reactionEmoji = null;
    }

    if (!signal.aborted && latestPlan.reactionEmoji && options.snapshot.anchorMessageId) {
      try {
        const anchor = await textChannel.messages.fetch(options.snapshot.anchorMessageId);
        await anchor.react(latestPlan.reactionEmoji);
      } catch (error) {
        console.error("[Frank] Failed to react:", error);
      }
    }

    flushReadyChunks(true);

    await sendChain;
    fullyDelivered =
      latestPlan.chunks.length > 0 &&
      sentMessageIds.length >= latestPlan.chunks.length;

    if (!signal.aborted) {
      const event: SystemEvent = {
        type: "burst_sent",
        eventKey: `burst_sent:${options.snapshot.id}`,
        channelId: options.snapshot.channelId,
        snapshotId: options.snapshot.id,
        messageIds: sentMessageIds,
        createdAt: new Date().toISOString(),
      };
      await appendFrankEvent(event);
    }

    const result = {
      plan: latestPlan,
      sentMessageIds,
      sentMessages,
      aborted: signal.aborted && !fullyDelivered,
      reason:
        signal.aborted && !fullyDelivered
          ? normalizeExecutionAbortReason(signal.reason)
          : undefined,
    };
    frankDebug("executor", "streamed_burst.output", {
      aborted: result.aborted,
      reason: result.reason,
      plan: summarizeBurstPlan(result.plan),
      sentMessageIds: result.sentMessageIds,
      sentMessages: result.sentMessages.map((message) => message.text),
    });
    return result;
  } catch (error) {
    const interrupted =
      signal.aborted ||
      options.abortSignal?.aborted ||
      streamAbortSignal.aborted ||
      isAbortLikeError(error);

    if (!interrupted) {
      throw error;
    }

    await sendChain.catch((sendError) => {
      if (!isAbortLikeError(sendError)) {
        throw sendError;
      }
    });

    const result = {
      plan: latestPlan,
      sentMessageIds,
      sentMessages,
      aborted: !fullyDelivered,
      reason: fullyDelivered
        ? undefined
        : normalizeExecutionAbortReason(
            signal.reason ??
              options.abortSignal?.reason ??
              streamAbortSignal.reason ??
              error,
          ),
    };
    frankDebug("executor", "streamed_burst.aborted", {
      aborted: result.aborted,
      reason: result.reason,
      plan: summarizeBurstPlan(result.plan),
      sentMessageIds: result.sentMessageIds,
      sentMessages: result.sentMessages.map((message) => message.text),
    });
    return result;
  } finally {
    clearStreamIdleTimer();
    clearInterval(flushTimer);
    clearTimeout(typingIndicatorTimer);
    activeExecutions.delete(options.laneKey);
  }
}

function raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("aborted"));
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason ?? new Error("aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

async function sendReply(
  channel: TextChannel,
  anchorMessageId: string,
  content: string,
) {
  const anchor = await channel.messages.fetch(anchorMessageId).catch(() => null);
  if (!anchor) {
    return channel.send({ content });
  }

  return anchor.reply({ content });
}

export function shouldSendAsReply(snapshot: ResponseSnapshot) {
  if (!snapshot.anchorMessageId) {
    return false;
  }

  const anchorIndex = snapshot.visibleMessages.findIndex(
    (message) => message.id === snapshot.anchorMessageId,
  );
  if (anchorIndex < 0) {
    return true;
  }

  return snapshot.visibleMessages.length - anchorIndex > RECENT_ANCHOR_REPLY_DISTANCE;
}

export function resolveChunkTypingStartedAt(options: {
  isFirst: boolean;
  firstChunkStartedAt: number | null;
  streamStartedAt: number;
  now: number;
}) {
  if (options.isFirst) {
    return options.firstChunkStartedAt ?? options.streamStartedAt;
  }

  return options.now;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error(String(signal.reason || "aborted")));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function coercePartialBurstPlan(partial: unknown, maxBurstMessages: number): BurstPlan {
  if (!partial || typeof partial !== "object") {
    return { chunks: [], reactionEmoji: null };
  }

  const source = partial as {
    chunks?: Array<{ text?: string }>;
    reactionEmoji?: string | null;
  };

  const chunks = (source.chunks ?? [])
    .map((chunk) => ({
      text: (chunk?.text ?? "").trim().slice(0, 1_900),
    }))
    .filter((chunk) => chunk.text.length > 0)
    .slice(0, maxBurstMessages);

  return {
    chunks,
    reactionEmoji: source.reactionEmoji ?? null,
  };
}

async function sendChunkWhenTypingBudgetMet(options: {
  chunk: { text: string };
  startedAt: number;
  isFirst: boolean;
  laneKey: string;
  snapshot: ResponseSnapshot;
  textChannel: SendableDiscordChannel;
  sentMessageIds: string[];
  sentMessages: Array<{ id: string; text: string; createdAt: string }>;
  signal: AbortSignal;
  beforeSendChunk?: (options: {
    chunk: { text: string };
    isFirst: boolean;
    sentMessageCount: number;
  }) => Promise<void>;
}) {
  const typingMs = estimateTypingMs(options.chunk.text);
  const elapsed = Date.now() - options.startedAt;
  const remainder = Math.max(0, typingMs - elapsed);

  frankDebug("executor", "chunk_timing", {
    chunk: options.chunk,
    typingMs,
    elapsed,
    remainder,
    isFirst: options.isFirst,
    anchorMessageId: options.snapshot.anchorMessageId,
  });

  if (!options.isFirst && remainder > 0) {
    frankDebug("executor", "typing_indicator", {
      channelId: options.snapshot.channelId,
      reason: "followup_chunk",
      snapshotId: options.snapshot.id,
    });
    void sendChannelTyping(options.snapshot.channelId).catch(() => undefined);
  }

  if (remainder > 0) {
    await wait(remainder, options.signal);
  }

  if (options.beforeSendChunk) {
    await options.beforeSendChunk({
      chunk: options.chunk,
      isFirst: options.isFirst,
      sentMessageCount: options.sentMessageIds.length,
    });
  }

  if (options.signal.aborted) {
    throw new Error(String(options.signal.reason || "aborted"));
  }

  const discordContent = toDiscordContent(
    options.chunk.text,
    options.snapshot.visibleMessages,
  );

  const sent =
    options.isFirst &&
    options.snapshot.anchorMessageId &&
    shouldSendAsReply(options.snapshot)
      ? await sendReply(
          options.textChannel as unknown as TextChannel,
          options.snapshot.anchorMessageId,
          discordContent,
        )
      : await options.textChannel.send({ content: discordContent });

  options.sentMessageIds.push(sent.id);
  options.sentMessages.push({
    id: sent.id,
    text: options.chunk.text,
    createdAt: sent.createdAt.toISOString(),
  });
  const activeExecution = activeExecutions.get(options.laneKey);
  if (activeExecution) {
    activeExecution.sentMessageCount = options.sentMessageIds.length;
  }

  frankDebug("executor", "chunk_sent", {
    discordContent,
    messageId: sent.id,
    text: options.chunk.text,
    createdAt: sent.createdAt.toISOString(),
  });
}
