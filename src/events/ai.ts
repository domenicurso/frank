import { client } from "@/client";
import { getGuildConfig } from "@/database";
import { generateAIResponse } from "@/utils/ai/response";
import { addTyposWithCorrection, TYPO_CONFIG } from "@/utils/ai/typo";
import { CooldownManager } from "@/utils/cooldown";
import percent from "@/utils/percent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import type { DMChannel, Message, TextChannel } from "discord.js";
import { Events } from "discord.js";
import z from "zod";

export const name = "AIController";
export const type = Events.MessageCreate;

// Rate limiting and cooldown management
const processingMessages = new Set<string>();
const processingChannels = new Set<string>(); // Track channels currently processing responses

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

// Default configuration (fallback values)
const DEFAULT_CONFIG = {
  // Special tokens
  LONG_PAUSE_DURATION: 1.5 * 1000, // Duration for ::long_pause tokens
  DELETE_DELAY_RANGE: [0.8 * 1000, 2.2 * 1000], // Delay before ::delete_last_messages
  EDIT_DELAY_RANGE: [1.2 * 1000, 2 * 1000], // Delay before ::edit_last_message

  // Message chunking
  MAX_CHUNK_LENGTH: 1800, // Leave room for Discord's 2000 limit
  TYPING_SPEED: 60, // Characters per second
  MIN_TYPING_TIME: 1 * 1000, // Minimum typing time
  MAX_TYPING_TIME: 6 * 1000, // Maximum typing time

  // Relevance detection
  MINIMUM_RELEVANCE: 0.4, // Minimum relevance score (0.0-1.0) to consider responding
};

// Configure OpenRouter for fast relevance checks
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  extraBody: { provider: { sort: "latency" } },
});

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
 * Uses fast AI model to score message relevance for Frank (0.0-1.0)
 * Returns relevance score that multiplies the base response probability
 * Higher scores = more likely to respond with full weight
 */
