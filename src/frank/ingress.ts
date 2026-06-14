import { client } from "@/client";
import { FRANK_MEMORY_DEBOUNCE_MS } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import {
  getPendingUnsentExecutionContext,
  interruptChannelExecution,
} from "@/frank/executor";
import { getIncomingMessageInterruptReason } from "@/frank/ingressPolicy";
import { getFrankGuildSettings, isFrankChannelAllowed } from "@/frank/config";
import {
  getActiveIntentForChannel,
  supersedeActiveIntent,
  upsertQueueItem,
} from "@/frank/queueStore";
import {
  appendFrankEvent,
  getFrankEventById,
} from "@/frank/store";
import type { DiscordEvent } from "@/frank/types";
import type {
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";

function normalizeWords(input: string) {
  const words: string[] = [];
  let current = "";

  for (const char of input.toLowerCase()) {
    const isAlphaNumeric =
      (char >= "a" && char <= "z") || (char >= "0" && char <= "9");

    if (isAlphaNumeric) {
      current += char;
    } else if (current) {
      words.push(current);
      current = "";
    }
  }

  if (current) {
    words.push(current);
  }

  return words;
}

function hasDirectNameMention(message: Message) {
  const botUser = client.user;
  if (!botUser) return false;

  const words = normalizeWords(message.content);
  const fullContent = words.join(" ");
  const names = [
    botUser.username,
    botUser.displayName,
    botUser.globalName,
    "frank",
    "frank botello",
  ]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

  for (const name of names) {
    const normalized = normalizeWords(name).join(" ");
    if (!normalized) continue;

    if (normalized.includes(" ")) {
      if (fullContent.includes(normalized)) {
        return true;
      }
      continue;
    }

    if (words.includes(normalized)) {
      return true;
    }
  }

  return false;
}

function collectMentionedUsers(message: Message) {
  return [...message.mentions.users.values()].map((user) => ({
    id: user.id,
    username: user.username,
    displayName:
      message.mentions.members?.get(user.id)?.displayName ||
      user.globalName ||
      user.username,
  }));
}

function collectMentionedChannels(message: Message) {
  return [...message.mentions.channels.values()].map((channel) => ({
    id: channel.id,
    name: "name" in channel && typeof channel.name === "string"
      ? channel.name
      : channel.id,
  }));
}

function collectReplyPreview(message: Message) {
  const replyToMessageId = message.reference?.messageId;
  if (!replyToMessageId || !("messages" in message.channel)) {
    return null;
  }

  const replied = message.channel.messages.cache.get(replyToMessageId);
  if (!replied) {
    return null;
  }

  return {
    authorName: replied.member?.displayName || replied.author.username,
    authorUsername: replied.author.username,
    content: replied.content,
  };
}

function collectMediaAttachments(message: Message) {
  const media = [...message.attachments.values()].map((attachment) => ({
    name: attachment.name ?? "attachment",
    url: attachment.url,
    contentType: attachment.contentType ?? "unknown",
  }));

  for (const [index, embed] of message.embeds.entries()) {
    const imageUrl = embed.image?.url ?? embed.thumbnail?.url ?? null;
    if (imageUrl) {
      media.push({
        name: embed.title || `embed-image-${index + 1}`,
        url: imageUrl,
        contentType: guessMediaTypeFromUrl(imageUrl),
      });
    }

    const videoUrl = embed.video?.url ?? null;
    if (videoUrl) {
      media.push({
        name: embed.title || `embed-video-${index + 1}`,
        url: videoUrl,
        contentType: guessMediaTypeFromUrl(videoUrl),
      });
    }
  }

  const byUrl = new Map<string, (typeof media)[number]>();
  for (const item of media) {
    byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

function guessMediaTypeFromUrl(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".mp4")) return "video/mp4";
  return "unknown";
}

async function getInterruptReasonForMessage(
  message: Message,
  mentionsBot: boolean,
) {
  let pendingUnsentExecution = getPendingUnsentExecutionContext(message.channel.id);

  if (!pendingUnsentExecution) {
    const { intent } = await getActiveIntentForChannel(
      message.guild!.id,
      message.channel.id,
    );
    if (intent && (intent.status === "pending" || intent.status === "generating")) {
      const sourceEvent = await getFrankEventById(intent.sourceEventId);
      pendingUnsentExecution = {
        latestAuthorId:
          sourceEvent && "authorId" in sourceEvent ? sourceEvent.authorId : null,
        anchorMessageId: intent.snapshot.anchorMessageId,
        snapshotId: intent.snapshotId,
      };
    }
  }

  return getIncomingMessageInterruptReason({
    authorId: message.author.id,
    mentionsBot,
    repliesToBot: message.mentions.repliedUser?.id === client.user?.id,
    pendingUnsentExecution,
  });
}

function shouldScheduleMemoryExtraction(
  message: Message,
  mentionsBot: boolean,
) {
  if (message.attachments.size > 0) return true;

  const content = message.content.trim().toLowerCase();
  if (!content) return false;

  const words = normalizeWords(content);
  if (words.length <= 2 && content.length < 14) {
    return false;
  }

  const lowSignalPhrases = new Set([
    "ok",
    "okay",
    "k",
    "kk",
    "lol",
    "lmao",
    "lmfao",
    "bruh",
    "what",
    "duh",
    "yeah",
    "yep",
    "nah",
    "no",
    "sure",
    "word",
    "true",
  ]);

  if (lowSignalPhrases.has(content)) {
    return false;
  }

  if (mentionsBot && content.length >= 14) {
    return true;
  }

  if (message.mentions.repliedUser?.id === client.user?.id) {
    return true;
  }

  const memorySignalWords = new Set([
    "i",
    "im",
    "ive",
    "my",
    "me",
    "we",
    "our",
    "project",
    "finals",
    "exam",
    "midterm",
    "school",
    "class",
    "study",
    "studying",
    "week",
    "today",
    "tomorrow",
    "job",
    "work",
    "working",
    "building",
    "making",
    "like",
    "love",
    "hate",
    "prefer",
    "want",
    "need",
  ]);

  return words.some((word) => memorySignalWords.has(word));
}

export async function ingestMessageCreate(message: Message) {
  if (!message.guild || message.author.bot || !message.channel.isTextBased()) return;

  const settings = await getFrankGuildSettings(message.guild.id);
  if (!settings.enabled) return;
  if (!(await isFrankChannelAllowed(message.guild.id, message.channel.id))) return;
  const mentionsBot =
    message.mentions.users.has(client.user?.id ?? "") || hasDirectNameMention(message);
  const shouldExtractMemory = shouldScheduleMemoryExtraction(message, mentionsBot);
  const interruptReason = await getInterruptReasonForMessage(message, mentionsBot);
  const mentionedUsers = collectMentionedUsers(message);
  const mentionedChannels = collectMentionedChannels(message);
  const replyPreview = collectReplyPreview(message);
  const attachments = collectMediaAttachments(message);

  const event: DiscordEvent = {
    type: "message_create",
    eventKey: `message_create:${message.id}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName || message.author.username,
    authorUsername: message.author.username,
    content: message.content,
    mentionsBot,
    mentionsUserIds: [...message.mentions.users.keys()],
    mentionedUsers,
    mentionedChannels,
    replyToMessageId: message.reference?.messageId ?? null,
    replyPreview,
    createdAt: message.createdAt.toISOString(),
    attachments,
  };

  frankDebug("ingress", "message_create.input", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    content: message.content,
    mentionsBot,
    mentionedUsers,
    mentionedChannels,
    replyToMessageId: message.reference?.messageId ?? null,
    replyPreview,
  });

  const eventId = await appendFrankEvent(event);
  if (interruptReason) {
    interruptChannelExecution(message.channel.id, interruptReason);
    await supersedeActiveIntent({
      guildId: message.guild.id,
      channelId: message.channel.id,
      reason: interruptReason,
    });
  }

  await upsertQueueItem("runtime_update", { eventId }, {
    dedupeKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    availableAt: new Date(),
  });
  if (shouldExtractMemory) {
    await upsertQueueItem(
      "memory_extraction",
      {
        guildId: message.guild.id,
        channelId: message.channel.id,
        sourceEventId: eventId,
      },
      {
        dedupeKey: `memory:${message.channel.id}`,
        guildId: message.guild.id,
        channelId: message.channel.id,
        availableAt: new Date(Date.now() + FRANK_MEMORY_DEBOUNCE_MS),
      },
    );
  }

  frankDebug("ingress", "message_create.output", {
    eventId,
    interruptReason,
    scheduledJobs: [
      "runtime_update",
      ...(shouldExtractMemory ? ["memory_extraction"] : []),
    ],
  });
}

export async function ingestMessageUpdate(
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  if (!newMessage.guild || !newMessage.channel?.isTextBased()) return;
  if (
    !(await isFrankChannelAllowed(newMessage.guild.id, newMessage.channel.id))
  ) {
    return;
  }

  const event: DiscordEvent = {
    type: "message_update",
    eventKey: `message_update:${newMessage.id}:${Date.now()}`,
    guildId: newMessage.guild.id,
    channelId: newMessage.channel.id,
    messageId: newMessage.id,
    oldContent: "content" in oldMessage ? oldMessage.content ?? null : null,
    newContent: newMessage.content ?? "",
    editedAt: new Date().toISOString(),
  };

  frankDebug("ingress", "message_update.input", {
    guildId: newMessage.guild.id,
    channelId: newMessage.channel.id,
    messageId: newMessage.id,
    oldContent: "content" in oldMessage ? oldMessage.content ?? null : null,
    newContent: newMessage.content ?? "",
  });

  const eventId = await appendFrankEvent(event);
  interruptChannelExecution(newMessage.channel.id, "message_edited");
  await supersedeActiveIntent({
    guildId: newMessage.guild.id,
    channelId: newMessage.channel.id,
    reason: "message_edited",
  });
  await upsertQueueItem("runtime_update", { eventId }, {
    dedupeKey: `runtime:${eventId}`,
    guildId: newMessage.guild.id,
    channelId: newMessage.channel.id,
    availableAt: new Date(),
  });

  frankDebug("ingress", "message_update.output", { eventId });
}

export async function ingestMessageDelete(message: Message | PartialMessage) {
  if (!message.guild || !message.channel?.isTextBased()) return;
  if (!(await isFrankChannelAllowed(message.guild.id, message.channel.id))) return;

  const event: DiscordEvent = {
    type: "message_delete",
    eventKey: `message_delete:${message.id}:${Date.now()}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author?.id ?? null,
    deletedAt: new Date().toISOString(),
  };

  frankDebug("ingress", "message_delete.input", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author?.id ?? null,
  });

  const eventId = await appendFrankEvent(event);
  interruptChannelExecution(message.channel.id, "message_deleted");
  await supersedeActiveIntent({
    guildId: message.guild.id,
    channelId: message.channel.id,
    reason: "message_deleted",
  });
  await upsertQueueItem("runtime_update", { eventId }, {
    dedupeKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    availableAt: new Date(),
  });

  frankDebug("ingress", "message_delete.output", { eventId });
}

export async function ingestReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  const message = reaction.message;
  if (!message.guild || !message.channel?.isTextBased() || user.bot) return;
  if (!(await isFrankChannelAllowed(message.guild.id, message.channel.id))) return;

  const event: DiscordEvent = {
    type: "reaction_add",
    eventKey: `reaction_add:${message.id}:${user.id}:${Date.now()}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    userId: user.id,
    emoji: reaction.emoji.name ?? reaction.emoji.toString(),
    createdAt: new Date().toISOString(),
  };

  frankDebug("ingress", "reaction_add.input", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    userId: user.id,
    emoji: event.emoji,
  });

  const eventId = await appendFrankEvent(event);
  await upsertQueueItem("runtime_update", { eventId }, {
    dedupeKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    availableAt: new Date(),
  });

  frankDebug("ingress", "reaction_add.output", { eventId });
}
