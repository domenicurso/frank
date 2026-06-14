import { client } from "@/client";
import {
  FRANK_BACKGROUND_JOB_CLAIM_BATCH,
  FRANK_BACKGROUND_JOB_STALE_MS,
  FRANK_BACKGROUND_JOB_TIMEOUT_MS,
  FRANK_BURST_SETTLE_MS,
  FRANK_GENERATION_JOB_CLAIM_BATCH,
  FRANK_GENERATION_JOB_STALE_MS,
  FRANK_GENERATION_JOB_TIMEOUT_MS,
  FRANK_JOB_POLL_MS,
  FRANK_LIVE_JOB_CLAIM_BATCH,
  FRANK_LIVE_JOB_STALE_MS,
  FRANK_LIVE_JOB_TIMEOUT_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeBurstPlan, summarizeEvent, summarizeRuntime, summarizeSnapshot } from "@/frank/debugView";
import { executeStreamedBurstPlan } from "@/frank/executor";
import {
  isAbortLikeError,
  normalizeExecutionAbortReason,
} from "@/frank/executionPolicy";
import {
  shouldDelayResponseDecision,
  shouldSkipStaleResponseDecision,
} from "@/frank/decisionPolicy";
import { shouldSkipStaleGenerationSnapshot } from "@/frank/generationPolicy";
import { getFrankGuildSettings } from "@/frank/config";
import { extractMemoryFromChannel } from "@/frank/memory";
import { logError } from "@/log";
import {
  applyDiscordEventToRuntime,
  markBurstInterrupted,
  markBurstSent,
  releasePendingSnapshot,
} from "@/frank/runtime";
import { buildResponseSnapshot } from "@/frank/snapshot";
import {
  appendFrankEvent,
  claimFrankJobsByType,
  completeFrankJob,
  enqueueFrankJob,
  failFrankJob,
  getChannelRuntime,
  getFrankEventById,
  getFrankJobPayload,
  releaseStaleFrankJobs,
  saveChannelRuntime,
} from "@/frank/store";
import type {
  CharacterGenerationJob,
  DiscordEvent,
  FrankJobType,
  MemoryExtractionJob,
  ResponseDecisionJob,
  RuntimeUpdateJob,
  SystemEvent,
} from "@/frank/types";

type WorkerLane = {
  name: "live" | "generation" | "background";
  jobTypes: FrankJobType[];
  claimBatch: number;
  timeoutMs: number;
  staleMs: number;
};

const WORKER_LANES: WorkerLane[] = [
  {
    name: "live",
    jobTypes: ["runtime_update", "response_decision"],
    claimBatch: FRANK_LIVE_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_LIVE_JOB_TIMEOUT_MS,
    staleMs: FRANK_LIVE_JOB_STALE_MS,
  },
  {
    name: "generation",
    jobTypes: ["character_generation"],
    claimBatch: FRANK_GENERATION_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_GENERATION_JOB_TIMEOUT_MS,
    staleMs: FRANK_GENERATION_JOB_STALE_MS,
  },
  {
    name: "background",
    jobTypes: ["memory_extraction"],
    claimBatch: FRANK_BACKGROUND_JOB_CLAIM_BATCH,
    timeoutMs: FRANK_BACKGROUND_JOB_TIMEOUT_MS,
    staleMs: FRANK_BACKGROUND_JOB_STALE_MS,
  },
];

const workerIntervals = new Map<WorkerLane["name"], NodeJS.Timeout>();
const tickingLanes = new Set<WorkerLane["name"]>();

export function startFrankWorker() {
  if (workerIntervals.size > 0) return;

  for (const lane of WORKER_LANES) {
    workerIntervals.set(
      lane.name,
      setInterval(() => {
        void processFrankJobsOnce(lane);
      }, FRANK_JOB_POLL_MS),
    );

    void processFrankJobsOnce(lane);
  }
}

