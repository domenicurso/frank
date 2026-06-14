import { client } from "@/client";
import {
  FRANK_BACKGROUND_JOB_CLAIM_BATCH,
  FRANK_BACKGROUND_JOB_TIMEOUT_MS,
  FRANK_BURST_SETTLE_MS,
  FRANK_GENERATION_JOB_CLAIM_BATCH,
  FRANK_JOB_POLL_MS,
  FRANK_LIVE_JOB_CLAIM_BATCH,
  FRANK_LIVE_JOB_TIMEOUT_MS,
  FRANK_MEMORY_DEBOUNCE_MS,
} from "@/frank/constants";
import { getFrankGuildSettings } from "@/frank/config";
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
  getActiveExecutionState,
  hasActiveExecution,
  interruptLaneExecution,
} from "@/frank/executor";
import {
  isAbortLikeError,
  normalizeExecutionAbortReason,
} from "@/frank/executionPolicy";
import { extractMemoryFromChannel } from "@/frank/memory";
import {
  cancelLaneWorkForConcern,
  claimLaneWork,
  completeLaneWork,
  createConcern,
  createTurn,
  getChannelControl,
  getConcern,
  getDefaultRelevantLaneForAuthor,
  getDefaultQueueLeaseMs,
  getLane,
  getQueuedConcernForLane,
  getTurn,
  listOpenConcernsForLane,
  listOpenConcernsForMessage,
  reconcileLaneRuntime,
  recordLaneSent,
  requeueExpiredLeases,
  saveChannelControl,
  updateConcern,
  updateTurn,
  upsertLane,
  upsertLaneWork,
} from "@/frank/queueStore";
import {
  applyDiscordEventToRuntime,
  markBurstSent,
} from "@/frank/runtime";
import { buildResponseSnapshot, isBareSummonContent } from "@/frank/snapshot";
import {
  appendFrankEvent,
  getChannelRuntime,
  getFrankEventById,
  saveChannelRuntime,
} from "@/frank/store";
import type {
  Concern,
  ConcernDecision,
  ConcernReasonCode,
  ConcernStatus,
  ConversationLane,
  DiscordEvent,
  FrankQueueName,
  GenerateIntentJob,
  InvalidationReason,
  LaneFollowupJob,
  LaneGenerateJob,
  LaneKey,
  LaneUpdateJob,
  MemoryExtractionJob,
  MemoryRefreshJob,
  QueueLease,
  RuntimeUpdateJob,
  SettleChannelJob,
  SystemEvent,
  VisibleMessage,
} from "@/frank/types";
import { logError } from "@/log";
import { randomUUID } from "node:crypto";

type QueueWorker = {
  queueName: "lane_update" | "lane_generate" | "lane_followup" | "memory_refresh";
  lane: "live" | "generation" | "background";
  claimBatch: number;
  timeoutMs: number;
};

type WorkerLane = {
  name: "live" | "generation" | "background";
  workers: QueueWorker[];
};

const QUEUE_WORKERS: Record<QueueWorker["queueName"], QueueWorker> = {
  lane_update: {
    queueName: "lane_update",
    lane: "live",
    claimBatch: FRANK_LIVE_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_LIVE_JOB_TIMEOUT_MS,
  },
  lane_followup: {
    queueName: "lane_followup",
    lane: "live",
    claimBatch: FRANK_LIVE_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_LIVE_JOB_TIMEOUT_MS,
  },
  lane_generate: {
    queueName: "lane_generate",
    lane: "generation",
    claimBatch: FRANK_GENERATION_JOB_CLAIM_BATCH,
    timeoutMs: getDefaultQueueLeaseMs("lane_generate"),
  },
  memory_refresh: {
    queueName: "memory_refresh",
    lane: "background",
    claimBatch: FRANK_BACKGROUND_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_BACKGROUND_JOB_TIMEOUT_MS,
  },
};

const WORKER_LANES: WorkerLane[] = [
  {
    name: "live",
    workers: [QUEUE_WORKERS.lane_update, QUEUE_WORKERS.lane_followup],
  },
  {
    name: "generation",
    workers: [QUEUE_WORKERS.lane_generate],
  },
  {
    name: "background",
    workers: [QUEUE_WORKERS.memory_refresh],
  },
];

