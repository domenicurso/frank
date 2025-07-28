import { client } from "@/client";
import { generateAIResponse } from "@/utils/aiResponse";
import { CooldownManager } from "@/utils/cooldown";
import type { Message, TextChannel } from "discord.js";
import { Events } from "discord.js";

export const name = "AIController";
export const type = Events.MessageCreate;

// Rate limiting and cooldown management
const channelActivity = new Map<
  string,
  { lastMessage: number; messageCount: number }
>();
const processingMessages = new Set<string>();

// Configuration
const CONFIG = {
  // Cooldown periods (in milliseconds)
  USER_COOLDOWN: 10 * 1000, // Seconds between responses to same user
  CHANNEL_COOLDOWN: 4 * 1000, // Seconds between any responses in channel

  // Response probability weights
  MENTION_WEIGHT: 100 / 100, // Always respond to mentions
  REPLY_WEIGHT: 100 / 100, // Always respond to replies
  CONVERSATION_WEIGHT: 5 / 100, // Chance in active conversation
  RANDOM_WEIGHT: 1 / 100, // Random chance

  // Activity thresholds
  ACTIVE_CONVERSATION_THRESHOLD: 3, // Messages in timeframe
  ACTIVITY_WINDOW: 5 * 60 * 1000, // Timeframe for activity

  // Message chunking
  MAX_CHUNK_LENGTH: 1800, // Leave room for Discord's 2000 limit
  TYPING_SPEED: 40, // Characters per second
  MIN_TYPING_TIME: 1 * 1000, // Minimum typing time
  MAX_TYPING_TIME: 6 * 1000, // Maximum typing time
};

/**
 * Checks if the bot is mentioned in various ways (pings, names, etc.)
 */