export function stopFrankWorker() {
  for (const interval of workerIntervals.values()) {
    clearInterval(interval);
  }
  workerIntervals.clear();
  tickingLanes.clear();
}

export async function processFrankJobsOnce(
  lane: WorkerLane = WORKER_LANES[0]!,
) {
  if (tickingLanes.has(lane.name)) return;
  tickingLanes.add(lane.name);

  try {
    await releaseStaleFrankJobs(lane.jobTypes, lane.staleMs);
    const jobs = await claimFrankJobsByType(lane.claimBatch, lane.jobTypes);
    for (const job of jobs) {
      const startedAt = Date.now();
      try {
        frankDebug("worker", "job.start", {
          jobId: job.id,
          jobType: job.jobType,
          lane: lane.name,
          channelId: job.channelId,
          guildId: job.guildId,
        });
        await runFrankJobWithTimeout(
          lane,
          job.jobType,
          getFrankJobPayload(job),
        );
        await completeFrankJob(job.id);
        frankDebug("worker", "job.complete", {
          durationMs: Date.now() - startedAt,
          jobId: job.id,
          jobType: job.jobType,
          lane: lane.name,
        });
      } catch (error) {
        logError("worker", `Job ${job.id} failed`, error, {
          durationMs: Date.now() - startedAt,
          jobId: job.id,
          jobType: job.jobType,
          lane: lane.name,
          channelId: job.channelId,
          guildId: job.guildId,
        });
        frankDebug("worker", "job.error", {
          jobId: job.id,
          jobType: job.jobType,
          lane: lane.name,
          error,
        });
        await failFrankJob(job.id, error);
      }
    }
  } finally {
    tickingLanes.delete(lane.name);
  }
}

