import { client } from "@/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type ModelMessage } from "ai";
import type { Message } from "discord.js";

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

/**
 * Generates AI response using conversation context and user mentions
 */
export async function generateAIResponse(message: Message): Promise<string> {
  // Fetch the last 10 messages for context
  const messages = await message.channel.messages.fetch({ limit: 10 });

  // Get all unique users from recent messages for ping reference
  const recentUsers: [string, string][] = [];
  const processedMessages: string[] = [];

  for (const msg of Array.from(messages.values()).reverse()) {
    // Add [id, username] pair if not already present
    if (!recentUsers.some(([id]) => id === msg.author.id)) {
      recentUsers.push([msg.author.id, msg.author.username]);
    }

    // Replace mentions with usernames
    let processedContent = msg.content;
    for (const [userId, user] of msg.mentions.users) {
      processedContent = processedContent.replace(
        new RegExp(`<@!?${userId}>`, "g"),
        `@${user.username}`,
      );
    }

    processedMessages.push(`${msg.author.username}: ${processedContent}`);
  }

  const messageHistory = processedMessages.join("\n");
  const pingableUsers = recentUsers
    .filter(([id, username]) => username !== client.user?.username)
    .slice(0, 10); // Limit to recent users

  const promptMessages: ModelMessage[] = [
    {
      role: "system",
      content: `You are a helpful Discord bot. Respond naturally to the conversation based on the recent message history. Be engaging and contextually aware.

You can ping users by using @username format. Here are the users you can reference from recent conversation:
${pingableUsers.map(([id, username]) => `- @${username} (ID: ${id})`).join("\n")}

Only ping users when it's contextually relevant to the conversation. Never prepend your messages with "AI:" or "Bot:" or anything similar.`,
    },
    {
      role: "user",
      content: `Recent conversation:\n${messageHistory}\n\nPlease respond to the latest message.`,
    },
  ];

  // Generate AI response using OpenRouter
  const { text } = await generateText({
    model: openrouter("x-ai/grok-3-mini"),
    messages: promptMessages,
    maxOutputTokens: 256,
  });

  // Convert @username mentions back to Discord <@id> format
  let processedResponse = text;
  for (const [id, username] of pingableUsers) {
    processedResponse = processedResponse.replace(
      new RegExp(`@${username}\\b`, "g"),
      `<@${id}>`,
    );
  }

  return processedResponse;
}
