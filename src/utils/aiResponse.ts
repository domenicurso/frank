import { client } from "@/client";
import { getGuildMemories, Memory } from "@/database";
import { getRecentlyActiveUsers } from "@/database/userStats";
import { buildSystemPrompt } from "@/prompts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type CoreMessage } from "ai";
import type { Message } from "discord.js";
import { createAITools } from "./aiTools";
import { sendModLog } from "./moderation";

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

/**
 * Generates AI response using conversation context and user mentions
 */
export async function generateAIResponse(message: Message): Promise<string> {
  // Fetch the last 15 messages for context (optimized limit)
  const messages = await message.channel.messages.fetch({ limit: 15 });

  // Optimize user context building
  const userMap = new Map<string, { username: string; displayName: string }>();
  const recentUsers: [string, string, string][] = [];
  const processedMessages: string[] = [];

  // Build user map from recent messages first (more efficient)
  for (const msg of messages.values()) {
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

  // Get recently active users (limit to 15 for performance)
  try {
    const recentActiveUsers = await getRecentlyActiveUsers(
      message.guildId || "",
      15,
    );

    // Prioritize recently active users
    for (const stats of recentActiveUsers) {
      const userData = userMap.get(stats.userId);
      if (userData && !recentUsers.some(([id]) => id === stats.userId)) {
        recentUsers.push([
          stats.userId,
          userData.username,
          userData.displayName,
        ]);
      }
    }
  } catch (error) {
    console.error("Error fetching recently active users:", error);
  }

  // Add remaining users from recent messages
  for (const [userId, userData] of userMap) {
    if (!recentUsers.some(([id]) => id === userId)) {
      recentUsers.push([userId, userData.username, userData.displayName]);
    }
  }

  // Process messages more efficiently
  const messageArray = Array.from(messages.values()).reverse();

  for (let i = 0; i < messageArray.length; i++) {
    const msg = messageArray[i]!;

    // Skip empty messages
    if (!msg.content.trim() && msg.attachments.size === 0) continue;

    // Replace mentions with usernames
    let processedContent = msg.content;
    for (const [userId, user] of msg.mentions.users) {
      processedContent = processedContent.replace(
        new RegExp(`<@!?${userId}>`, "g"),
        `@${user.username}`,
      );
    }

    // Handle attachments
    if (msg.attachments.size > 0) {
      const attachmentTypes = Array.from(msg.attachments.values())
        .map((att) => att.contentType?.split("/")[0] || "file")
        .join(", ");
      processedContent += ` [shared ${attachmentTypes}]`;
    }

    // Optimize reply context - check if reply target is in recent messages first
    let replyContext = "";
    if (msg.reference?.messageId) {
      // First check if replied message is in our fetched messages
      const repliedMessage = messageArray.find(
        (m) => m.id === msg.reference?.messageId,
      );

      if (repliedMessage) {
        const repliedContent =
          repliedMessage.content.length > 60
            ? repliedMessage.content.substring(0, 60) + "..."
            : repliedMessage.content;
        replyContext = ` (replying to @${repliedMessage.author.username}: "${repliedContent}")`;
      } else {
        // Only fetch if not in recent messages
        try {
          const fetchedReply = await msg.channel.messages.fetch(
            msg.reference.messageId,
          );
          if (fetchedReply) {
            const repliedContent =
              fetchedReply.content.length > 60
                ? fetchedReply.content.substring(0, 60) + "..."
                : fetchedReply.content;
            replyContext = ` (replying to @${fetchedReply.author.username}: "${repliedContent}")`;
          }
        } catch {
          replyContext = " (replying to a message)";
        }
      }
    }

    // Limit message length for token efficiency
    const truncatedContent =
      processedContent.length > 200
        ? processedContent.substring(0, 200) + "..."
        : processedContent;

    processedMessages.push(
      `@${msg.author.username}: ${truncatedContent}${replyContext}`,
    );
  }

  // Optimize context building
  const messageHistory = processedMessages.slice(-15).join("\n");
  const pingableUsers = recentUsers
    .filter(([_id, username]) => username !== client.user?.username)
    .slice(0, 8); // Reduce to 8 users for token efficiency

  // Fetch and format memories more efficiently
  let memoryContext = "No relevant memories.";
  try {
    const memories = await getGuildMemories(message.guildId || "");
    const recentMemories = memories.slice(0, 15); // Reduce memory limit

    if (recentMemories.length > 0) {
      const formattedMemories = recentMemories
        .map((m: Memory) => {
          const user = recentUsers.find(([id]) => id === m.userId);
          const userDisplay = user
            ? `@${user[1]}`
            : `User(${m.userId.substring(0, 8)})`;
          // Truncate memory content for token efficiency
          const content =
            m.content.length > 400
              ? m.content.substring(0, 400) + "..."
              : m.content;
          return `- ${userDisplay}: ${m.key} = ${content}`;
        })
        .join("\n");

      memoryContext = `Relevant memories:\n${formattedMemories}`;
    }
  } catch (error) {
    console.error("Error fetching memories:", error);
  }

  // Build optimized prompt
  const systemPrompt = buildSystemPrompt(pingableUsers, memoryContext);
  const userPrompt = `Recent conversation:\n${messageHistory}\n\nRespond to @${message.author.username}'s latest message. Keep responses conversational and engaging.`;

  const promptMessages: CoreMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  // Prepare for AI generation
  const userId = message.author.id;
  const guildId = message.guildId || "";

  // Log AI interaction (async to not block response)
  if (message.guild) {
    sendModLog(client, message.guild, {
      action: "AI Response Generated",
      target: message.author,
      additional: {
        userMessage: message.content.substring(0, 200),
        userId,
        guildId,
      },
    }).catch((error) => console.error("Error sending mod log:", error));
  }

  // Create AI tools with message context
  const tools = createAITools(message);

  try {
    const { text } = await generateText({
      model: openrouter("google/gemini-2.5-flash"),
      messages: promptMessages,
      maxTokens: 800,
      tools,
      toolChoice: "auto",
      maxSteps: 8,
      experimental_continueSteps: true,
      temperature: 0.7,
    });

    if (!text || text.trim().length === 0) {
      throw new Error("Empty response from AI model");
    }

    // Process mentions more efficiently
    let processedResponse = text;
    for (const [id, username] of pingableUsers) {
      // Escape regex special characters in username
      const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // More precise mention replacement
      processedResponse = processedResponse.replace(
        new RegExp(`@${escapedUsername}(?=\\s|$|[^a-zA-Z0-9_])`, "g"),
        `<@${id}>`,
      );
    }

    return processedResponse.trim();
  } catch (error) {
    console.error("Error generating AI response:", error);

    // Return fallback response based on context
    if (message.mentions.has(client.user?.id!)) {
      return "I heard you mention me, but I'm having trouble responding right now. Try again in a moment!";
    } else {
      throw error; // Re-throw for higher level error handling
    }
  }
}