const queueIntervals = new Map<string, NodeJS.Timeout>();
const tickingLanes = new Set<string>();
const inflightControllers = new Map<string, AbortController>();
const inflightPromises = new Map<string, Promise<void>>();
let shutdownController: AbortController | null = null;
let shuttingDown = false;

function sameAuthorLaneKey(authorId: string) {
  return `author:${authorId}`;
}

function replyLaneKey(replyToMessageId: string, authorId: string) {
  return `reply:${replyToMessageId}:author:${authorId}`;
}

function appendUnique(items: string[], value: string) {
  return items.includes(value) ? items : [...items, value];
}

function toInterruptionReason(reasonCode: ConcernReasonCode): InvalidationReason {
  switch (reasonCode) {
    case "reply_to_bot":
      return "new_reply";
    case "message_deleted":
      return "message_deleted";
    case "message_edited":
      return "message_edited";
    case "direct_mention":
      return "new_direct_message";
    default:
      return "channel_shift";
  }
}

function shouldRetryConcern(reason: InvalidationReason | undefined) {
  return ![
    "new_direct_message",
    "new_reply",
    "message_deleted",
    "message_edited",
    "worker_shutdown",
  ].includes(reason ?? "channel_shift");
}

function getSettleDelayMs(event: Extract<DiscordEvent, { type: "message_create" }>) {
  if (event.repliesToBot) {
    return 250;
  }

  if (event.mentionsBot && !isBareSummonContent(event.content)) {
    return 250;
  }

  return FRANK_BURST_SETTLE_MS;
}

async function chooseExistingLane(
  event: Extract<DiscordEvent, { type: "message_create" }>,
) {
  return getDefaultRelevantLaneForAuthor(
    event.guildId,
    event.channelId,
    event.authorId,
  );
}

async function decideConcern(
  event: Extract<DiscordEvent, { type: "message_create" }>,
  existingLane: ConversationLane | null,
) : Promise<ConcernDecision> {
  const settleAt = new Date(Date.now() + getSettleDelayMs(event)).toISOString();
  const isBareSummon = isBareSummonContent(event.content);

  if (event.repliesToBot && event.replyToMessageId) {
    return {
      action: existingLane ? "merge_into_lane" : "queue_new_concern",
      laneKey:
        existingLane?.authorId === event.authorId
          ? existingLane.laneKey
          : replyLaneKey(event.replyToMessageId, event.authorId),
      reasonCode: "reply_to_bot",
      settleAt,
    };
  }

  if (event.mentionsBot) {
    return {
      action: existingLane ? "merge_into_lane" : "queue_new_concern",
      laneKey: existingLane?.laneKey ?? sameAuthorLaneKey(event.authorId),
      reasonCode: isBareSummon ? "bare_summon" : "direct_mention",
      settleAt,
    };
  }

  if (existingLane) {
    return {
      action: "merge_into_lane",
      laneKey: existingLane.laneKey,
      reasonCode: "continuation",
      settleAt,
    };
  }

  return {
    action: "dismiss_as_context",
    laneKey: null,
    reasonCode: isBareSummon ? "bare_summon" : "continuation",
    settleAt: null,
  };
}

async function enqueueLaneGenerate(
  concern: Concern,
  lane: ConversationLane,
  availableAt: Date,
) {
  await upsertLaneWork(
    "lane_generate",
    {
      guildId: concern.guildId,
      channelId: concern.channelId,
      laneKey: lane.laneKey,
      concernId: concern.id,
      decisionCompletedAt: new Date().toISOString(),
    } as LaneGenerateJob,
    {
      guildId: concern.guildId,
      channelId: concern.channelId,
      laneKey: lane.laneKey,
      concernId: concern.id,
      dedupeKey: `generate:${concern.id}`,
      availableAt,
    },
  );
}

async function queueFollowup(lane: ConversationLane) {
  await upsertLaneWork(
    "lane_followup",
    {
      guildId: lane.guildId,
      channelId: lane.channelId,
      laneKey: lane.laneKey,
    } as LaneFollowupJob,
    {
      guildId: lane.guildId,
      channelId: lane.channelId,
      laneKey: lane.laneKey,
      dedupeKey: `followup:${lane.laneKey}`,
      availableAt: new Date(),
    },
  );
}

