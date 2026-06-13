import { classifyAttentionWithModel } from "@/frank/processors";
import { frankDebug } from "@/frank/debug";
import type {
  AttentionDecision,
  ChannelRuntimeProjection,
  FrankGuildSettings,
  VisibleMessage,
} from "@/frank/types";

function isReplyToBot(
  runtime: ChannelRuntimeProjection,
  message: VisibleMessage,
  settings: FrankGuildSettings,
) {
  if (!settings.allowedReplies || !message.replyToMessageId) return false;
  return message.replyToMessageId === runtime.lastBotMessageId;
}

function hasRecentBotContext(runtime: ChannelRuntimeProjection) {
  if (!runtime.lastBotSentAt) return false;
  return Date.now() - new Date(runtime.lastBotSentAt).getTime() < 2 * 60 * 1000;
}

export function decideAttention(
  runtime: ChannelRuntimeProjection,
  latestMessage: VisibleMessage | null,
  settings: FrankGuildSettings,
  botUserId: string,
): AttentionDecision {
  if (!settings.enabled || !latestMessage) {
    const decision: AttentionDecision = {
      shouldRespond: false,
      reason: "disabled",
      targetMessageId: latestMessage?.id ?? null,
      opportunismScore: 0,
    };
    frankDebug("attention", "heuristic.output", decision);
    return decision;
  }

  const directMention = settings.allowedMentions && latestMessage.mentionsBot;

  if (directMention) {
    const decision: AttentionDecision = {
      shouldRespond: true,
      reason: "direct_mention",
      targetMessageId: latestMessage.id,
      opportunismScore: 1,
    };
    frankDebug("attention", "heuristic.output", {
      input: {
        latestMessageId: latestMessage.id,
        content: latestMessage.content,
        mentionsBot: latestMessage.mentionsBot,
      },
      decision,
    });
    return decision;
  }

  if (isReplyToBot(runtime, latestMessage, settings)) {
    const decision: AttentionDecision = {
      shouldRespond: true,
      reason: "reply_to_bot",
      targetMessageId: latestMessage.id,
      opportunismScore: 1,
    };
    frankDebug("attention", "heuristic.output", {
      input: {
        latestMessageId: latestMessage.id,
        replyToMessageId: latestMessage.replyToMessageId,
        lastBotMessageId: runtime.lastBotMessageId,
      },
      decision,
    });
    return decision;
  }

  if (
    hasRecentBotContext(runtime) &&
    latestMessage.authorId !== botUserId &&
    runtime.visibleMessages
      .slice(-4)
      .some((message) => message.authorId === botUserId)
  ) {
    const decision: AttentionDecision = {
      shouldRespond: true,
      reason: "continuation",
      targetMessageId: latestMessage.id,
      opportunismScore: 0.8,
    };
    frankDebug("attention", "heuristic.output", {
      input: {
        latestMessageId: latestMessage.id,
        content: latestMessage.content,
        recentVisibleMessages: runtime.visibleMessages.slice(-4),
      },
      decision,
    });
    return decision;
  }

  if (
    settings.cooldownSeconds > 0 &&
    runtime.lastBotSentAt &&
    Date.now() - new Date(runtime.lastBotSentAt).getTime() <
      settings.cooldownSeconds * 1_000
  ) {
    const decision: AttentionDecision = {
      shouldRespond: false,
      reason: "cooldown",
      targetMessageId: latestMessage.id,
      opportunismScore: 0,
    };
    frankDebug("attention", "heuristic.output", {
      input: {
        latestMessageId: latestMessage.id,
        content: latestMessage.content,
      },
      decision,
    });
    return decision;
  }
  const decision: AttentionDecision = {
    shouldRespond: false,
    reason: "insufficient_signal",
    targetMessageId: latestMessage.id,
    opportunismScore: 0,
  };
  frankDebug("attention", "heuristic.output", {
    input: {
      latestMessageId: latestMessage.id,
      content: latestMessage.content,
    },
    decision,
  });
  return decision;
}

export async function decideAttentionWithClassifier(
  runtime: ChannelRuntimeProjection,
  latestMessage: VisibleMessage | null,
  settings: FrankGuildSettings,
  botUserId: string,
): Promise<AttentionDecision> {
  const baseDecision = decideAttention(
    runtime,
    latestMessage,
    settings,
    botUserId,
  );

  if (
    !latestMessage ||
    baseDecision.reason === "direct_mention" ||
    baseDecision.reason === "reply_to_bot" ||
    baseDecision.reason === "continuation" ||
    baseDecision.reason === "cooldown" ||
    baseDecision.reason === "disabled"
  ) {
    return baseDecision;
  }

  const modelDecision = await classifyAttentionWithModel(
    runtime,
    latestMessage,
    settings,
  );

  const decision = modelDecision ?? baseDecision;
  frankDebug("attention", "final.output", {
    baseDecision,
    modelDecision,
    decision,
  });
  return decision;
}
