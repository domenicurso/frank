import { client } from "@/client";
import {
  FRANK_BACKGROUND_JOB_CLAIM_BATCH,
  FRANK_BACKGROUND_JOB_TIMEOUT_MS,
  FRANK_BURST_SETTLE_MS,
  FRANK_GENERATION_JOB_CLAIM_BATCH,
  FRANK_JOB_POLL_MS,
  FRANK_LIVE_JOB_CLAIM_BATCH,
  FRANK_LIVE_JOB_TIMEOUT_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import {
  summarizeBurstPlan,
  summarizeEvent,
  summarizeRuntime,
  summarizeSnapshot,
} from "@/frank/debugView";
import {
  abortAllActiveExecutions,
  executeStreamedBurstPlan,
  hasActiveExecution,
} from "@/frank/executor";
import {
  isAbortLikeError,
  normalizeExecutionAbortReason,
} from "@/frank/executionPolicy";
import { getFrankGuildSettings } from "@/frank/config";
import { extractMemoryFromChannel } from "@/frank/memory";
import {
  isStaleSettleCandidate,
  shouldClearActiveIntent,
  shouldSkipSettleForActiveIntent,
  toIntentAbortStatus,
} from "@/frank/queuePolicy";
import {
  cancelQueueItemsForIntent,
  claimQueueItems,
  clearChannelActiveIntent,
  completeQueueItem,
  createConversationIntent,
  getChannelControl,
  getConversationIntent,
  getDefaultQueueLeaseMs,
  getQueueItemsForChannel,
  isQueueLeaseCurrent,
  markIntentStatus,
  recordSentBurstOnControl,
  reconcileFrankQueueState,
  requeueExpiredLeases,
  saveChannelControl,
  upsertQueueItem,
} from "@/frank/queueStore";
import { logError } from "@/log";
import {
  applyDiscordEventToRuntime,
  markBurstInterrupted,
  markBurstSent,
} from "@/frank/runtime";
import { buildResponseSnapshot } from "@/frank/snapshot";
import {
  appendFrankEvent,
  getChannelRuntime,
  getFrankEventById,
  saveChannelRuntime,
} from "@/frank/store";
import type {
  DiscordEvent,
  GenerateIntentJob,
  MemoryExtractionJob,
  QueueLease,
  RuntimeUpdateJob,
  SettleChannelJob,
  SystemEvent,
} from "@/frank/types";
import { randomUUID } from "node:crypto";

type QueueWorker = {
  queueName: "runtime_update" | "settle_channel" | "generate_intent" | "memory_extraction";
  lane: "live" | "generation" | "background";
  claimBatch: number;
  timeoutMs: number;
};

type WorkerLane = {
  name: "live" | "generation" | "background";
  workers: QueueWorker[];
};

const QUEUE_WORKERS: Record<QueueWorker["queueName"], QueueWorker> = {
  runtime_update: {
    queueName: "runtime_update",
    lane: "live",
    claimBatch: FRANK_LIVE_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_LIVE_JOB_TIMEOUT_MS,
  },
  settle_channel: {
    queueName: "settle_channel",
    lane: "live",
    claimBatch: FRANK_LIVE_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_LIVE_JOB_TIMEOUT_MS,
  },
  generate_intent: {
    queueName: "generate_intent",
    lane: "generation",
    claimBatch: FRANK_GENERATION_JOB_CLAIM_BATCH,
    timeoutMs: getDefaultQueueLeaseMs("generate_intent"),
  },
  memory_extraction: {
    queueName: "memory_extraction",
    lane: "background",
    claimBatch: FRANK_BACKGROUND_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_BACKGROUND_JOB_TIMEOUT_MS,
  },
};

const WORKER_LANES: WorkerLane[] = [
  {
    name: "live",
    workers: [QUEUE_WORKERS.runtime_update, QUEUE_WORKERS.settle_channel],
  },
  {
    name: "generation",
    workers: [QUEUE_WORKERS.generate_intent],
  },
  {
    name: "background",
    workers: [QUEUE_WORKERS.memory_extraction],
  },
];

const queueIntervals = new Map<string, NodeJS.Timeout>();
const tickingLanes = new Set<string>();
const inflightControllers = new Map<string, AbortController>();
const inflightPromises = new Map<string, Promise<void>>();
let shutdownController: AbortController | null = null;
let shuttingDown = false;

export function startFrankWorker() {
  if (queueIntervals.size > 0) {
    return;
  }

  shuttingDown = false;
  shutdownController = new AbortController();
  void reconcileFrankQueueState().catch((error) => {
    logError("worker", "Failed to reconcile Frank queue state", error);
  });

  for (const lane of WORKER_LANES) {
    queueIntervals.set(
      lane.name,
      setInterval(() => {
        void processFrankLaneOnce(lane);
      }, FRANK_JOB_POLL_MS),
    );
    void processFrankLaneOnce(lane);
  }
}

export async function stopFrankWorker() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const interval of queueIntervals.values()) {
    clearInterval(interval);
  }
  queueIntervals.clear();
  tickingLanes.clear();

  shutdownController?.abort("worker_shutdown");

  for (const controller of inflightControllers.values()) {
    controller.abort("worker_shutdown");
  }

  await abortAllActiveExecutions("worker_shutdown");
  await Promise.allSettled([...inflightPromises.values()]);
  inflightControllers.clear();
  inflightPromises.clear();
}