async function queueMemoryRefreshForChannel(
  guildId: string,
  channelId: string,
  sourceEventId: string | null,
) {
  if (!sourceEventId) {
    return;
  }

  await upsertLaneWork(
    "memory_refresh",
    {
      guildId,
      channelId,
      sourceEventId,
    } as MemoryRefreshJob,
    {
      guildId,
      channelId,
      dedupeKey: `memory-refresh:${channelId}`,
      availableAt: new Date(Date.now() + FRANK_MEMORY_DEBOUNCE_MS),
    },
  );
}

async function activateConcern(
  lane: ConversationLane,
  concern: Concern,
  humanActivityAt: string,
  availableAt: Date,
) {
  const nextLane = await upsertLane({
    guildId: lane.guildId,
    channelId: lane.channelId,
    laneKey: lane.laneKey,
    authorId: lane.authorId,
    replyRootMessageId: lane.replyRootMessageId,
    status: "queued",
    activeConcernId: concern.id,
    activeTurnId: null,
    lastHumanActivityAt: humanActivityAt,
  });
  await enqueueLaneGenerate(concern, nextLane, availableAt);
  return nextLane;
}

async function createQueuedConcernFromMessage(options: {
  lane: ConversationLane;
  event: Extract<DiscordEvent, { type: "message_create" }>;
  reasonCode: ConcernReasonCode;
}) {
  return createConcern({
    guildId: options.event.guildId,
    channelId: options.event.channelId,
    laneKey: options.lane.laneKey,
    sourceEventIds: [options.event.eventKey],
    sourceMessageIds: [options.event.messageId],
    focusAuthorId: options.event.authorId,
    anchorMessageId: options.event.messageId,
    status: "queued",
    reasonCode: options.reasonCode,
  });
}

async function mergeMessagesIntoConcern(
  concern: Concern,
  event: Extract<DiscordEvent, { type: "message_create" }>,
) {
  return updateConcern(concern.id, {
    sourceEventIds: appendUnique(concern.sourceEventIds, event.eventKey),
    sourceMessageIds: appendUnique(concern.sourceMessageIds, event.messageId),
    anchorMessageId: concern.anchorMessageId ?? event.messageId,
    reasonCode: concern.reasonCode,
  });
}

