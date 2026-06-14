import { FRANK_MAX_VISIBLE_MESSAGES } from "@/frank/constants";
import type {
  ChannelRuntimeProjection,
  DiscordEvent,
  ResponseSnapshot,
  VisibleReaction,
  VisibleMessage,
} from "@/frank/types";

export function toVisibleMessage(event: Extract<DiscordEvent, { type: "message_create" }>): VisibleMessage {
  return {
    id: event.messageId,
    authorId: event.authorId,
    authorName: event.authorName,
    authorUsername: event.authorUsername || event.authorName,
    content: event.content,
    mentionsBot: event.mentionsBot,
    repliesToBot: event.repliesToBot,
    mentionedUsers: event.mentionedUsers,
    mentionedChannels: event.mentionedChannels,
    replyToMessageId: event.replyToMessageId,
    replyPreview: event.replyPreview
      ? {
          ...event.replyPreview,
          authorUsername:
            event.replyPreview.authorUsername || event.replyPreview.authorName,
        }
      : null,
    attachments: event.attachments.map((attachment) => ({
      name: attachment.name,
      contentType: attachment.contentType,
      url: attachment.url,
    })),
    reactions: [],
    lastEdit: null,
    createdAt: event.createdAt,
    fromBot: false,
  };
}

function appendVisibleReaction(
  reactions: VisibleReaction[] | undefined,
  event: Extract<DiscordEvent, { type: "reaction_add" }>,
) {
  const nextReactions = reactions ? [...reactions] : [];
  const existingIndex = nextReactions.findIndex(
    (reaction) =>
      reaction.userId === event.userId && reaction.emoji === event.emoji,
  );
  const nextReaction: VisibleReaction = {
    userId: event.userId,
    userName: event.userName,
    userUsername: event.userUsername,
    emoji: event.emoji,
    createdAt: event.createdAt,
  };

  if (existingIndex >= 0) {
    nextReactions.splice(existingIndex, 1, nextReaction);
    return nextReactions;
  }

  nextReactions.push(nextReaction);
  return nextReactions.slice(-8);
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
        ? {
            ...message,
            content: event.newContent,
            lastEdit: {
              oldContent: event.oldContent,
              editedAt: event.editedAt,
            },
          }
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

  if (event.type === "reaction_add") {
    next.visibleMessages = next.visibleMessages.map((message) =>
      message.id === event.messageId
        ? {
            ...message,
            reactions: appendVisibleReaction(message.reactions, event),
          }
        : message,
    );
    next.lastHumanMessageAt = event.createdAt;
  }

  return next;
}

export function markBurstSent(
  runtime: ChannelRuntimeProjection,
  sentMessages: Array<{ id: string; text: string; createdAt: string }>,
  sentAt: string,
  botUserId: string,
  botName: string,
  botUsername: string,
): ChannelRuntimeProjection {
  const lastBotMessageId =
    sentMessages[sentMessages.length - 1]?.id ?? runtime.lastBotMessageId;
  const visibleMessages = [
    ...runtime.visibleMessages,
    ...sentMessages.map((message) => ({
      id: message.id,
      authorId: botUserId,
      authorName: botName,
      authorUsername: botUsername,
      content: message.text,
      mentionsBot: false,
      mentionedUsers: [],
      mentionedChannels: [],
      replyToMessageId: null,
      replyPreview: null,
      attachments: [],
      reactions: [],
      lastEdit: null,
      createdAt: message.createdAt,
      fromBot: true,
    })),
  ].slice(-FRANK_MAX_VISIBLE_MESSAGES);

  return {
    ...runtime,
    visibleMessages,
    activeJobId: null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
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
  if (runtime.activeSnapshotId && runtime.activeSnapshotId !== snapshot.id) {
    return runtime;
  }

  return {
    ...runtime,
    activeJobId: null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
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

export function releasePendingSnapshot(
  runtime: ChannelRuntimeProjection,
  snapshotId: string,
): ChannelRuntimeProjection {
  if (runtime.activeSnapshotId !== snapshotId) {
    return runtime;
  }

  return {
    ...runtime,
    activeJobId: null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
  };
}
