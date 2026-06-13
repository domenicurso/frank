import { client } from "@/client";
import { estimateTypingMs } from "@/frank/burst";
import { createBurstPlanStream } from "@/frank/character";
import { frankDebug } from "@/frank/debug";
import {
  shouldLogPartialPlan,
  summarizeBurstPlan,
  summarizePartialPlan,
} from "@/frank/debugView";
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
};

const activeExecutions = new Map<string, ActiveExecution>();

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

export function interruptChannelExecution(
  channelId: string,
  reason: InvalidationReason,
) {
  const active = activeExecutions.get(channelId);
  if (!active) return false;

  active.controller.abort(reason);
  return true;
}

export async function executeStreamedBurstPlan(options: {
  snapshot: ResponseSnapshot;
  typingStartedAt: string;
  maxBurstMessages: number;
  reactionsEnabled: boolean;
}) {
  const channel =
    (await client.channels.fetch(options.snapshot.channelId).catch(() => null)) ??
    client.channels.cache.get(options.snapshot.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${options.snapshot.channelId} is not available`);
  }
  const textChannel = channel as unknown as SendableDiscordChannel;

  const controller = new AbortController();
  activeExecutions.set(options.snapshot.channelId, {
    snapshot: options.snapshot,
    controller,
  });

  const signal = controller.signal;
  const typingStartedAt = new Date(options.typingStartedAt).getTime();
  const streamStartedAt =
    Number.isFinite(typingStartedAt) && typingStartedAt > 0
      ? typingStartedAt
      : Date.now();
  const sentMessageIds: string[] = [];
  const sentMessages: Array<{ id: string; text: string; createdAt: string }> = [];
  const chunkStartedAt = new Map<number, number>();
  const finalizedChunkIndexes = new Set<number>();
  let latestPlan: BurstPlan = { chunks: [], reactionEmoji: null };
  let lastLoggedPlan: BurstPlan = { chunks: [], reactionEmoji: null };
  let lastLoggedChunkLength = 0;
  let sendChain = Promise.resolve();

  try {
    frankDebug("executor", "streamed_burst.input", {
      snapshotId: options.snapshot.id,
      channelId: options.snapshot.channelId,
      anchorMessageId: options.snapshot.anchorMessageId,
      typingStartedAt: options.typingStartedAt,
      maxBurstMessages: options.maxBurstMessages,
      reactionsEnabled: options.reactionsEnabled,
    });

    const stream = createBurstPlanStream(
      options.snapshot,
      options.maxBurstMessages,
    );
    void sendChannelTyping(options.snapshot.channelId).catch(() => undefined);

    for await (const partial of stream.partialObjectStream) {
      if (signal.aborted) {
        break;
      }

      latestPlan = coercePartialBurstPlan(partial, options.maxBurstMessages);
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
          void sendChannelTyping(options.snapshot.channelId).catch(() => undefined);
        }
      }

      for (let index = 0; index < latestPlan.chunks.length - 1; index += 1) {
        const current = latestPlan.chunks[index];
        const next = latestPlan.chunks[index + 1];
        if (!current?.text || !next?.text || finalizedChunkIndexes.has(index)) {
          continue;
        }

        finalizedChunkIndexes.add(index);
        sendChain = sendChain.then(async () => {
          if (signal.aborted) return;
          await sendChunkWhenTypingBudgetMet({
            chunk: current,
            startedAt: chunkStartedAt.get(index) ?? Date.now(),
            isFirst: sentMessageIds.length === 0,
            snapshot: options.snapshot,
            textChannel,
            sentMessageIds,
            sentMessages,
            signal,
          });
        });
      }
    }

    latestPlan = await stream.finalPlan;
    frankDebug("executor", "streamed_burst.final_plan", {
      snapshotId: options.snapshot.id,
      plan: summarizeBurstPlan(latestPlan),
    });
    if (!options.reactionsEnabled) {
      latestPlan.reactionEmoji = null;
    }

    for (let index = 0; index < latestPlan.chunks.length; index += 1) {
      const chunk = latestPlan.chunks[index];
      if (!chunk || finalizedChunkIndexes.has(index)) continue;

      finalizedChunkIndexes.add(index);
      sendChain = sendChain.then(async () => {
        if (signal.aborted) return;
        await sendChunkWhenTypingBudgetMet({
          chunk,
          startedAt: chunkStartedAt.get(index) ?? Date.now(),
          isFirst: sentMessageIds.length === 0,
          snapshot: options.snapshot,
          textChannel,
          sentMessageIds,
          sentMessages,
          signal,
        });
      });
    }

    await sendChain;

    if (!signal.aborted && latestPlan.reactionEmoji && options.snapshot.anchorMessageId) {
      try {
        const anchor = await textChannel.messages.fetch(options.snapshot.anchorMessageId);
        await anchor.react(latestPlan.reactionEmoji);
      } catch (error) {
        console.error("[Frank] Failed to react:", error);
      }
    }

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
      aborted: signal.aborted,
      reason: signal.reason as InvalidationReason | undefined,
    };
    frankDebug("executor", "streamed_burst.output", {
      aborted: result.aborted,
      reason: result.reason,
      plan: summarizeBurstPlan(result.plan),
      sentMessageIds: result.sentMessageIds,
      sentMessages: result.sentMessages.map((message) => message.text),
    });
    return result;
  } finally {
    activeExecutions.delete(options.snapshot.channelId);
  }
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
    chunks?: Array<{ text?: string; pauseMs?: number }>;
    reactionEmoji?: string | null;
  };

  const chunks = (source.chunks ?? [])
    .map((chunk) => ({
      text: (chunk?.text ?? "").trim().slice(0, 1_900),
      pauseMs:
        typeof chunk?.pauseMs === "number"
          ? Math.max(0, Math.min(4_000, Math.round(chunk.pauseMs)))
          : undefined,
    }))
    .filter((chunk) => chunk.text.length > 0)
    .slice(0, maxBurstMessages);

  return {
    chunks,
    reactionEmoji: source.reactionEmoji ?? null,
  };
}

async function sendChunkWhenTypingBudgetMet(options: {
  chunk: { text: string; pauseMs?: number };
  startedAt: number;
  isFirst: boolean;
  snapshot: ResponseSnapshot;
  textChannel: SendableDiscordChannel;
  sentMessageIds: string[];
  sentMessages: Array<{ id: string; text: string; createdAt: string }>;
  signal: AbortSignal;
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

  if (remainder > 0) {
    await wait(remainder, options.signal);
  }

  const sent =
    options.isFirst && options.snapshot.anchorMessageId
      ? await sendReply(
          options.textChannel as unknown as TextChannel,
          options.snapshot.anchorMessageId,
          options.chunk.text,
        )
      : await options.textChannel.send({ content: options.chunk.text });

  options.sentMessageIds.push(sent.id);
  options.sentMessages.push({
    id: sent.id,
    text: options.chunk.text,
    createdAt: sent.createdAt.toISOString(),
  });

  frankDebug("executor", "chunk_sent", {
    messageId: sent.id,
    text: options.chunk.text,
    createdAt: sent.createdAt.toISOString(),
  });

  if (options.chunk.pauseMs) {
    await wait(options.chunk.pauseMs, options.signal);
  }
}