async function handleMessageCreateConcern(
  event: Extract<DiscordEvent, { type: "message_create" }>,
  control: Awaited<ReturnType<typeof getChannelControl>>,
) {
  const existingLane = await chooseExistingLane(event);
  const decision = await decideConcern(event, existingLane);
  if (decision.action === "dismiss_as_context" || !decision.laneKey) {
    return;
  }

  const lane = await upsertLane({
    guildId: event.guildId,
    channelId: event.channelId,
    laneKey: decision.laneKey,
    authorId: event.authorId,
    replyRootMessageId:
      decision.reasonCode === "reply_to_bot" ? event.replyToMessageId : null,
    lastHumanActivityAt: event.createdAt,
    status: existingLane?.status ?? "idle",
    activeConcernId: existingLane?.activeConcernId ?? null,
    activeTurnId: existingLane?.activeTurnId ?? null,
  });
  const concerns = await listOpenConcernsForLane(event.guildId, event.channelId, lane.laneKey);
  const activeConcern = lane.activeConcernId
    ? concerns.find((concern) => concern.id === lane.activeConcernId) ??
      (await getConcern(lane.activeConcernId))
    : null;
  const successorConcern =
    [...concerns]
      .reverse()
      .find((concern) => concern.status === "queued" && concern.id !== lane.activeConcernId) ??
    null;
  const executionState = getActiveExecutionState(lane.laneKey);
  const activeTurn =
    lane.activeTurnId && !executionState ? await getTurn(lane.activeTurnId) : null;
  const sentChunkCount =
    executionState?.sentMessageCount ?? activeTurn?.sentChunkCount ?? 0;
  const availableAt = new Date(decision.settleAt ?? new Date().toISOString());

  if (!activeConcern || lane.status === "idle" || activeConcern.status === "sent") {
    const concern = await createQueuedConcernFromMessage({
      lane,
      event,
      reasonCode: decision.reasonCode,
    });
    await activateConcern(lane, concern, event.createdAt, availableAt);
  } else if (
    activeConcern.focusAuthorId === event.authorId &&
    sentChunkCount === 0 &&
    (lane.status === "queued" || lane.status === "generating")
  ) {
    const successor =
      successorConcern && successorConcern.focusAuthorId === event.authorId
        ? await mergeMessagesIntoConcern(successorConcern, event)
        : await createConcern({
            guildId: event.guildId,
            channelId: event.channelId,
            laneKey: lane.laneKey,
            sourceEventIds: appendUnique(activeConcern.sourceEventIds, event.eventKey),
            sourceMessageIds: appendUnique(activeConcern.sourceMessageIds, event.messageId),
            focusAuthorId: event.authorId,
            anchorMessageId: activeConcern.anchorMessageId ?? event.messageId,
            status: "queued",
            reasonCode: decision.reasonCode,
          });

    await updateConcern(activeConcern.id, {
      status: "merged",
      supersededByConcernId: successor?.id ?? null,
    });
    await cancelLaneWorkForConcern(activeConcern.id);
    interruptLaneExecution(lane.laneKey, toInterruptionReason(decision.reasonCode));
    await activateConcern(lane, successor!, event.createdAt, availableAt);
  } else {
    const queued =
      successorConcern && successorConcern.focusAuthorId === event.authorId
        ? await mergeMessagesIntoConcern(successorConcern, event)
        : await createQueuedConcernFromMessage({
            lane,
            event,
            reasonCode: decision.reasonCode,
          });
    void queued;
    await upsertLane({
      guildId: lane.guildId,
      channelId: lane.channelId,
      laneKey: lane.laneKey,
      authorId: lane.authorId,
      replyRootMessageId: lane.replyRootMessageId,
      status: lane.status,
      activeConcernId: lane.activeConcernId,
      activeTurnId: lane.activeTurnId,
      lastHumanActivityAt: event.createdAt,
    });
    await queueFollowup(lane);
  }

  await saveChannelControl({
    ...control,
    pendingSettleAt: decision.settleAt,
  });
}

async function handleConcernMutation(
  event: Extract<DiscordEvent, { type: "message_update" | "message_delete" }>,
) {
  const concerns = await listOpenConcernsForMessage(
    event.guildId,
    event.channelId,
    event.messageId,
  );

  for (const concern of concerns) {
    const lane = await getLane(event.guildId, event.channelId, concern.laneKey);
    if (!lane) {
      continue;
    }

    const remainingMessageIds =
      event.type === "message_delete"
        ? concern.sourceMessageIds.filter((messageId) => messageId !== event.messageId)
        : [...concern.sourceMessageIds];

    if (remainingMessageIds.length === 0) {
      await updateConcern(concern.id, {
        status: "cancelled",
        reasonCode: event.type === "message_delete" ? "message_deleted" : "message_edited",
      });
      await cancelLaneWorkForConcern(concern.id);
      interruptLaneExecution(
        lane.laneKey,
        event.type === "message_delete" ? "message_deleted" : "message_edited",
      );

      if (lane.activeConcernId === concern.id) {
        await upsertLane({
          guildId: lane.guildId,
          channelId: lane.channelId,
          laneKey: lane.laneKey,
          authorId: lane.authorId,
          replyRootMessageId: lane.replyRootMessageId,
          status: "idle",
          activeConcernId: null,
          activeTurnId: null,
        });
        await queueFollowup(lane);
      }
      continue;
    }

    const successor = await createConcern({
      guildId: concern.guildId,
      channelId: concern.channelId,
      laneKey: concern.laneKey,
      sourceEventIds: appendUnique(concern.sourceEventIds, event.eventKey),
      sourceMessageIds: remainingMessageIds,
      focusAuthorId: concern.focusAuthorId,
      anchorMessageId:
        concern.anchorMessageId === event.messageId ? remainingMessageIds[0] ?? null : concern.anchorMessageId,
      status: "queued",
      reasonCode: event.type === "message_delete" ? "message_deleted" : "message_edited",
    });
    await updateConcern(concern.id, {
      status: "cancelled",
      supersededByConcernId: successor.id,
      reasonCode: event.type === "message_delete" ? "message_deleted" : "message_edited",
    });
    await cancelLaneWorkForConcern(concern.id);
    interruptLaneExecution(
      lane.laneKey,
      event.type === "message_delete" ? "message_deleted" : "message_edited",
    );

    if (lane.activeConcernId === concern.id) {
      const nextLane = await upsertLane({
        guildId: lane.guildId,
        channelId: lane.channelId,
        laneKey: lane.laneKey,
        authorId: lane.authorId,
        replyRootMessageId: lane.replyRootMessageId,
        status: "queued",
        activeConcernId: successor.id,
        activeTurnId: null,
      });
      await enqueueLaneGenerate(successor, nextLane, new Date());
    } else {
      await queueFollowup(lane);
    }
  }
}