async function runFrankJobWithTimeout(
  lane: WorkerLane,
  jobType: FrankJobType,
  payload:
    | RuntimeUpdateJob
    | ResponseDecisionJob
    | CharacterGenerationJob
    | MemoryExtractionJob,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("worker_timeout");
  }, lane.timeoutMs);

  try {
    await processFrankJob(jobType, payload, {
      abortSignal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function processFrankJob(
  jobType: FrankJobType,
  payload:
    | RuntimeUpdateJob
    | ResponseDecisionJob
    | CharacterGenerationJob
    | MemoryExtractionJob,
  options: {
    abortSignal?: AbortSignal;
  } = {},
) {
  switch (jobType) {
    case "runtime_update":
      await handleRuntimeUpdate(payload as RuntimeUpdateJob);
      return;
    case "response_decision":
      await handleResponseDecision(payload as ResponseDecisionJob);
      return;
    case "character_generation":
      await handleCharacterGeneration(
        payload as CharacterGenerationJob,
        options,
      );
      return;
    case "memory_extraction":
      await handleMemoryExtraction(payload as MemoryExtractionJob, options);
      return;
    default:
      throw new Error(`Unknown Frank job type: ${jobType}`);
  }
}

async function handleRuntimeUpdate(payload: RuntimeUpdateJob) {
  const event = await getFrankEventById(payload.eventId);
  if (
    !event ||
    !("guildId" in event) ||
    !("channelId" in event) ||
    !event.channelId
  ) {
    return;
  }

  const runtime = await getChannelRuntime(event.guildId, event.channelId);
  const nextRuntime = applyDiscordEventToRuntime(runtime, event as DiscordEvent);
  await saveChannelRuntime(nextRuntime);
  frankDebug("worker", "runtime_update.output", {
    eventId: payload.eventId,
    eventType: event.type,
    channelId: event.channelId,
    runtime: summarizeRuntime(nextRuntime),
  });
}

async function handleResponseDecision(payload: ResponseDecisionJob) {
  const settings = await getFrankGuildSettings(payload.guildId);
  const runtime = await getChannelRuntime(payload.guildId, payload.channelId);
  const sourceEvent = await getFrankEventById(payload.sourceEventId);

  if (shouldDelayResponseDecision(runtime)) {
    await enqueueFrankJob("response_decision", payload, {
      queueKey: `decision:${payload.channelId}`,
      guildId: payload.guildId,
      channelId: payload.channelId,
      runAt: new Date(Date.now() + 250),
    });
    frankDebug("worker", "response_decision.delayed_active_snapshot", {
      payload,
      activeSnapshotId: runtime.activeSnapshotId,
    });
    return;
  }

  if (
    shouldSkipStaleResponseDecision({
      runtime,
      sourceEvent,
    })
  ) {
    frankDebug("worker", "response_decision.skipped_stale", {
      payload,
      sourceEvent: summarizeEvent(sourceEvent),
      runtime: summarizeRuntime(runtime),
    });
    return;
  }

  const lastHumanAt = runtime.lastHumanMessageAt
    ? new Date(runtime.lastHumanMessageAt).getTime()
    : 0;
  const settleMs = getSettleMs(sourceEvent, runtime);
  frankDebug("worker", "response_decision.input", {
    payload,
    settleMs,
    sourceEvent: summarizeEvent(sourceEvent),
    runtime: summarizeRuntime(runtime),
  });

  if (Date.now() - lastHumanAt < settleMs) {
    await enqueueFrankJob("response_decision", payload, {
      queueKey: `decision:${payload.channelId}`,
      guildId: payload.guildId,
      channelId: payload.channelId,
      runAt: new Date(lastHumanAt + settleMs),
    });
    frankDebug("worker", "response_decision.rescheduled", {
      payload,
      lastHumanAt,
      settleMs,
    });
    return;
  }

  const snapshot = await buildResponseSnapshot(
    runtime,
    settings,
    client.user?.id ?? "frank",
  );

  const event: SystemEvent = {
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
  await appendFrankEvent(event);
  frankDebug("worker", "response_decision.output", {
    payload,
    decision: event.decision,
    snapshotId: snapshot?.id ?? null,
  });

  if (!snapshot) return;

  runtime.activeSnapshotId = snapshot.id;
  await saveChannelRuntime(runtime);
  const responseDecisionAt = new Date().toISOString();

  await enqueueFrankJob(
    "character_generation",
    { snapshot, responseDecisionAt },
    {
      queueKey: `generation:${snapshot.channelId}`,
      guildId: snapshot.guildId,
      channelId: snapshot.channelId,
    },
  );
}

async function handleCharacterGeneration(
  payload: CharacterGenerationJob,
  options: {
    abortSignal?: AbortSignal;
  } = {},
) {
  const settings = await getFrankGuildSettings(payload.snapshot.guildId);
  const runtime = await getChannelRuntime(
    payload.snapshot.guildId,
    payload.snapshot.channelId,
  );

  if (
    shouldSkipStaleGenerationSnapshot({
      runtime,
      snapshot: payload.snapshot,
    })
  ) {
    const nextRuntime = releasePendingSnapshot(runtime, payload.snapshot.id);
    if (nextRuntime !== runtime) {
      await saveChannelRuntime(nextRuntime);
    }
    frankDebug("worker", "character_generation.stale_snapshot", {
      channelId: payload.snapshot.channelId,
      snapshotId: payload.snapshot.id,
      snapshotCreatedAt: payload.snapshot.createdAt,
      runtime: summarizeRuntime(runtime),
    });
    return;
  }

  if (
    runtime.activeSnapshotId &&
    runtime.activeSnapshotId !== payload.snapshot.id
  ) {
    frankDebug("worker", "character_generation.superseded", {
      channelId: payload.snapshot.channelId,
      snapshotId: payload.snapshot.id,
      activeSnapshotId: runtime.activeSnapshotId,
    });
    return;
  }

  if (!runtime.activeSnapshotId) {
    runtime.activeSnapshotId = payload.snapshot.id;
    await saveChannelRuntime(runtime);
  }
  frankDebug("worker", "character_generation.input", {
    snapshot: summarizeSnapshot(payload.snapshot),
    settings,
  });

  const result = await executeStreamedBurstPlan({
    snapshot: payload.snapshot,
    typingStartedAt: payload.responseDecisionAt,
    maxBurstMessages: settings.burstResponsesEnabled
      ? settings.maxBurstMessages
      : 1,
    reactionsEnabled: settings.reactionsEnabled,
    abortSignal: options.abortSignal,
  }).catch((error) => {
    if (options.abortSignal?.aborted || isAbortLikeError(error)) {
      return {
        plan: null,
        sentMessageIds: [] as string[],
        sentMessages: [] as Array<{ id: string; text: string; createdAt: string }>,
        aborted: true,
        reason: normalizeExecutionAbortReason(
          options.abortSignal?.reason ?? error,
        ),
      };
    }
    throw error;
  });

  frankDebug("worker", "character_generation.output", {
    aborted: result.aborted,
    reason: result.reason,
    plan: summarizeBurstPlan(result.plan),
    sentMessageIds: result.sentMessageIds,
    sentMessages: result.sentMessages.map((message) => message.text),
  });

  const freshRuntime = await getChannelRuntime(
    payload.snapshot.guildId,
    payload.snapshot.channelId,
  );

  if (result.plan) {
    const event: SystemEvent = {
      type: "burst_generated",
      eventKey: `burst_generated:${payload.snapshot.id}`,
      channelId: payload.snapshot.channelId,
      snapshotId: payload.snapshot.id,
      burstPlan: result.plan,
      createdAt: new Date().toISOString(),
    };
    await appendFrankEvent(event);
  }

  if (result.aborted) {
    const remainingChunks = (result.plan?.chunks ?? [])
      .slice(result.sentMessageIds.length)
      .map((chunk) => chunk.text);
    const nextRuntime = markBurstInterrupted(
      freshRuntime,
      payload.snapshot,
      remainingChunks,
      new Date().toISOString(),
    );
    await saveChannelRuntime(nextRuntime);

    const event: SystemEvent = {
      type: "burst_aborted",
      eventKey: `burst_aborted:${payload.snapshot.id}:${Date.now()}`,
      channelId: payload.snapshot.channelId,
      snapshotId: payload.snapshot.id,
      remainingChunks,
      reason: result.reason ?? "manual_abort",
      createdAt: new Date().toISOString(),
    };
    await appendFrankEvent(event);
    return;
  }

  const nextRuntime = markBurstSent(
    freshRuntime,
    result.sentMessages,
    new Date().toISOString(),
    client.user?.id ?? "frank",
    client.user?.globalName ?? client.user?.username ?? "Frank",
    client.user?.username ?? "frank",
  );
  await saveChannelRuntime(nextRuntime);
}

async function handleMemoryExtraction(
  payload: MemoryExtractionJob,
  options: {
    abortSignal?: AbortSignal;
  } = {},
) {
  frankDebug("worker", "memory_extraction.input", payload);
  await extractMemoryFromChannel(
    payload.guildId,
    payload.channelId,
    payload.sourceEventId,
    {
      abortSignal: options.abortSignal,
    },
  );
  frankDebug("worker", "memory_extraction.output", payload);
}

function getSettleMs(
  sourceEvent: Awaited<ReturnType<typeof getFrankEventById>>,
  runtime: Awaited<ReturnType<typeof getChannelRuntime>>,
) {
  if (sourceEvent && sourceEvent.type === "message_create") {
    if (sourceEvent.mentionsBot) {
      return 250;
    }

    if (
      sourceEvent.replyToMessageId &&
      runtime.visibleMessages.some(
        (message) =>
          message.id === sourceEvent.replyToMessageId && message.fromBot,
      )
    ) {
      return 250;
    }
  }

  return FRANK_BURST_SETTLE_MS;
}
