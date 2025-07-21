import { client } from "@/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type ModelMessage } from "ai";
import { Events } from "discord.js";
import type { Message } from "node_modules/discord.js/typings";

/**
 * AI Controller for Discord Bot
 *
 * This controller handles AI-powered responses when the bot is mentioned in Discord.
 *
 * Mention Handling System:
 * 1. Fetches last 10 messages for context
 * 2. Converts Discord mentions (<@123456>) to readable @username format for AI
 * 3. Builds a reference list of pingable users [id, username] from recent conversation
 * 4. AI generates response using @username format for mentions
 * 5. Converts AI's @username mentions back to Discord <@id> format before sending
 *
 * This allows the AI to naturally reference users by name while maintaining
 * proper Discord mention functionality in the final message.
 */

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export const name = "AIController";
export const type = Events.MessageCreate;

export async function execute(message: Message) {
  // Ignore messages sent by the bot itself
  if (message.author.bot) return;

  // Check if the bot is mentioned in the message
  if (message.mentions.has(client.user?.id!)) {
    try {
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
${pingableUsers.map(([_id, username]) => `- @${username}`).join("\n")}

Only ping users when it's contextually relevant to the conversation.`,
        },
        {
          role: "user",
          content: `Recent conversation:\n${messageHistory}\n\nPlease respond to the latest message that mentioned you.`,
        },
      ];

      console.log("Prompt messages:", promptMessages);

      // Generate AI response using OpenRouter
      const { text } = await generateText({
        model: openrouter("openai/gpt-4.1-mini"),
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

      await message.reply(processedResponse);
    } catch (error) {
      console.error("Error generating AI response:", error);
      await message.reply("Sorry, I'm having trouble thinking right now! 🤖");
    }
  }
}