export function startFrankWorker() {
  if (queueIntervals.size > 0) {
    return;
  }

  shuttingDown = false;
  shutdownController = new AbortController();
  void reconcileLaneRuntime().catch((error) => {
    logError("worker", "Failed to reconcile Frank lane runtime", error);
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
      const leases = await claimLaneWork(
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
            laneKey: lease.laneKey,
            concernId: lease.concernId,
          });
          await runQueueLease(worker, lease);
          await completeLaneWork(lease.id, lease.leaseOwner);
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
            laneKey: lease.laneKey,
            concernId: lease.concernId,
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
    [timeoutSignal, localController.signal, shutdownController?.signal].filter(Boolean) as AbortSignal[],
  );

  const task = (async () => {
    switch (worker.queueName) {
      case "lane_update":
        await handleLaneUpdate(lease, lease.payload as LaneUpdateJob, signal);
        return;
      case "lane_followup":
        await handleLaneFollowup(lease, lease.payload as LaneFollowupJob, signal);
        return;
      case "lane_generate":
        await handleLaneGenerate(lease, lease.payload as LaneGenerateJob, signal);
        return;
      case "memory_refresh":
        await handleMemoryRefresh(lease, lease.payload as MemoryRefreshJob, signal);
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

async function handleLaneUpdate(
  _lease: QueueLease,
  payload: LaneUpdateJob,
  _signal: AbortSignal,
) {
  const event = await getFrankEventById(payload.eventId);
  if (!event || !("guildId" in event) || !("channelId" in event)) {
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
  await saveChannelControl(nextControl);

  if (event.type === "message_create") {
    await handleMessageCreateConcern(event, nextControl);
  } else if (event.type === "message_update" || event.type === "message_delete") {
    await handleConcernMutation(event);
  }

  frankDebug("worker", "lane_update.output", {
    event: summarizeEvent(event),
    runtime: summarizeRuntime(nextRuntime),
    channelRevision: nextControl.channelRevision,
  });
}

async function handleLaneFollowup(
  _lease: QueueLease,
  payload: LaneFollowupJob,
  _signal: AbortSignal,
) {
  const lane = await getLane(payload.guildId, payload.channelId, payload.laneKey);
  if (!lane || lane.status !== "idle") {
    return;
  }

  const concern = await getQueuedConcernForLane(
    payload.guildId,
    payload.channelId,
    payload.laneKey,
  );
  if (!concern) {
    const control = await getChannelControl(payload.guildId, payload.channelId);
    await queueMemoryRefreshForChannel(
      payload.guildId,
      payload.channelId,
      control.lastSeenEventId,
    );
    return;
  }

  const nextLane = await upsertLane({
    guildId: lane.guildId,
    channelId: lane.channelId,
    laneKey: lane.laneKey,
    authorId: lane.authorId,
    replyRootMessageId: lane.replyRootMessageId,
    status: "queued",
    activeConcernId: concern.id,
    activeTurnId: null,
  });
  await enqueueLaneGenerate(concern, nextLane, new Date());
}

async function handleLaneGenerate(
  _lease: QueueLease,
  payload: LaneGenerateJob,
  signal: AbortSignal,
) {
  const lane = await getLane(payload.guildId, payload.channelId, payload.laneKey);
  const concern = await getConcern(payload.concernId);
  if (
    !lane ||
    !concern ||
    concern.status !== "queued" ||
    lane.activeConcernId !== concern.id
  ) {
    frankDebug("worker", "lane_generate.stale_on_start", {
      lane,
      concern,
      payload,
    });
    return;
  }

  const settings = await getFrankGuildSettings(payload.guildId);
  const runtime = await getChannelRuntime(payload.guildId, payload.channelId);
  const compact = concern.attemptCount > 0;
  const snapshot = await buildResponseSnapshot({
    runtime,
    concern,
    lane,
    settings,
    compact,
  });

  if (!snapshot) {
    await updateConcern(concern.id, { status: "cancelled" });
    await upsertLane({
      guildId: lane.guildId,
      channelId: lane.channelId,
      laneKey: lane.laneKey,
      authorId: lane.authorId,
      replyRootMessageId: lane.replyRootMessageId,
      status: "idle",
      activeConcernId: null,
      activeTurnId: null,
    });
    await queueFollowup(lane);
    return;
  }

  await updateConcern(concern.id, {
    status: "generating",
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    snapshot,
  });
  const turn = await createTurn({
    concernId: concern.id,
    laneKey: lane.laneKey,
    guildId: lane.guildId,
    channelId: lane.channelId,
  });
  await upsertLane({
    guildId: lane.guildId,
    channelId: lane.channelId,
    laneKey: lane.laneKey,
    authorId: lane.authorId,
    replyRootMessageId: lane.replyRootMessageId,
    status: "generating",
    activeConcernId: concern.id,
    activeTurnId: turn.id,
  });

  const responseEvent: SystemEvent = {
    type: "response_decision",
    eventKey: `response_decision:${lane.laneKey}:${Date.now()}`,
    channelId: payload.channelId,
    decision: snapshot.attentionDecision,
    snapshotId: snapshot.id,
    createdAt: new Date().toISOString(),
  };
  await appendFrankEvent(responseEvent);

  const maxBurstMessages = compact
    ? Math.min(settings.maxBurstMessages, 2)
    : settings.burstResponsesEnabled
      ? settings.maxBurstMessages
      : 1;
  let sendingMarked = false;

  frankDebug("worker", "lane_generate.input", {
    laneKey: lane.laneKey,
    concernId: concern.id,
    turnId: turn.id,
    compact,
    snapshot: summarizeSnapshot(snapshot),
  });

  const result = await executeStreamedBurstPlan({
    snapshot,
    laneKey: lane.laneKey,
    turnId: turn.id,
    typingStartedAt: payload.decisionCompletedAt,
    maxBurstMessages,
    reactionsEnabled: settings.reactionsEnabled,
    abortSignal: signal,
    beforeSendChunk: async ({ isFirst }) => {
      const freshLane = await getLane(payload.guildId, payload.channelId, payload.laneKey);
      if (
        !freshLane ||
        freshLane.activeConcernId !== concern.id ||
        freshLane.activeTurnId !== turn.id
      ) {
        throw new Error("channel_shift");
      }

      if (isFirst && !sendingMarked) {
        sendingMarked = true;
        await updateTurn(turn.id, { status: "streaming" });
        await upsertLane({
          guildId: freshLane.guildId,
          channelId: freshLane.channelId,
          laneKey: freshLane.laneKey,
          authorId: freshLane.authorId,
          replyRootMessageId: freshLane.replyRootMessageId,
          status: "sending",
          activeConcernId: concern.id,
          activeTurnId: turn.id,
        });
      }
    },
  }).catch((error) => {
    if (signal.aborted || isAbortLikeError(error)) {
      return {
        plan: null,
        sentMessageIds: [] as string[],
        sentMessages: [] as Array<{ id: string; text: string; createdAt: string }>,
        aborted: true,
        reason: normalizeExecutionAbortReason(signal.reason ?? error),
      };
    }
    throw error;
  });

  if (result.plan) {
    const event: SystemEvent = {
      type: "burst_generated",
      eventKey: `burst_generated:${snapshot.id}`,
      channelId: snapshot.channelId,
      snapshotId: snapshot.id,
      burstPlan: result.plan,
      createdAt: new Date().toISOString(),
    };
    await appendFrankEvent(event);
  }

  frankDebug("worker", "lane_generate.output", {
    laneKey: lane.laneKey,
    concernId: concern.id,
    turnId: turn.id,
    aborted: result.aborted,
    reason: result.reason,
    plan: summarizeBurstPlan(result.plan),
    sentMessageIds: result.sentMessageIds,
  });

  if (result.aborted) {
    const remainingChunks = (result.plan?.chunks ?? [])
      .slice(result.sentMessageIds.length)
      .map((chunk) => chunk.text);
    const interruptedAt = new Date().toISOString();
    await updateTurn(turn.id, {
      status: "aborted",
      plannedChunks: result.plan?.chunks ?? [],
      sentChunkCount: result.sentMessageIds.length,
      pendingIntentContext:
        remainingChunks.length > 0
          ? {
              snapshotId: snapshot.id,
              anchorMessageId: snapshot.anchorMessageId,
              interruptedAt,
              remainingChunks,
              laneKey: lane.laneKey,
              turnId: turn.id,
            }
          : null,
    });

    const freshLane = await getLane(payload.guildId, payload.channelId, payload.laneKey);
    const freshConcern = await getConcern(concern.id);
    if (freshLane?.activeTurnId === turn.id) {
      await upsertLane({
        guildId: freshLane.guildId,
        channelId: freshLane.channelId,
        laneKey: freshLane.laneKey,
        authorId: freshLane.authorId,
        replyRootMessageId: freshLane.replyRootMessageId,
        status:
          freshLane.activeConcernId && freshLane.activeConcernId !== concern.id
            ? "queued"
            : "idle",
        activeConcernId:
          freshLane.activeConcernId === concern.id ? null : freshLane.activeConcernId,
        activeTurnId: null,
      });
    }

    if (
      freshConcern &&
      freshConcern.status === "generating" &&
      result.sentMessageIds.length === 0
    ) {
      if (freshConcern.attemptCount < 1 && shouldRetryConcern(result.reason)) {
        await updateConcern(freshConcern.id, {
          status: "queued",
          attemptCount: freshConcern.attemptCount + 1,
        });
        await upsertLane({
          guildId: lane.guildId,
          channelId: lane.channelId,
          laneKey: lane.laneKey,
          authorId: lane.authorId,
          replyRootMessageId: lane.replyRootMessageId,
          status: "queued",
          activeConcernId: freshConcern.id,
          activeTurnId: null,
        });
        await enqueueLaneGenerate(
          { ...freshConcern, attemptCount: freshConcern.attemptCount + 1 },
          lane,
          new Date(),
        );
      } else {
        await updateConcern(freshConcern.id, { status: "failed" });
        await queueFollowup(lane);
      }
    } else if (freshConcern && freshConcern.status === "generating") {
      await updateConcern(freshConcern.id, { status: "failed" });
      await queueFollowup(lane);
    }

    const event: SystemEvent = {
      type: "burst_aborted",
      eventKey: `burst_aborted:${snapshot.id}:${Date.now()}`,
      channelId: snapshot.channelId,
      snapshotId: snapshot.id,
      remainingChunks,
      reason: result.reason ?? "manual_abort",
      createdAt: interruptedAt,
    };
    await appendFrankEvent(event);
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
  await recordLaneSent({
    guildId: payload.guildId,
    channelId: payload.channelId,
    laneKey: lane.laneKey,
    concernId: concern.id,
    turnId: turn.id,
    sentAt,
    lastBotMessageId: result.sentMessageIds[result.sentMessageIds.length - 1] ?? null,
    plannedChunks: result.plan?.chunks ?? [],
    sentChunkCount: result.sentMessageIds.length,
  });
  await queueFollowup(lane);
}

async function handleMemoryRefresh(
  _lease: QueueLease,
  payload: MemoryRefreshJob | MemoryExtractionJob,
  signal: AbortSignal,
) {
  frankDebug("worker", "memory_refresh.input", payload);
  await extractMemoryFromChannel(payload.guildId, payload.channelId, payload.sourceEventId, {
    abortSignal: signal,
  });
  frankDebug("worker", "memory_refresh.output", payload);
}
