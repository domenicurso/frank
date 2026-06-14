import { renderVisibleMessage } from "@/frank/messageContext";
import type {
  BurstPlan,
  ChannelRuntimeProjection,
  MemoryEvidence,
  PersistedEvent,
  ResponseSnapshot,
  VisibleMessage,
} from "@/frank/types";

function truncate(value: string, max = 72) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function summarizeMessages(messages: VisibleMessage[], limit = 6) {
  const visible = messages.slice(-limit);
  return visible.map((message) => {
    const flags = [
      message.mentionsBot ? "@frank" : null,
      message.replyToMessageId ? "reply" : null,
      message.fromBot ? "bot" : null,
    ].filter(Boolean);

    const rendered = renderVisibleMessage(message, messages);
    const singleLine = rendered.replace(/\s*\n\s*/g, " / ");
    return `${truncate(singleLine)}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
  });
}

export function summarizeRuntime(runtime: ChannelRuntimeProjection) {
  return {
    guildId: runtime.guildId,
    channelId: runtime.channelId,
    lastBotMessageId: runtime.lastBotMessageId,
    lastBotSentAt: runtime.lastBotSentAt,
    lastHumanMessageAt: runtime.lastHumanMessageAt,
    activeIntentId: runtime.activeIntentId,
    activeIntentRevision: runtime.activeIntentRevision,
    activeSnapshotId: runtime.activeSnapshotId,
    pendingIntentChunks: runtime.pendingIntent?.remainingChunks.length ?? 0,
    visibleMessageCount: runtime.visibleMessages.length,
    recentMessages: summarizeMessages(runtime.visibleMessages),
  };
}

export function summarizeEvent(event: PersistedEvent | null | undefined) {
  if (!event) return null;

  if ("messageId" in event) {
    return {
      type: event.type,
      channelId: event.channelId,
      messageId: event.messageId,
      authorId: "authorId" in event ? event.authorId : null,
      content:
        "content" in event ? truncate(event.content, 96) : undefined,
      mentionsBot: "mentionsBot" in event ? event.mentionsBot : undefined,
      replyToMessageId:
        "replyToMessageId" in event ? event.replyToMessageId : undefined,
    };
  }

  return {
    type: event.type,
    channelId: "channelId" in event ? event.channelId : undefined,
    eventKey: event.eventKey,
  };
}

export function summarizeSnapshot(snapshot: ResponseSnapshot) {
  return {
    snapshotId: snapshot.id,
    guildId: snapshot.guildId,
    channelId: snapshot.channelId,
    anchorMessageId: snapshot.anchorMessageId,
    attentionReason: snapshot.attentionDecision.reason,
    opportunismScore: snapshot.attentionDecision.opportunismScore,
    pendingIntentChunks: snapshot.pendingIntent?.remainingChunks.length ?? 0,
    memory: snapshot.memory.map(
      (item) => `${item.subject}: ${truncate(item.summary, 100)}`,
    ),
    visibleMessageCount: snapshot.visibleMessages.length,
    visibleChat: summarizeMessages(snapshot.visibleMessages),
  };
}

export function summarizeBurstPlan(plan: BurstPlan | null | undefined) {
  if (!plan) return null;

  return {
    chunkCount: plan.chunks.length,
    reactionEmoji: plan.reactionEmoji ?? null,
    chunks: plan.chunks.map((chunk, index) => {
      const pause = chunk.pauseMs ? ` (${chunk.pauseMs}ms pause)` : "";
      return `${index + 1}. ${truncate(chunk.text, 96)}${pause}`;
    }),
  };
}

export function summarizeEvidence(evidence: MemoryEvidence[], limit = 6) {
  return evidence.slice(0, limit).map((item) => ({
    category: item.category,
    key: item.key,
    salience: Number(item.salience.toFixed(2)),
    confidence: Number(item.confidence.toFixed(2)),
    pinned: item.pinned,
    content: truncate(item.content, 96),
  }));
}

export function summarizePartialPlan(plan: BurstPlan) {
  const lastChunk = plan.chunks[plan.chunks.length - 1];

  return {
    chunkCount: plan.chunks.length,
    reactionEmoji: plan.reactionEmoji ?? null,
    finalizedChunks: plan.chunks
      .slice(0, -1)
      .map((chunk, index) => `${index + 1}. ${truncate(chunk.text, 80)}`),
    inFlightChunk: lastChunk ? truncate(lastChunk.text, 96) : null,
  };
}

export function shouldLogPartialPlan(
  previous: BurstPlan,
  next: BurstPlan,
  previousLoggedLength: number,
) {
  if (next.chunks.length === 0 && !next.reactionEmoji) {
    return { shouldLog: false, nextLoggedLength: previousLoggedLength };
  }

  if (
    previous.chunks.length !== next.chunks.length ||
    previous.reactionEmoji !== next.reactionEmoji
  ) {
    return {
      shouldLog: true,
      nextLoggedLength: next.chunks[next.chunks.length - 1]?.text.length ?? 0,
    };
  }

  const previousLast = previous.chunks[previous.chunks.length - 1]?.text ?? "";
  const nextLast = next.chunks[next.chunks.length - 1]?.text ?? "";
  const lengthDelta = nextLast.length - previousLoggedLength;
  const hitBoundary = /[.!?\n]$/.test(nextLast);

  return {
    shouldLog: nextLast.length > 0 && (lengthDelta >= 14 || hitBoundary),
    nextLoggedLength: nextLast.length,
  };
}