async function isMessageRelevantToFrank(message: Message): Promise<number> {
  const startTime = Date.now();

  try {
    // Get some context from recent messages for better relevance detection
    const recentMessages = await message.channel.messages.fetch({ limit: 10 });

    // Build user map for mention resolution
    const userMap = new Map<string, { username: string; displayName: string }>();
    for (const msg of recentMessages.values()) {
      userMap.set(msg.author.id, {
        username: msg.author.username,
        displayName: msg.author.displayName,
      });

      // Add mentioned users
      for (const [userId, user] of msg.mentions.users) {
        userMap.set(userId, {
          username: user.username,
          displayName: user.displayName,
        });
      }
    }

    const context = Array.from(recentMessages.values())
      .reverse()
      .map((msg) => {
        // Replace mentions with usernames
        let processedContent = msg.content;
        for (const [userId, user] of msg.mentions.users) {
          processedContent = processedContent.replace(
            new RegExp(`<@!?${userId}>`, "g"),
            `@${user.username}`,
          );
        }
        return `@${msg.author.username}: ${processedContent.slice(0, 100)}`;
      })
      .join("\n");

    const systemPrompt = `You are Frank, a casual and friendly Discord chatbot, analyzing message relevance for response decisions.

Analyze the user's message and provide three scores.

1. TALKING (boolean): Is this message directed at Frank specifically?
   - true: Direct mentions, replies to Frank, questions/requests aimed at Frank
   - false: General conversation, talking to others, not specifically for Frank

2. RELEVANCY (0.0-1.0): How relevant is this content for Frank to engage with?

   HIGHLY RELEVANT (0.8-1.0):
   - Direct questions or requests for help
   - Engaging topics Frank could contribute meaningfully to
   - Jokes, memes, or humor Frank could build on
   - Technical discussions where Frank's knowledge helps
   - Conversation starters or open-ended statements

   MODERATELY RELEVANT (0.5-0.7):
   - General chat Frank could naturally join
   - Reactions to previous messages Frank could comment on
   - Casual observations or experiences
   - Light complaints or celebrations Frank could respond to

   LESS RELEVANT (0.2-0.4):
   - Brief acknowledgments ("ok", "thanks", "lol")
   - Very personal/private conversations between specific users
   - Inside jokes without context
   - Messages already fully resolved

   NOT RELEVANT (0.0-0.1):
   - Spam, gibberish, or abuse
   - Bot commands for other bots
   - Messages clearly not meant for conversation
   - Automated messages or system notifications

3. CONFIDENCE (0.0-1.0): How confident are you in your assessment?
   - 1.0: Very clear and obvious
   - 0.8: Pretty confident
   - 0.6: Somewhat confident
   - 0.4: Uncertain
   - 0.2: Very uncertain`;
    const userPrompt = `Context: Frank should engage naturally in conversations while being helpful and entertaining. Frank has personality - he's witty, sometimes sarcastic, but always friendly.

Recent conversation:
${context}

Current message from @${message.author.username}: ${(() => {
      // Replace mentions with usernames in current message
      let processedContent = message.content;
      for (const [userId, user] of message.mentions.users) {
        processedContent = processedContent.replace(
          new RegExp(`<@!?${userId}>`, "g"),
          `@${user.username}`,
        );
      }
      return processedContent.slice(0, 200);
    })()}

Score the current message. YOU ARE ONLY SCORING THE MESSAGE FROM @${message.author.username}: ${(() => {
      // Replace mentions with usernames in current message
      let processedContent = message.content;
      for (const [userId, user] of message.mentions.users) {
        processedContent = processedContent.replace(
          new RegExp(`<@!?${userId}>`, "g"),
          `@${user.username}`,
        );
      }
      return processedContent.slice(0, 200);
    })()} DO NOT USE CONTEXT TO DETERMINE RELEVANCE.`;

    const { object: output } = await generateObject({
      model: openrouter("google/gemini-2.5-flash"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schema: z.object({
        talking: z.boolean(),
        relevancy: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      }),
      maxTokens: 300,
      temperature: 0.1,
    });

    const score =
      (output.talking ? 1 : 0.7) * output.relevancy * output.confidence;

    return score >= 0.7 ? 1 : score;
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(`Error in AI relevance check (${errorTime}ms):`, error);

    return 0.5; // Default fallback score
  }
}

/**
 * Calculate probability of responding to a message based on context
 */
async function calculateResponseProbability(
  message: Message,
  isMentioned: boolean,
  isReplyToBot: boolean,
): Promise<number> {
  if (isMentioned) return 1;
  if (isReplyToBot) return 1;

  // Check relevance first
  const relevance = await isMessageRelevantToFrank(message);
  if (relevance < DEFAULT_CONFIG.MINIMUM_RELEVANCE) return 0;

  // Use pure relevance-based probability
  return relevance;
}

/**
 * Checks if user or channel is on cooldown
 */
async function isOnCooldown(
  message: Message,
  guildConfig: any,
): Promise<boolean> {
  const userId = message.author.id;
  const channelId = message.channel.id;

  // Check user cooldown
  const userCooldownCheck = await CooldownManager.checkUserCooldown(
    userId,
    "ai_response",
  );
  if (userCooldownCheck.onCooldown) {
    return true;
  }

  // Check channel cooldown (less strict)
  const channelCooldownCheck = await CooldownManager.checkChannelCooldown(
    channelId,
    "ai_response",
  );
  if (channelCooldownCheck.onCooldown) {
    return true;
  }

  return false;
}

/**
 * Sets cooldown for user and channel
 */
async function setCooldown(message: Message, guildConfig: any) {
  const userId = message.author.id;
  const channelId = message.channel.id;

  console.log("Setting cooldown for user:", userId);
  console.log("Setting cooldown for channel:", channelId);
  console.log("Cooldown duration:", guildConfig.cooldownDuration * 1000);

  await CooldownManager.setUserCooldown(
    userId,
    "ai_response",
    guildConfig.cooldownDuration * 1000,
  );
  await CooldownManager.setChannelCooldown(
    channelId,
    "ai_response",
    1000, // 1 second between any responses in channel
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
    if (paragraph.length <= DEFAULT_CONFIG.MAX_CHUNK_LENGTH) {
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
        currentChunk.length + trimmedLine.length + 1 >
          DEFAULT_CONFIG.MAX_CHUNK_LENGTH
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
async function executeEditToken(token: EditToken, channelMessages: Message[]) {
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
    setTimeout(resolve, DEFAULT_CONFIG.LONG_PAUSE_DURATION),
  );
}

/**
 * Executes a reaction token by finding the last message not from Frank and reacting to it
 */
async function executeReactionToken(
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
function getRandomDelay(range: [number, number]): number {
  const [min, max] = range;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculates realistic typing time based on message length
 */
function calculateTypingTime(text: string): number {
  const baseTime = Math.max(
    DEFAULT_CONFIG.MIN_TYPING_TIME,
    Math.min(
      DEFAULT_CONFIG.MAX_TYPING_TIME,
      text.length * (1000 / DEFAULT_CONFIG.TYPING_SPEED),
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

  // Initialize sent messages tracking for this response session
  const sessionMessages: Message[] = [];

  let isFirstMessage = true;

  for (const item of sequence) {
    if (item.type === "text") {
      const chunks = chunkResponse(item.content);

      for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i]!;

        // Apply typos to individual chunks, but skip if this chunk will be affected by edit/delete tokens
        const willBeAffectedBySpecialToken = (() => {
          // The current chunk will become message at index i (0-based)
          const currentMessageIndex = i;
          const totalMessages = chunks.length;

          // Look ahead in the sequence for tokens that might affect this chunk
          for (const futureItem of sequence) {
            if (futureItem.type === "edit") {
              // Edit tokens affect a specific message by index
              if (currentMessageIndex === futureItem.messageIndex) {
                return true;
              }
            }

            if (futureItem.type === "delete") {
              // Delete tokens affect the last 'count' messages
              // Check if current message is within the last 'count' messages
              const isInDeleteRange =
                currentMessageIndex >= totalMessages - futureItem.count;
              if (isInDeleteRange) {
                return true;
              }
            }
          }

          return false;
        })();

        if (!willBeAffectedBySpecialToken && chunk.trim().length > 0) {
          if (percent(TYPO_CONFIG.typoChance * 100)) {
            chunk = addTyposWithCorrection(chunk);
          }
        }

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
          sentMessage = await message.reply({ content: chunk });
          isFirstMessage = false;
        } else {
          // Check if someone interrupted
          try {
            const recentMessages = await channel.messages.fetch({ limit: 1 });
            const lastMessage = recentMessages.first();

            if (lastMessage && lastMessage.author.id !== client.user?.id) {
              sentMessage = await message.reply({ content: chunk });
            } else {
              sentMessage = await channel.send({ content: chunk });
            }
          } catch (error) {
            console.error("Error checking recent messages:", error);
            sentMessage = await channel.send({ content: chunk });
          }
        }

        sessionMessages.push(sentMessage);
      }
    } else if (item.type === "pause") {
      await executePauseToken();
    } else if (item.type === "delete") {
      // Give users time to read the content before deleting
      const deleteDelay = getRandomDelay(
        DEFAULT_CONFIG.DELETE_DELAY_RANGE as [number, number],
      );
      await new Promise((resolve) => setTimeout(resolve, deleteDelay));

      await executeDeleteToken(item, sessionMessages);
    } else if (item.type === "edit") {
      // Give users time to read the content before editing
      const editDelay = getRandomDelay(
        DEFAULT_CONFIG.EDIT_DELAY_RANGE as [number, number],
      );
      await new Promise((resolve) => setTimeout(resolve, editDelay));

      await executeEditToken(item, sessionMessages);
    } else if (item.type === "reaction") {
      await executeReactionToken(item, message);
    }
  }
}

export async function execute(message: Message) {
  // Skip DM messages - only process guild messages
  if (!message.guild) return;

  // Get guild configuration
  const guildConfig = await getGuildConfig(message.guild.id);
  if (!guildConfig) return;

  // Check channel whitelist/blacklist
  const whitelistedChannels = guildConfig.whitelistedChannels
    ? (JSON.parse(guildConfig.whitelistedChannels) as string[])
    : [];
  const blacklistedChannels = guildConfig.blacklistedChannels
    ? (JSON.parse(guildConfig.blacklistedChannels) as string[])
    : [];

  // Channel filtering: Only one of whitelist or blacklist can be active at a time
  // If whitelist has channels, only respond in those channels
  // If no whitelist, check blacklist and skip blacklisted channels
  if (whitelistedChannels.length > 0) {
    if (!whitelistedChannels.includes(message.channel.id)) return;
  } else {
    if (blacklistedChannels.includes(message.channel.id)) return;
  }

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
    const isMentioned = isBotMentioned(message) && guildConfig.allowedMentions;
    const isReplyToBot = await (async () => {
      if (!guildConfig.allowedReplies || !message.reference?.messageId)
        return false;
      try {
        const repliedMessage = await message.channel.messages.fetch(
          message.reference.messageId,
        );
        return repliedMessage?.author.id === client.user?.id;
      } catch {
        return false;
      }
    })();

    // Check cooldowns (but allow mentions and replies to override)
    if (
      !isMentioned &&
      !isReplyToBot &&
      (await isOnCooldown(message, guildConfig))
    )
      return;

    // Calculate response probability AFTER updating activity
    const responseProbability = await calculateResponseProbability(
      message,
      isMentioned,
      isReplyToBot,
    );

    if (!percent(responseProbability * 100)) return;

    // Mark as processing
    processingMessages.add(messageKey);
    processingChannels.add(channel.id);

    try {
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
      await setCooldown(message, guildConfig);
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
