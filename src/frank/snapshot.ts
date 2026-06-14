import { frankDebug } from "@/frank/debug";
import { summarizeMessages, summarizeSnapshot } from "@/frank/debugView";
import { retrieveProfileMemory } from "@/frank/memory";
import { getLatestPendingIntentForLane } from "@/frank/queueStore";
import type {
  ChannelRuntimeProjection,
  Concern,
  ConversationLane,
  FrankGuildSettings,
  ResponseSnapshot,
  VisibleMessage,
} from "@/frank/types";
import { randomUUID } from "node:crypto";

const QUESTION_STARTERS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "did",
  "is",
  "are",
  "help",
];

function normalizeWords(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

export function isBareSummonContent(content: string) {
  const words = normalizeWords(content);
  return words.length > 0 && words.every((word) => word === "frank" || word === "botello");
}

export function resolveFocusMessages(
  runtime: ChannelRuntimeProjection,
  concern: Concern,
) {
  const byId = new Map(runtime.visibleMessages.map((message) => [message.id, message]));
  return concern.sourceMessageIds
    .map((messageId) => byId.get(messageId))
    .filter((message): message is VisibleMessage => Boolean(message));
}

function buildVisibleMessages(
  runtime: ChannelRuntimeProjection,
  focusMessages: VisibleMessage[],
  compact: boolean,
) {
  const tailCount = compact ? 6 : 16;
  const byId = new Map<string, VisibleMessage>();

  for (const message of focusMessages) {
    byId.set(message.id, message);
  }

  for (const message of runtime.visibleMessages.slice(-tailCount)) {
    if (!byId.has(message.id)) {
      byId.set(message.id, message);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function scoreAnchorMessage(
  message: VisibleMessage,
  index: number,
  lane: ConversationLane,
) {
  const content = message.content.trim().toLowerCase();
  const words = normalizeWords(content);
  const startsWithQuestion = words.length > 0 && QUESTION_STARTERS.includes(words[0]!);
  const isBareSummon = isBareSummonContent(content);

  let score = 0;
  score += Math.max(0, 40 - index * 3);
  if (message.mentionsBot) score += 120;
  if (message.repliesToBot) score += 115;
  if (content.includes("?")) score += 70;
  if (startsWithQuestion) score += 60;
  if (content.length >= 24) score += 10;
  if (lane.replyRootMessageId) score += index * 2;
  if (isBareSummon) score -= 90;
  return score;
}

export function chooseAnchorMessageId(
  focusMessages: VisibleMessage[],
  lane: ConversationLane,
) {
  let bestId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestIndex = Number.MAX_SAFE_INTEGER;

  for (const [index, message] of focusMessages.entries()) {
    const candidate = {
      id: message.id,
      score: scoreAnchorMessage(message, index, lane),
      index,
    };

    if (
      candidate.score > bestScore ||
      (candidate.score === bestScore && candidate.index < bestIndex)
    ) {
      bestId = candidate.id;
      bestScore = candidate.score;
      bestIndex = candidate.index;
    }
  }

  return bestId ?? focusMessages[0]?.id ?? null;
}

function toAttentionReason(reasonCode: Concern["reasonCode"]) {
  switch (reasonCode) {
    case "bare_summon":
      return "direct_mention" as const;
    case "message_deleted":
    case "message_edited":
      return "continuation" as const;
    default:
      return reasonCode;
  }
}

export async function buildResponseSnapshot(options: {
  runtime: ChannelRuntimeProjection;
  concern: Concern;
  lane: ConversationLane;
  settings: FrankGuildSettings;
  compact?: boolean;
}) {
  const focusMessages = resolveFocusMessages(options.runtime, options.concern);
  if (focusMessages.length === 0) {
    frankDebug("snapshot", "skipped", {
      channelId: options.runtime.channelId,
      laneKey: options.lane.laneKey,
      concernId: options.concern.id,
      reason: "no_focus_messages",
    });
    return null;
  }

  const anchorMessageId = chooseAnchorMessageId(focusMessages, options.lane);
  const pendingIntentContext = await getLatestPendingIntentForLane(
    options.concern.guildId,
    options.concern.channelId,
    options.lane.laneKey,
  );
  const memory = await retrieveProfileMemory(
    options.runtime.guildId,
    options.runtime.visibleMessages,
    {
      focusUserId: options.concern.focusAuthorId,
    },
  );

  const visibleMessages = buildVisibleMessages(
    options.runtime,
    focusMessages,
    Boolean(options.compact),
  );

  const snapshot: ResponseSnapshot = {
    id: randomUUID(),
    concernId: options.concern.id,
    laneKey: options.lane.laneKey,
    guildId: options.runtime.guildId,
    channelId: options.runtime.channelId,
    createdAt: new Date().toISOString(),
    anchorMessageId,
    focusAuthorId: options.concern.focusAuthorId,
    focusMessages,
    visibleMessages,
    pendingIntentContext,
    pendingIntent: pendingIntentContext,
    memory,
    attentionDecision: {
      shouldRespond: true,
      reason: toAttentionReason(options.concern.reasonCode),
      targetMessageId: anchorMessageId,
      opportunismScore: 1,
    },
  };

  frankDebug("snapshot", "built", {
    ...summarizeSnapshot(snapshot),
    focusMessages: summarizeMessages(focusMessages, 4),
    visibleChat: summarizeMessages(snapshot.visibleMessages),
    compact: Boolean(options.compact),
    attentionMode: options.settings.attentionMode,
  });

  return snapshot;
}