async function processFrankLaneOnce(lane: WorkerLane) {
  if (shuttingDown || tickingLanes.has(lane.name)) {
    return;
  }

  tickingLanes.add(lane.name);

  try {
    await requeueExpiredLeases(lane.workers.map((worker) => worker.queueName));

    for (const worker of lane.workers) {
      const leases = await claimQueueItems(
        worker.queueName,
        `${lane.name}:${randomUUID()}`,
        worker.claimBatch,
        worker.timeoutMs,
      );

      for (const lease of leases) {
        const startedAt = Date.now();
        try {
          frankDebug("worker", "queue.start", {
            queueName: worker.queueName,
            leaseId: lease.id,
            channelId: lease.channelId,
            intentId: lease.intentId,
          });
          await runQueueLease(worker, lease);
          await completeQueueItem(lease.id, lease.leaseOwner);
          frankDebug("worker", "queue.complete", {
            durationMs: Date.now() - startedAt,
            queueName: worker.queueName,
            leaseId: lease.id,
          });
        } catch (error) {
          const normalized =
            error instanceof Error ? error.stack || error.message : String(error);
          logError("worker", `Queue item ${lease.id} failed`, error, {
            queueName: worker.queueName,
            leaseId: lease.id,
            channelId: lease.channelId,
            intentId: lease.intentId,
            durationMs: Date.now() - startedAt,
          });
          frankDebug("worker", "queue.error", {
            queueName: worker.queueName,
            leaseId: lease.id,
            error: normalized,
          });
        }
      }
    }
  } finally {
    tickingLanes.delete(lane.name);
  }
}

async function runQueueLease(worker: QueueWorker, lease: QueueLease) {
  const timeoutSignal = AbortSignal.timeout(worker.timeoutMs);
  const localController = new AbortController();
  inflightControllers.set(lease.id, localController);

  const signal = AbortSignal.any(
    [
      timeoutSignal,
      localController.signal,
      shutdownController?.signal,
    ].filter(Boolean) as AbortSignal[],
  );

  const task = (async () => {
    switch (worker.queueName) {
      case "runtime_update":
        await handleRuntimeUpdate(lease, lease.payload as RuntimeUpdateJob, signal);
        return;
      case "settle_channel":
        await handleSettleChannel(lease, lease.payload as SettleChannelJob, signal);
        return;
      case "generate_intent":
        await handleGenerateIntent(lease, lease.payload as GenerateIntentJob, signal);
        return;
      case "memory_extraction":
        await handleMemoryExtraction(
          lease,
          lease.payload as MemoryExtractionJob,
          signal,
        );
        return;
    }
  })();

  inflightPromises.set(lease.id, task);

  try {
    await task;
  } finally {
    inflightControllers.delete(lease.id);
    inflightPromises.delete(lease.id);
  }
}

async function ensureLeaseCurrent(lease: QueueLease) {
  return isQueueLeaseCurrent(lease.id, lease.leaseOwner);
}

