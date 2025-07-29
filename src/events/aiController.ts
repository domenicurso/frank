import { client } from "@/client";
import { generateAIResponse } from "@/utils/aiResponse";
import { CooldownManager } from "@/utils/cooldown";
import type { DMChannel, Message, TextChannel } from "discord.js";
import { ChannelType, Events } from "discord.js";

export const name = "AIController";
export const type = Events.MessageCreate;

// Rate limiting and cooldown management
const channelActivity = new Map<
  string,
  { lastMessage: number; messageCount: number }
>();
const processingMessages = new Set<string>();
const processingChannels = new Set<string>(); // Track channels currently processing responses

// Message tracking for special tokens - now per response session
const sentMessages = new Map<string, Message[]>(); // channelId -> array of sent messages

// Special token interfaces
interface DeleteToken {
  type: "delete";
  count: number;
}

interface EditToken {
  type: "edit";
  messageIndex: number;
  newContent: string;
}

interface PauseToken {
  type: "pause";
}

interface ReactionToken {
  type: "reaction";
  emoji: string;
}

interface TextChunk {
  type: "text";
  content: string;
}

type SpecialToken = DeleteToken | EditToken | PauseToken | ReactionToken;
type MessageItem = SpecialToken | TextChunk;

// Configuration
const CONFIG = {
  // Cooldown periods (in milliseconds)
  USER_COOLDOWN: 10 * 1000, // Seconds between responses to same user
  CHANNEL_COOLDOWN: 6 * 1000, // Seconds between any responses in channel
  LONG_PAUSE_DURATION: 1.5 * 1000, // Duration for ::long_pause tokens
  // Delay ranges for token execution (min, max in milliseconds)
  DELETE_DELAY_RANGE: [0.8 * 1000, 2.2 * 1000] as const, // Delay before delete
  EDIT_DELAY_RANGE: [1.2 * 1000, 2 * 1000] as const, // Delay before edit

  // Response probability weights
  MENTION_WEIGHT: 100 / 100, // Response rate for mentions
  REPLY_WEIGHT: 100 / 100, // Response rate for replies
  DM_WEIGHT: 100 / 100, // Response rate for DMs
  FOLLOW_UP_WEIGHT: 60 / 100, // Response rate for indirect responses
  ACTIVE_WEIGHT: 3 / 100, // Response rate for active conversations
  RANDOM_WEIGHT: 1 / 100, // Response rate for random responses

  // Activity thresholds
  ACTIVE_CONVERSATION_THRESHOLD: 5, // Messages in timeframe
  ACTIVE_WINDOW: 3 * 60 * 1000, // Timeframe for activity
  FOLLOW_UP_WINDOW: 15 * 1000, // Time window for follow-up responses

  // Message chunking
  MAX_CHUNK_LENGTH: 1800, // Leave room for Discord's 2000 limit
  TYPING_SPEED: 60, // Characters per second
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
 * Checks if the previous message in the channel was from Frank within the follow-up window
 */
async function isFollowUpToFrank(message: Message): Promise<boolean> {
  try {
    // Fetch the last few messages from the channel
    const messages = await message.channel.messages.fetch({
      limit: 1,
      before: message.id,
    });

    if (messages.size === 0) return false;

    // Get the most recent message before the current one
    const previousMessage = messages.first();
    if (!previousMessage) return false;

    // Check if it's from Frank and within the time window
    const isFrankMessage = previousMessage.author.id === client.user?.id;
    const timeDiff =
      message.createdTimestamp - previousMessage.createdTimestamp;
    const withinWindow = timeDiff <= CONFIG.FOLLOW_UP_WINDOW;

    return isFrankMessage && withinWindow;
  } catch (error) {
    console.error("Error checking follow-up to Frank:", error);
    return false;
  }
}

/**
 * Calculates intelligent response probability based on context
 */
function calculateResponseProbability(
  message: Message,
  isMentioned: boolean,
  isReplyToBot: boolean,
  isFollowUp: boolean,
): number {
  if (isMentioned) return CONFIG.MENTION_WEIGHT;
  if (isReplyToBot) return CONFIG.REPLY_WEIGHT;
  if (isFollowUp) return CONFIG.FOLLOW_UP_WEIGHT;

  // High response rate for DMs since user is directly messaging Frank
  if (message.channel.type === ChannelType.DM) {
    return CONFIG.DM_WEIGHT;
  }

  // Check conversation activity BEFORE updating it
  const channelId = message.channel.id;
  const activity = channelActivity.get(channelId);

  if (activity) {
    const timeSinceLastMessage = Date.now() - activity.lastMessage;
    const isActiveConversation =
      timeSinceLastMessage < CONFIG.ACTIVE_WINDOW &&
      activity.messageCount >= CONFIG.ACTIVE_CONVERSATION_THRESHOLD;

    if (isActiveConversation) {
      return CONFIG.ACTIVE_WEIGHT;
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

  if (activity && now - activity.lastMessage < CONFIG.ACTIVE_WINDOW) {
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
 * Parses response text for special tokens and returns tokens + cleaned text
 */
function parseMessageSequence(text: string): MessageItem[] {
  const sequence: MessageItem[] = [];
  const lines = text.split("\n");
  let currentTextLines: string[] = [];

  const flushTextLines = () => {
    if (currentTextLines.length > 0) {
      const content = currentTextLines.join("\n").trim();
      if (content) {
        sequence.push({ type: "text", content });
      }
      currentTextLines = [];
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check for ::delete_last_messages [n]
    const deleteMatch = trimmedLine.match(/^::delete_last_messages\s+(\d+)$/);
    if (deleteMatch) {
      flushTextLines();
      const count = parseInt(deleteMatch[1]!, 10);
      sequence.push({ type: "delete", count });
      continue;
    }

    // Check for ::edit_last_message [message]
    const editMatch = trimmedLine.match(/^::edit_last_message\s+(.+)$/);
    if (editMatch) {
      flushTextLines();
      const newContent = editMatch[1]!.trim();
      sequence.push({ type: "edit", messageIndex: 1, newContent });
      continue;
    }

    // Check for ::reaction [emoji]
    const reactionMatch = trimmedLine.match(/^::reaction\s+(.+)$/);
    if (reactionMatch) {
      flushTextLines();
      const emoji = reactionMatch[1]!.trim();
      sequence.push({ type: "reaction", emoji });
      continue;
    }

    // Check for ::long_pause
    if (trimmedLine === "::long_pause") {
      flushTextLines();
      sequence.push({ type: "pause" });
      continue;
    }

    // Regular text line
    currentTextLines.push(line);
  }

  // Flush any remaining text
  flushTextLines();

  return sequence;
}

/**
 * Executes a delete token by removing the last n messages from Frank
 */
async function executeDeleteToken(
  channel: TextChannel | DMChannel,
  token: DeleteToken,
  channelMessages: Message[],
) {
  const messagesToDelete = channelMessages.slice(-token.count);

  for (const msg of messagesToDelete) {
    try {
      await msg.delete();
    } catch (error) {
      console.error("Failed to delete message:", error);
    }
  }

  // Remove deleted messages from tracking array
  channelMessages.splice(-token.count, token.count);
}

/**
 * Executes an edit token by modifying the nth to last message
 */
async function executeEditToken(
  channel: TextChannel | DMChannel,
  token: EditToken,
  channelMessages: Message[],
) {
  // messageIndex 1 means the last message, 2 means second to last, etc.
  const messageIndex = channelMessages.length - token.messageIndex;

  if (messageIndex >= 0 && messageIndex < channelMessages.length) {
    const messageToEdit = channelMessages[messageIndex];
    try {
      await messageToEdit!.edit(token.newContent);
    } catch (error) {
      console.error("Failed to edit message:", error);
    }
  } else {
    console.log("No valid message to edit at index:", messageIndex);
  }
}

/**
 * Executes a pause token by waiting for the specified duration
 */
async function executePauseToken() {
  await new Promise((resolve) =>
    setTimeout(resolve, CONFIG.LONG_PAUSE_DURATION),
  );
}

/**
 * Executes a reaction token by finding the last message not from Frank and reacting to it
 */
async function executeReactionToken(
  channel: TextChannel | DMChannel,
  token: ReactionToken,
  originalMessage: Message,
) {
  try {
    // React to the original message that Frank is replying to
    await originalMessage.react(token.emoji);
  } catch (error) {
    console.error("Failed to react to message:", error);
  }
}

/**
 * Calculates a random delay within the specified range
 */
function getRandomDelay(range: readonly [number, number]): number {
  const [min, max] = range;
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
 * Sends response with special tokens support and improved UX
 */
async function sendResponse(
  message: Message,
  response: string,
  startTime: number,
) {
  const channel = message.channel as TextChannel | DMChannel;

  // Parse message sequence
  const sequence = parseMessageSequence(response);

  if (sequence.length === 0) {
    await message.reply("I don't have anything to say right now.");
    return;
  }

  // Create a unique session ID for this response
  const sessionId = `${channel.id}_${Date.now()}_${Math.random()}`;

  // Initialize sent messages tracking for this response session
  const sessionMessages: Message[] = [];
  sentMessages.set(sessionId, sessionMessages);

  let isFirstMessage = true;

  for (const item of sequence) {
    if (item.type === "text") {
      const chunks = chunkResponse(item.content);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;

        await channel.sendTyping();

        // Calculate typing delay
        const typingTime = calculateTypingTime(chunk);
        const delay = isFirstMessage
          ? Math.max(typingTime - (Date.now() - startTime), 0)
          : typingTime;

        await new Promise((resolve) => setTimeout(resolve, delay));

        // Send message
        let sentMessage: Message;
        if (isFirstMessage) {
          sentMessage = await message.reply(chunk);
          isFirstMessage = false;
        } else {
          // Check if someone interrupted
          try {
            const recentMessages = await channel.messages.fetch({ limit: 1 });
            const lastMessage = recentMessages.first();

            if (lastMessage && lastMessage.author.id !== client.user?.id) {
              sentMessage = await message.reply(chunk);
            } else {
              sentMessage = await channel.send(chunk);
            }
          } catch (error) {
            console.error("Error checking recent messages:", error);
            sentMessage = await channel.send(chunk);
          }
        }

        sessionMessages.push(sentMessage);
      }
    } else if (item.type === "pause") {
      await executePauseToken();
    } else if (item.type === "delete") {
      // Give users time to read the content before deleting
      const deleteDelay = getRandomDelay(CONFIG.DELETE_DELAY_RANGE);
      await new Promise((resolve) => setTimeout(resolve, deleteDelay));

      await executeDeleteToken(channel, item, sessionMessages);
    } else if (item.type === "edit") {
      // Give users time to read the content before editing
      const editDelay = getRandomDelay(CONFIG.EDIT_DELAY_RANGE);
      await new Promise((resolve) => setTimeout(resolve, editDelay));

      await executeEditToken(channel, item, sessionMessages);
    } else if (item.type === "reaction") {
      await executeReactionToken(channel, item, message);
    }
  }

  // Clean up session tracking
  sentMessages.delete(sessionId);
}

export async function execute(message: Message) {
  try {
    // Ignore messages sent by bots
    if (message.author.bot) return;

    // Only process text-based channels
    if (!message.channel.isTextBased()) return;

    const blacklisted_users: string[] = ["1398717873257713767"];

    if (blacklisted_users.includes(message.author.id)) return;

    // Prevent duplicate processing
    const messageKey = `${message.id}_${message.author.id}`;
    if (processingMessages.has(messageKey)) return;

    // Prevent overlapping responses in the same channel
    const channel = message.channel as TextChannel | DMChannel;
    if (processingChannels.has(channel.id)) return;

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

    // Check if this is a follow-up to Frank's message
    const isFollowUp = await isFollowUpToFrank(message);

    // Update activity tracking FIRST so current message counts
    updateChannelActivity(message);

    // Calculate response probability AFTER updating activity
    const responseProbability = calculateResponseProbability(
      message,
      isMentioned,
      isReplyToBot,
      isFollowUp,
    );
    const shouldRespond = Math.random() < responseProbability;

    if (!shouldRespond) return;

    // Check cooldowns (but allow mentions, replies, and follow-ups to override)
    if (
      !isMentioned &&
      !isReplyToBot &&
      !isFollowUp &&
      (await isOnCooldown(message))
    )
      return;

    // Mark as processing
    processingMessages.add(messageKey);
    processingChannels.add(channel.id);

    try {
      await channel.sendTyping();

      // track start time
      const startTime = Date.now();

      // Generate AI response
      const response = await generateAIResponse(message);

      //       const response = `bet I'm on it
      // ::long_pause
      // this finna be good
      // ::long_pause
      // you better be ready for this heat
      // ::delete_last_messages 1
      // i mean
      // ::edit_last_message i hope you're ready
      // cause here it comes
      // ::long_pause
      // your face looks like a potato
      // ::delete_last_messages 1
      // lmao jk
      // you're alright sometimes
      // ::long_pause
      // but seriously though
      // you need to clean your room
      // ::edit_last_message you should probably clean your room
      // cause it's a mess
      // ::long_pause
      // i saw that pizza box from last week
      // ::delete_last_messages 1
      // nah i'm just messing with you
      // ::long_pause
      // or am i
      // ::edit_last_message or am i not
      // you'll never know
      // ::long_pause
      // so what do you think
      // did i cook or what`;

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
      // Always remove from processing sets
      processingMessages.delete(messageKey);
      processingChannels.delete(channel.id);
    }
  } catch (error) {
    console.error("Error in AI controller:", error);

    // Clean up processing state
    const messageKey = `${message.id}_${message.author.id}`;
    processingMessages.delete(messageKey);

    if (message.channel.isTextBased()) {
      const channel = message.channel as TextChannel | DMChannel;
      processingChannels.delete(channel.id);
    }

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
    const cutoff = now - CONFIG.ACTIVE_WINDOW * 2; // Keep data for 2x the window

    // Clean up channel activity
    for (const [key, activity] of channelActivity.entries()) {
      if (activity.lastMessage < cutoff) {
        channelActivity.delete(key);
      }
    }

    // Clean up old sent messages (keep last 20 per channel for special tokens)
    for (const [channelId, messages] of sentMessages.entries()) {
      if (messages.length > 20) {
        sentMessages.set(channelId, messages.slice(-20));
      }
    }
  },
  10 * 60 * 1000,
);