function isBotMentioned(message: Message): boolean {
  const botUser = client.user;
  if (!botUser) return false;

  const content = message.content.toLowerCase();

  // Check for direct user mentions
  if (message.mentions.users.has(botUser.id)) {
    return true;
  }

  // Get bot names and variations
  const username = botUser.username.toLowerCase();
  const displayName = botUser.displayName?.toLowerCase() || "";
  const globalName = botUser.globalName?.toLowerCase() || "";

  // Split names into parts for individual checking
  const usernameParts = username
    .split(/[\s\-_\.]+/)
    .filter((part) => part.length > 2);
  const displayNameParts = displayName
    .split(/[\s\-_\.]+/)
    .filter((part) => part.length > 2);
  const globalNameParts = globalName
    .split(/[\s\-_\.]+/)
    .filter((part) => part.length > 2);

  // Combine all name variations
  const namesToCheck = [
    username,
    displayName,
    globalName,
    ...usernameParts,
    ...displayNameParts,
    ...globalNameParts,
  ].filter((name) => name && name.length > 2); // Only check names longer than 2 chars

  // Check each name variation
  for (const name of namesToCheck) {
    // Direct match
    if (content.includes(name)) {
      return true;
    }

    // Check with word boundaries to avoid false positives
    const wordBoundaryRegex = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (wordBoundaryRegex.test(content)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates intelligent response probability based on context
 */
function calculateResponseProbability(
  message: Message,
  isMentioned: boolean,
  isReplyToBot: boolean,
): number {
  if (isMentioned) return CONFIG.MENTION_WEIGHT;
  if (isReplyToBot) return CONFIG.REPLY_WEIGHT;

  // Check conversation activity BEFORE updating it
  const channelId = message.channel.id;
  const activity = channelActivity.get(channelId);

  if (activity) {
    const timeSinceLastMessage = Date.now() - activity.lastMessage;
    const isActiveConversation =
      timeSinceLastMessage < CONFIG.ACTIVITY_WINDOW &&
      activity.messageCount >= CONFIG.ACTIVE_CONVERSATION_THRESHOLD;

    if (isActiveConversation) {
      return CONFIG.CONVERSATION_WEIGHT;
    }
  }

  return CONFIG.RANDOM_WEIGHT;
}

/**
 * Updates channel activity tracking
 */
function updateChannelActivity(message: Message) {
  const channelId = message.channel.id;
  const now = Date.now();
  const activity = channelActivity.get(channelId);

  if (activity && now - activity.lastMessage < CONFIG.ACTIVITY_WINDOW) {
    activity.messageCount++;
    activity.lastMessage = now;
  } else {
    channelActivity.set(channelId, { lastMessage: now, messageCount: 1 });
  }
}

/**
 * Checks if user or channel is on cooldown
 */
async function isOnCooldown(message: Message): Promise<boolean> {
  const userId = message.author.id;
  const channelId = message.channel.id;

  // Check user cooldown
  const userCooldown = await CooldownManager.checkUserCooldown(
    userId,
    "ai_response",
  );
  if (userCooldown.onCooldown) {
    return true;
  }

  // Check channel cooldown (less strict)
  const channelCooldown = await CooldownManager.checkChannelCooldown(
    channelId,
    "ai_response",
  );
  if (channelCooldown.onCooldown) {
    return true;
  }

  return false;
}

/**
 * Sets cooldown for user and channel
 */
async function setCooldown(message: Message) {
  const userId = message.author.id;
  const channelId = message.channel.id;

  // Set user cooldown
  await CooldownManager.setUserCooldown(
    userId,
    "ai_response",
    CONFIG.USER_COOLDOWN,
  );

  // Set channel cooldown
  await CooldownManager.setChannelCooldown(
    channelId,
    "ai_response",
    CONFIG.CHANNEL_COOLDOWN,
  );
}

/**
 * Intelligently chunks response text for better UX - prioritizes natural line breaks
 */
function chunkResponse(text: string): string[] {
  // First, split on double line breaks (clear paragraph breaks)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    // If paragraph fits in one chunk, use it as-is
    if (paragraph.length <= CONFIG.MAX_CHUNK_LENGTH) {
      chunks.push(paragraph.trim());
      continue;
    }

    // Split on single line breaks for burst effect
    const lines = paragraph.split("\n").filter((l) => l.trim().length > 0);
    let currentChunk = "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      // If adding this line would exceed limit, start new chunk
      if (
        currentChunk &&
        currentChunk.length + trimmedLine.length + 1 > CONFIG.MAX_CHUNK_LENGTH
      ) {
        chunks.push(currentChunk.trim());
        currentChunk = trimmedLine;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + trimmedLine;
      }
    }

    // Add remaining content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  }

  // Fallback: if we only got one chunk but original had line breaks, force split on lines
  if (chunks.length <= 1 && text.includes("\n")) {
    const allLines = text.split("\n").filter((l) => l.trim().length > 0);
    return allLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Calculates realistic typing time based on message length
 */
function calculateTypingTime(text: string): number {
  const baseTime = Math.max(
    CONFIG.MIN_TYPING_TIME,
    Math.min(
      CONFIG.MAX_TYPING_TIME,
      text.length * (1000 / CONFIG.TYPING_SPEED),
    ),
  );

  // Add some randomness for realism (±20%)
  const variance = baseTime * 0.2;
  return baseTime + (Math.random() - 0.5) * variance;
}

/**
 * Sends response with improved UX (chunking, typing indicators, realistic delays)
 */
async function sendResponse(
  message: Message,
  response: string,
  startTime: number,
) {
  const channel = message.channel as TextChannel;
  const chunks = chunkResponse(response);

  if (chunks.length === 0) {
    await message.reply("I don't have anything to say right now.");
    return;
  }

  const diffFromStart = Date.now() - startTime;

  // Send first chunk as a reply
  await channel.sendTyping();
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.max(calculateTypingTime(chunks[0]!) - diffFromStart, 0),
    ),
  );
  await message.reply(chunks[0]!);

  // Send remaining chunks as follow-up messages
  for (let i = 1; i < chunks.length; i++) {
    await channel.sendTyping();
    await new Promise((resolve) =>
      setTimeout(resolve, calculateTypingTime(chunks[i]!)),
    );
    await channel.send(chunks[i]!);
  }
}

export async function execute(message: Message) {
  try {
    // Ignore messages sent by bots
    if (message.author.bot) return;

    // Only process text-based channels
    if (!message.channel.isTextBased()) return;

    // Prevent duplicate processing
    const messageKey = `${message.id}_${message.author.id}`;
    if (processingMessages.has(messageKey)) return;

    // Check if the bot is mentioned in various ways
    const isMentioned = isBotMentioned(message);
    const isReplyToBot = await (async () => {
      if (!message.reference?.messageId) return false;
      try {
        const repliedMessage = await message.channel.messages.fetch(
          message.reference.messageId,
        );
        return repliedMessage?.author.id === client.user?.id;
      } catch {
        return false;
      }
    })();

    // Update activity tracking FIRST so current message counts
    updateChannelActivity(message);

    // Calculate response probability AFTER updating activity
    const responseProbability = calculateResponseProbability(
      message,
      isMentioned,
      isReplyToBot,
    );
    const shouldRespond = Math.random() < responseProbability;

    if (!shouldRespond) return;

    // Check cooldowns (but allow mentions and replies to override)
    if (!isMentioned && !isReplyToBot && (await isOnCooldown(message))) return;

    // Mark as processing
    processingMessages.add(messageKey);

    try {
      const channel = message.channel as TextChannel;
      await channel.sendTyping();

      // track start time
      const startTime = Date.now();

      // Generate AI response
      const response = await generateAIResponse(message);

      if (!response || response.trim().length === 0) {
        await message.reply(
          "I'm having trouble thinking of what to say right now.",
        );
        return;
      }

      // Send response with improved UX
      await sendResponse(message, response, startTime);

      // Set cooldowns
      await setCooldown(message);
    } finally {
      // Always remove from processing set
      processingMessages.delete(messageKey);
    }
  } catch (error) {
    console.error("Error in AI controller:", error);

    // Clean up processing state
    const messageKey = `${message.id}_${message.author.id}`;
    processingMessages.delete(messageKey);

    // Send user-friendly error message for critical failures
    if (message.channel.isTextBased()) {
      try {
        await message.reply(
          "I'm experiencing some technical difficulties. Please try again later.",
        );
      } catch (replyError) {
        console.error("Failed to send error message:", replyError);
      }
    }
  }
}

// Cleanup old activity data periodically (every 10 minutes)
setInterval(
  () => {
    const now = Date.now();
    const cutoff = now - CONFIG.ACTIVITY_WINDOW * 2; // Keep data for 2x the window

    // Clean up channel activity
    for (const [key, activity] of channelActivity.entries()) {
      if (activity.lastMessage < cutoff) {
        channelActivity.delete(key);
      }
    }
  },
  10 * 60 * 1000,
);