async function handleRuntimeUpdate(
  lease: QueueLease,
  payload: RuntimeUpdateJob,
  _signal: AbortSignal,
) {
  const event = await getFrankEventById(payload.eventId);
  if (
    !event ||
    !("guildId" in event) ||
    !("channelId" in event) ||
    !event.channelId
  ) {
    return;
  }

  if (!(await ensureLeaseCurrent(lease))) {
    return;
  }

  const runtime = await getChannelRuntime(event.guildId, event.channelId);
  const nextRuntime = applyDiscordEventToRuntime(runtime, event as DiscordEvent);
  await saveChannelRuntime(nextRuntime);

  const control = await getChannelControl(event.guildId, event.channelId);
  const nextControl = {
    ...control,
    channelRevision: control.channelRevision + 1,
    lastSeenEventId: payload.eventId,
    lastHumanMessageId:
      event.type === "message_create" ? event.messageId : control.lastHumanMessageId,
    lastHumanMessageAt:
      event.type === "message_create" ? event.createdAt : control.lastHumanMessageAt,
  };

  let settleAt: Date | null = null;
  if (event.type === "message_create") {
    settleAt = new Date(Date.now() + getSettleDelayMs(event, nextRuntime));
  } else if (event.type === "message_update" || event.type === "message_delete") {
    settleAt = new Date();
  }

  if (settleAt) {
    nextControl.pendingSettleAt = settleAt.toISOString();
  }

  await saveChannelControl(nextControl);

  if (settleAt && (await ensureLeaseCurrent(lease))) {
    await upsertQueueItem(
      "settle_channel",
      {
        guildId: event.guildId,
        channelId: event.channelId,
        sourceEventId: payload.eventId,
        channelRevision: nextControl.channelRevision,
      },
      {
        dedupeKey: `settle:${event.channelId}`,
        guildId: event.guildId,
        channelId: event.channelId,
        availableAt: settleAt,
      },
    );
  }

  frankDebug("worker", "runtime_update.output", {
    eventId: payload.eventId,
    eventType: event.type,
    channelId: event.channelId,
    runtime: summarizeRuntime(nextRuntime),
    channelRevision: nextControl.channelRevision,
    pendingSettleAt: nextControl.pendingSettleAt,
  });
}

async function handleSettleChannel(
  lease: QueueLease,
  payload: SettleChannelJob,
  signal: AbortSignal,
) {
  if (!(await ensureLeaseCurrent(lease))) {
    return;
  }

  const settings = await getFrankGuildSettings(payload.guildId);
  let control = await getChannelControl(payload.guildId, payload.channelId);
  let runtime = await getChannelRuntime(payload.guildId, payload.channelId);

  if (isStaleSettleCandidate(payload, control)) {
    frankDebug("worker", "settle_channel.stale_candidate", {
      payload,
      control,
    });
    return;
  }

  if (
    control.pendingSettleAt &&
    Date.now() < new Date(control.pendingSettleAt).getTime()
  ) {
    await upsertQueueItem("settle_channel", payload, {
      dedupeKey: `settle:${payload.channelId}`,
      guildId: payload.guildId,
      channelId: payload.channelId,
      availableAt: new Date(control.pendingSettleAt),
    });
    return;
  }

  if (control.activeIntentId) {
    const activeIntent = await getConversationIntent(control.activeIntentId);
    const hasGenerateQueue = (
      await getQueueItemsForChannel(payload.channelId, ["generate_intent"])
    ).some((item) => item.intentId === control.activeIntentId);
    const activeExecution = hasActiveExecution(payload.channelId);

    if (
      shouldClearActiveIntent({
        intentStatus: activeIntent?.status ?? null,
        hasGenerateQueue,
        hasActiveExecution: activeExecution,
      })
    ) {
      if (activeIntent && ["pending", "generating", "sending"].includes(activeIntent.status)) {
        await markIntentStatus(activeIntent.id, "aborted", "stale_active_intent");
      }
      await clearChannelActiveIntent(payload.channelId);
      control = await getChannelControl(payload.guildId, payload.channelId);
      runtime = {
        ...runtime,
        activeIntentId: null,
        activeIntentRevision: null,
        activeSnapshotId: null,
        activeSnapshotCreatedAt: null,
      };
      await saveChannelRuntime(runtime);
      frankDebug("worker", "settle_channel.cleared_stale_active_intent", {
        channelId: payload.channelId,
      });
    }
  }

  if (shouldSkipSettleForActiveIntent(control, payload)) {
    frankDebug("worker", "settle_channel.skipped_active_intent", {
      payload,
      control,
    });
    return;
  }

  const snapshot = await buildResponseSnapshot(
    runtime,
    settings,
    client.user?.id ?? "frank",
  );

  const responseEvent: SystemEvent = {
    type: "response_decision",
    eventKey: `response_decision:${payload.channelId}:${Date.now()}`,
    channelId: payload.channelId,
    decision: snapshot?.attentionDecision ?? {
      shouldRespond: false,
      reason: "insufficient_signal",
      targetMessageId: null,
      opportunismScore: 0,
    },
    snapshotId: snapshot?.id ?? null,
    createdAt: new Date().toISOString(),
  };
  await appendFrankEvent(responseEvent);

  if (!snapshot || signal.aborted || !(await ensureLeaseCurrent(lease))) {
    const freshControl = await getChannelControl(payload.guildId, payload.channelId);
    if (
      freshControl.lastSeenEventId === payload.sourceEventId &&
      freshControl.channelRevision === payload.channelRevision
    ) {
      await saveChannelControl({
        ...freshControl,
        pendingSettleAt: null,
      });
    }
    frankDebug("worker", "settle_channel.noop", {
      payload,
      snapshotId: snapshot?.id ?? null,
    });
    return;
  }

  const sourceEvent = await getFrankEventById(payload.sourceEventId);
  const sourceMessageId =
    sourceEvent && "messageId" in sourceEvent ? sourceEvent.messageId : null;
  const intent = await createConversationIntent({
    control,
    sourceEventId: payload.sourceEventId,
    sourceMessageId,
    snapshot,
  });

  await saveChannelRuntime({
    ...runtime,
    activeIntentId: intent.id,
    activeIntentRevision: control.channelRevision,
    activeSnapshotId: snapshot.id,
    activeSnapshotCreatedAt: snapshot.createdAt,
  });

  await upsertQueueItem(
    "generate_intent",
    {
      guildId: payload.guildId,
      channelId: payload.channelId,
      intentId: intent.id,
      channelRevision: control.channelRevision,
      responseDecisionAt: new Date().toISOString(),
    },
    {
      dedupeKey: `generate:${intent.id}`,
      guildId: payload.guildId,
      channelId: payload.channelId,
      intentId: intent.id,
      availableAt: new Date(),
    },
  );

  frankDebug("worker", "settle_channel.intent_created", {
    payload,
    intentId: intent.id,
    snapshot: summarizeSnapshot(snapshot),
  });
}

