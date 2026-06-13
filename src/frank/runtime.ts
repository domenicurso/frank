import { FRANK_MAX_VISIBLE_MESSAGES } from "@/frank/constants";
import type {
  ChannelRuntimeProjection,
  DiscordEvent,
  ResponseSnapshot,
  VisibleMessage,
} from "@/frank/types";

export function toVisibleMessage(event: Extract<DiscordEvent, { type: "message_create" }>): VisibleMessage {
  return {
    id: event.messageId,
    authorId: event.authorId,
    authorName: event.authorName,
    content: event.content,
    mentionsBot: event.mentionsBot,
    replyToMessageId: event.replyToMessageId,
    createdAt: event.createdAt,
    fromBot: false,
  };
}

export function applyDiscordEventToRuntime(
  runtime: ChannelRuntimeProjection,
  event: DiscordEvent,
): ChannelRuntimeProjection {
  if (runtime.recentEventIds.includes(event.eventKey)) {
    return runtime;
  }

  const next: ChannelRuntimeProjection = {
    ...runtime,
    recentEventIds: [...runtime.recentEventIds, event.eventKey].slice(-60),
    visibleMessages: [...runtime.visibleMessages],
  };

  if (event.type === "message_create") {
    next.visibleMessages.push(toVisibleMessage(event));
    next.visibleMessages = next.visibleMessages.slice(-FRANK_MAX_VISIBLE_MESSAGES);
    next.lastHumanMessageAt = event.createdAt;
    if (event.mentionsBot) {
      next.lastMentionAt = event.createdAt;
    }
  }

  if (event.type === "message_update") {
    next.visibleMessages = next.visibleMessages.map((message) =>
      message.id === event.messageId
        ? { ...message, content: event.newContent }
        : message,
    );
  }

  if (event.type === "message_delete") {
    next.visibleMessages = next.visibleMessages.filter(
      (message) => message.id !== event.messageId,
    );
    if (next.lastBotMessageId === event.messageId) {
      next.lastBotMessageId = null;
    }
  }

  return next;
}

export function markBurstSent(
  runtime: ChannelRuntimeProjection,
  sentMessages: Array<{ id: string; text: string; createdAt: string }>,
  sentAt: string,
  botUserId: string,
  botName: string,
): ChannelRuntimeProjection {
  const lastBotMessageId =
    sentMessages[sentMessages.length - 1]?.id ?? runtime.lastBotMessageId;
  const visibleMessages = [
    ...runtime.visibleMessages,
    ...sentMessages.map((message) => ({
      id: message.id,
      authorId: botUserId,
      authorName: botName,
      content: message.text,
      mentionsBot: false,
      replyToMessageId: null,
      createdAt: message.createdAt,
      fromBot: true,
    })),
  ].slice(-FRANK_MAX_VISIBLE_MESSAGES);

  return {
    ...runtime,
    visibleMessages,
    activeJobId: null,
    activeSnapshotId: null,
    pendingIntent: null,
    lastBotMessageId,
    lastBotSentAt: sentAt,
  };
}

export function markBurstInterrupted(
  runtime: ChannelRuntimeProjection,
  snapshot: ResponseSnapshot,
  remainingChunks: string[],
  interruptedAt: string,
): ChannelRuntimeProjection {
  return {
    ...runtime,
    activeJobId: null,
    activeSnapshotId: null,
    pendingIntent:
      remainingChunks.length > 0
        ? {
            snapshotId: snapshot.id,
            anchorMessageId: snapshot.anchorMessageId,
            interruptedAt,
            remainingChunks,
          }
        : null,
  };
}
