import { client } from "@/client";
import { getGuildMemories, Memory } from "@/database";
import { getRecentlyActiveUsers } from "@/database/userStats";
import { buildSystemPrompt } from "@/prompts";
import { createAITools } from "@/utils/ai/tools";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type CoreMessage } from "ai";
import type { Embed, Message } from "discord.js";

/**
 * Converts an image URL to base64 format for AI processing
 */
async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/jpeg";

    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error converting image to base64:", error);
    return null;
  }
}

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
  // Process messages into structured format for multiple user messages
  const messageArray = Array.from(messages.values()).reverse();
  const processedMessages: CoreMessage[] = [];

  function embedToPlainText(embed: Embed): string {
    let text = "";

    if (embed.title) text += `## ${embed.title}`;
    if (embed.description) text += `: ${embed.description}\n`;

    if (embed.fields && embed.fields.length > 0) {
      for (const field of embed.fields) {
        text += `\n${field.name}:\n${field.value}\n`;
      }
    }

    if (embed.author?.name) text += `\nAuthor: ${embed.author.name}`;
    if (embed.footer?.text) text += `\nFooter: ${embed.footer.text}`;
    if (embed.url) text += `\nURL: ${embed.url}`;
    if (embed.timestamp) text += `\nTimestamp: ${embed.timestamp}`;

    return text.trim();
  }

  for (let i = 0; i < messageArray.length; i++) {
    const msg = messageArray[i]!;

    // Skip empty messages unless they have attachments
    if (
      !msg.content.trim() &&
      msg.attachments.size === 0 &&
      msg.embeds.length === 0
    )
      continue;

    // Replace mentions with usernames
    let processedContent = msg.content;
    for (const [userId, user] of msg.mentions.users) {
      processedContent = processedContent.replace(
        new RegExp(`<@!?${userId}>`, "g"),
        `@${user.username}`,
      );
    }

    // Handle embeds
    if (msg.embeds.length > 0) {
      processedContent +=
        (processedContent ? "\n\n" : "") +
        msg.embeds.map(embedToPlainText).join("\n\n");
    }

    // Build message content array with proper attachment handling
    const messageContent: Array<
      { type: "text"; text: string } | { type: "image"; image: string }
    > = [];

    // Add reply context if exists
    if (msg.reference?.messageId) {
      // First check if replied message is in our fetched messages
      const repliedMessage = messageArray.find(
        (m) => m.id === msg.reference?.messageId,
      );

      if (repliedMessage) {
        let repliedContent =
          repliedMessage.content.length > 60
            ? repliedMessage.content.substring(0, 60) + "..."
            : repliedMessage.content;
        for (const [userId, user] of repliedMessage.mentions.users) {
          repliedContent = repliedContent.replace(
            new RegExp(`<@!?${userId}>`, "g"),
            `@${user.username}`,
          );
        }
        processedContent = `(replying to @${repliedMessage.author.username}: "${repliedContent}")\n\n${processedContent}`;
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
            processedContent = `(replying to @${fetchedReply.author.username}: "${repliedContent}")\n\n${processedContent}`;
          }
        } catch {
          processedContent = "(replying to a message)\n\n" + processedContent;
        }
      }
    }

    // Add text content if present
    if (processedContent.trim()) {
      const truncatedContent =
        processedContent.length > 200
          ? processedContent.substring(0, 200) + "..."
          : processedContent;

      messageContent.push({
        type: "text",
        text: `@${msg.author.username}: ${truncatedContent}`,
      });
    } else if (msg.attachments.size > 0) {
      // If no text but has attachments, add username context
      messageContent.push({
        type: "text",
        text: `@${msg.author.username}:`,
      });
    }

    // Handle attachments with proper types
    for (const attachment of msg.attachments.values()) {
      const contentType = attachment.contentType || "";

      if (contentType.startsWith("image/")) {
        try {
          const base64Image = await imageUrlToBase64(attachment.url);
          if (base64Image) {
            messageContent.push({
              type: "image",
              image: base64Image,
            });
          } else {
            // Fallback to text description if image conversion fails
            messageContent.push({
              type: "text",
              text: `[Image: ${attachment.name}]`,
            });
          }
        } catch (error) {
          console.error("Error processing image attachment:", error);
          messageContent.push({
            type: "text",
            text: `[Image: ${attachment.name}]`,
          });
        }
      } else {
        // Handle as file
        try {
          // For non-image files, we'll include them as file references
          messageContent.push({
            type: "text",
            text: `[File: ${attachment.name} (${contentType || "unknown type"})]`,
          });
        } catch (error) {
          console.error("Error processing file attachment:", error);
          messageContent.push({
            type: "text",
            text: `[File: ${attachment.name}]`,
          });
        }
      }
    }

    // Only add message if it has meaningful content
    if (messageContent.length > 0) {
      // Ensure we don't add empty text messages
      const hasValidContent = messageContent.some((content) => {
        if (content.type === "text") {
          return content.text && content.text.trim().length > 0;
        }
        return content.type === "image" && content.image;
      });

      if (hasValidContent) {
        processedMessages.push({
          role: "user" as const,
          content:
            messageContent.length === 1 && messageContent[0]?.type === "text"
              ? messageContent[0].text
              : messageContent,
        });
      }
    }
  }

  // Optimize context building
  const recentMessagesForContext = processedMessages.slice(-15);
  const pingableUsers = recentUsers
    .filter(([_id, username]) => username !== client.user?.username)
    .slice(0, 8); // Reduce to 8 users for token efficiency

  // Fetch and format memories more efficiently
  let memoryContext = "No relevant memories.";
  try {
    const memories = await getGuildMemories(message.guildId || "");
    const recentMemories = memories.slice(0, 15); // Reduce memory limit

    if (recentMemories.length > 0) {
      const formattedMemories = await Promise.all(
        recentMemories.map(async (m: Memory) => {
          const userFromRecent = recentUsers.find(([id]) => id === m.userId);
          let userDisplay: string;

          if (userFromRecent) {
            userDisplay = userFromRecent[1];
          } else {
            try {
              const fetchedUser = await client.users.fetch(m.userId);
              userDisplay = fetchedUser.username;
            } catch {
              userDisplay = "Could not fetch user";
            }
          }

          // Truncate memory content for token efficiency
          const content =
            m.content.length > 400
              ? m.content.substring(0, 400) + "..."
              : m.content;
          return `${userDisplay} | ${m.key} | ${content}`;
        }),
      );

      memoryContext = `Relevant memories:\n${formattedMemories.join("\n")}`;
    }
  } catch (error) {
    console.error("Error fetching memories:", error);
  }

  // Build optimized prompt with multiple user messages
  const systemPrompt = buildSystemPrompt(pingableUsers, memoryContext);

  const promptMessages: CoreMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  // Add context message and processed messages only if we have content
  if (recentMessagesForContext.length > 0) {
    promptMessages.push({
      role: "user",
      content: `Recent conversation context. Respond to @${message.author.username}'s latest message. Keep responses conversational and engaging.`,
    });
    promptMessages.push(...recentMessagesForContext);
  } else {
    // Fallback if no messages could be processed
    promptMessages.push({
      role: "user",
      content: `@${message.author.username} sent a message. Respond conversationally and engage with them.`,
    });
  }

  // Create AI tools with message context
  const tools = createAITools(message, pingableUsers);

  try {
    // Ensure we have at least a system message and one user message
    if (promptMessages.length < 2) {
      throw new Error("Insufficient message context for AI generation");
    }

    const { text } = await generateText({
      model: openrouter("google/gemini-2.5-flash"),
      messages: promptMessages,
      maxTokens: 400,
      tools,
      toolChoice: "auto",
      maxSteps: 8,
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
