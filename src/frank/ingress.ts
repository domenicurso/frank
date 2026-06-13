import { client } from "@/client";
import {
  FRANK_BURST_SETTLE_MS,
  FRANK_MEMORY_DEBOUNCE_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { interruptChannelExecution } from "@/frank/executor";
import { getFrankGuildSettings, isFrankChannelAllowed } from "@/frank/config";
import { appendFrankEvent, enqueueFrankJob } from "@/frank/store";
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

function getIngressSettleMs(message: Message, mentionsBot: boolean) {
  if (mentionsBot) {
    return 250;
  }

  if (message.mentions.repliedUser?.id === client.user?.id) {
    return 250;
  }

  return FRANK_BURST_SETTLE_MS;
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
  const settleMs = getIngressSettleMs(message, mentionsBot);
  const shouldExtractMemory = shouldScheduleMemoryExtraction(message, mentionsBot);

  const event: DiscordEvent = {
    type: "message_create",
    eventKey: `message_create:${message.id}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName || message.author.username,
    content: message.content,
    mentionsBot,
    mentionsUserIds: [...message.mentions.users.keys()],
    replyToMessageId: message.reference?.messageId ?? null,
    createdAt: message.createdAt.toISOString(),
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name ?? "attachment",
      url: attachment.url,
      contentType: attachment.contentType ?? "unknown",
    })),
  };

  frankDebug("ingress", "message_create.input", {
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    content: message.content,
    mentionsBot,
    replyToMessageId: message.reference?.messageId ?? null,
  });

  const eventId = await appendFrankEvent(event);
  interruptChannelExecution(message.channel.id, "new_direct_message");

  await enqueueFrankJob("runtime_update", { eventId }, {
    queueKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
  });
  await enqueueFrankJob(
    "response_decision",
    {
      guildId: message.guild.id,
      channelId: message.channel.id,
      sourceEventId: eventId,
    },
    {
      queueKey: `decision:${message.channel.id}`,
      guildId: message.guild.id,
      channelId: message.channel.id,
      runAt: new Date(Date.now() + settleMs),
    },
  );
  if (shouldExtractMemory) {
    await enqueueFrankJob(
      "memory_extraction",
      {
        guildId: message.guild.id,
        channelId: message.channel.id,
        sourceEventId: eventId,
      },
      {
        queueKey: `memory:${message.channel.id}`,
        guildId: message.guild.id,
        channelId: message.channel.id,
        runAt: new Date(Date.now() + FRANK_MEMORY_DEBOUNCE_MS),
      },
    );
  }

  frankDebug("ingress", "message_create.output", {
    eventId,
    scheduledJobs: [
      "runtime_update",
      "response_decision",
      ...(shouldExtractMemory ? ["memory_extraction"] : []),
    ],
    settleMs,
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
  await enqueueFrankJob("runtime_update", { eventId }, {
    queueKey: `runtime:${eventId}`,
    guildId: newMessage.guild.id,
    channelId: newMessage.channel.id,
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
  await enqueueFrankJob("runtime_update", { eventId }, {
    queueKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
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
  await enqueueFrankJob("runtime_update", { eventId }, {
    queueKey: `runtime:${eventId}`,
    guildId: message.guild.id,
    channelId: message.channel.id,
  });

  frankDebug("ingress", "reaction_add.output", { eventId });
}