async function handleGenerateIntent(
  lease: QueueLease,
  payload: GenerateIntentJob,
  signal: AbortSignal,
) {
  if (!(await ensureLeaseCurrent(lease))) {
    return;
  }

  const intent = await getConversationIntent(payload.intentId);
  const control = await getChannelControl(payload.guildId, payload.channelId);
  if (
    !intent ||
    intent.status !== "pending" ||
    control.activeIntentId !== intent.id ||
    control.activeIntentRevision !== intent.channelRevision ||
    intent.channelRevision < control.channelRevision
  ) {
    frankDebug("worker", "generate_intent.stale_on_start", {
      payload,
      control,
      intent,
    });
    return;
  }

  await markIntentStatus(intent.id, "generating");
  const settings = await getFrankGuildSettings(payload.guildId);
  const runtime = await getChannelRuntime(payload.guildId, payload.channelId);
  const executionController = new AbortController();
  const executionSignal = AbortSignal.any([signal, executionController.signal]);
  let sendingMarked = false;

  frankDebug("worker", "generate_intent.input", {
    intentId: intent.id,
    snapshot: summarizeSnapshot(intent.snapshot),
    settings,
  });

  const result = await executeStreamedBurstPlan({
    snapshot: intent.snapshot,
    typingStartedAt: payload.responseDecisionAt,
    maxBurstMessages: settings.burstResponsesEnabled
      ? settings.maxBurstMessages
      : 1,
    reactionsEnabled: settings.reactionsEnabled,
    abortSignal: executionSignal,
    beforeSendChunk: async ({ isFirst }) => {
      const freshControl = await getChannelControl(payload.guildId, payload.channelId);
      if (
        freshControl.activeIntentId !== intent.id ||
        freshControl.activeIntentRevision !== intent.channelRevision
      ) {
        executionController.abort("channel_shift");
        return;
      }

      if (isFirst && !sendingMarked) {
        sendingMarked = true;
        await markIntentStatus(intent.id, "sending");
      }
    },
  }).catch((error) => {
    if (executionSignal.aborted || isAbortLikeError(error)) {
      return {
        plan: null,
        sentMessageIds: [] as string[],
        sentMessages: [] as Array<{ id: string; text: string; createdAt: string }>,
        aborted: true,
        reason: normalizeExecutionAbortReason(
          executionSignal.reason ?? error,
        ),
      };
    }
    throw error;
  });

  frankDebug("worker", "generate_intent.output", {
    intentId: intent.id,
    aborted: result.aborted,
    reason: result.reason,
    plan: summarizeBurstPlan(result.plan),
    sentMessageIds: result.sentMessageIds,
  });

  if (result.plan) {
    const event: SystemEvent = {
      type: "burst_generated",
      eventKey: `burst_generated:${intent.snapshot.id}`,
      channelId: intent.channelId,
      snapshotId: intent.snapshot.id,
      burstPlan: result.plan,
      createdAt: new Date().toISOString(),
    };
    await appendFrankEvent(event);
  }

  if (result.aborted) {
    const remainingChunks = (result.plan?.chunks ?? [])
      .slice(result.sentMessageIds.length)
      .map((chunk) => chunk.text);
    const freshRuntime = await getChannelRuntime(payload.guildId, payload.channelId);
    const nextRuntime = markBurstInterrupted(
      freshRuntime,
      intent.snapshot,
      remainingChunks,
      new Date().toISOString(),
    );
    await saveChannelRuntime(nextRuntime);

    const nextStatus = toIntentAbortStatus(result.reason);
    await markIntentStatus(intent.id, nextStatus, result.reason ?? "aborted");
    await cancelQueueItemsForIntent(intent.id);
    await clearChannelActiveIntent(payload.channelId);

    const event: SystemEvent = {
      type: "burst_aborted",
      eventKey: `burst_aborted:${intent.snapshot.id}:${Date.now()}`,
      channelId: intent.channelId,
      snapshotId: intent.snapshot.id,
      remainingChunks,
      reason: result.reason ?? "manual_abort",
      createdAt: new Date().toISOString(),
    };
    await appendFrankEvent(event);

    const freshControl = await getChannelControl(payload.guildId, payload.channelId);
    if (freshControl.lastSeenEventId) {
      const availableAt = new Date();
      await saveChannelControl({
        ...freshControl,
        pendingSettleAt: availableAt.toISOString(),
      });
      await upsertQueueItem(
        "settle_channel",
        {
          guildId: payload.guildId,
          channelId: payload.channelId,
          sourceEventId: freshControl.lastSeenEventId,
          channelRevision: freshControl.channelRevision,
        },
        {
          dedupeKey: `settle:${payload.channelId}`,
          guildId: payload.guildId,
          channelId: payload.channelId,
          availableAt,
        },
      );
    }
    return;
  }

  const sentAt = new Date().toISOString();
  const freshRuntime = await getChannelRuntime(payload.guildId, payload.channelId);
  const nextRuntime = markBurstSent(
    freshRuntime,
    result.sentMessages,
    sentAt,
    client.user?.id ?? "frank",
    client.user?.globalName ?? client.user?.username ?? "Frank",
    client.user?.username ?? "frank",
  );
  await saveChannelRuntime(nextRuntime);
  await markIntentStatus(intent.id, "sent");
  await recordSentBurstOnControl({
    channelId: payload.channelId,
    sentAt,
    lastBotMessageId: result.sentMessageIds[result.sentMessageIds.length - 1] ?? null,
  });
}

async function handleMemoryExtraction(
  lease: QueueLease,
  payload: MemoryExtractionJob,
  signal: AbortSignal,
) {
  if (!(await ensureLeaseCurrent(lease))) {
    return;
  }

  frankDebug("worker", "memory_extraction.input", payload);
  await extractMemoryFromChannel(
    payload.guildId,
    payload.channelId,
    payload.sourceEventId,
    { abortSignal: signal },
  );
  frankDebug("worker", "memory_extraction.output", payload);
}

function getSettleDelayMs(
  event: Extract<DiscordEvent, { type: "message_create" }>,
  runtime: Awaited<ReturnType<typeof getChannelRuntime>>,
) {
  if (event.mentionsBot) {
    if (isShortSummon(event.content)) {
      return FRANK_BURST_SETTLE_MS;
    }
    return 250;
  }

  if (
    event.replyToMessageId &&
    runtime.visibleMessages.some(
      (message) => message.id === event.replyToMessageId && message.fromBot,
    )
  ) {
    return 250;
  }

  return FRANK_BURST_SETTLE_MS;
}

function isShortSummon(content: string) {
  const words = content
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  return words.length <= 2 && words.every((word) => word === "frank" || word === "botello");
}
