import { client } from "@/client";
import { FRANK_BURST_SETTLE_MS, FRANK_JOB_POLL_MS } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeBurstPlan, summarizeEvent, summarizeRuntime, summarizeSnapshot } from "@/frank/debugView";
import { executeStreamedBurstPlan, sendChannelTyping } from "@/frank/executor";
import { getFrankGuildSettings } from "@/frank/config";
import { extractMemoryFromChannel } from "@/frank/memory";
import { logError } from "@/log";
import { applyDiscordEventToRuntime, markBurstInterrupted, markBurstSent } from "@/frank/runtime";
import { buildResponseSnapshot } from "@/frank/snapshot";
import {
  appendFrankEvent,
  claimFrankJobs,
  completeFrankJob,
  enqueueFrankJob,
  failFrankJob,
  getChannelRuntime,
  getFrankEventById,
  getFrankJobPayload,
  saveChannelRuntime,
} from "@/frank/store";
import type {
  CharacterGenerationJob,
  DiscordEvent,
  MemoryExtractionJob,
  ResponseDecisionJob,
  RuntimeUpdateJob,
  SystemEvent,
} from "@/frank/types";

let workerInterval: NodeJS.Timeout | null = null;
let isTicking = false;

export function startFrankWorker() {
  if (workerInterval) return;

  workerInterval = setInterval(() => {
    void processFrankJobsOnce();
  }, FRANK_JOB_POLL_MS);

  void processFrankJobsOnce();
}

export function stopFrankWorker() {
  if (workerInterval) clearInterval(workerInterval);
  workerInterval = null;
}

export async function processFrankJobsOnce() {
  if (isTicking) return;
  isTicking = true;

  try {
    const jobs = await claimFrankJobs(6);
    for (const job of jobs) {
      try {
        frankDebug("worker", "job.start", {
          jobId: job.id,
          jobType: job.jobType,
          channelId: job.channelId,
          guildId: job.guildId,
        });
        await processFrankJob(job.id, job.jobType, getFrankJobPayload(job));
        await completeFrankJob(job.id);
        frankDebug("worker", "job.complete", {
          jobId: job.id,
          jobType: job.jobType,
        });
      } catch (error) {
        logError("worker", `Job ${job.id} failed`, error, {
          jobId: job.id,
          jobType: job.jobType,
          channelId: job.channelId,
          guildId: job.guildId,
        });
        frankDebug("worker", "job.error", {
          jobId: job.id,
          jobType: job.jobType,
          error,
        });
        await failFrankJob(job.id, error);
      }
    }
  } finally {
    isTicking = false;
  }
}

async function processFrankJob(
  jobId: number,
  jobType: string,
  payload:
    | RuntimeUpdateJob
    | ResponseDecisionJob
    | CharacterGenerationJob
    | MemoryExtractionJob,
) {
  switch (jobType) {
    case "runtime_update":
      await handleRuntimeUpdate(payload as RuntimeUpdateJob);
      return;
    case "response_decision":
      await handleResponseDecision(payload as ResponseDecisionJob);
      return;
    case "character_generation":
      await handleCharacterGeneration(payload as CharacterGenerationJob);
      return;
    case "memory_extraction":
      await handleMemoryExtraction(payload as MemoryExtractionJob);
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
  void sendChannelTyping(snapshot.channelId).catch(() => undefined);

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

async function handleCharacterGeneration(payload: CharacterGenerationJob) {
  const settings = await getFrankGuildSettings(payload.snapshot.guildId);
  const runtime = await getChannelRuntime(
    payload.snapshot.guildId,
    payload.snapshot.channelId,
  );
  runtime.activeSnapshotId = payload.snapshot.id;
  await saveChannelRuntime(runtime);
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
  }).catch((error) => {
    if (String(error).includes("aborted")) {
      return {
        plan: null,
        sentMessageIds: [] as string[],
        sentMessages: [] as Array<{ id: string; text: string; createdAt: string }>,
        aborted: true,
        reason: "manual_abort" as const,
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
    client.user?.displayName ?? client.user?.username ?? "Frank",
  );
  await saveChannelRuntime(nextRuntime);
}

async function handleMemoryExtraction(payload: MemoryExtractionJob) {
  frankDebug("worker", "memory_extraction.input", payload);
  await extractMemoryFromChannel(
    payload.guildId,
    payload.channelId,
    payload.sourceEventId,
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
