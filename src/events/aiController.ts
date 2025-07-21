import { client } from "@/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { Events } from "discord.js";
import type { Message } from "node_modules/discord.js/typings";

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
      const messageHistory = messages
        .reverse()
        .map((msg) => `${msg.author.username}: ${msg.content}`)
        .join("\n");

      // Generate AI response using OpenRouter
      const { text } = await generateText({
        model: openrouter("openai/gpt-4.1-nano"),
        messages: [
          {
            role: "system",
            content:
              "You are a helpful Discord bot. Respond naturally to the conversation based on the recent message history. Be engaging and contextually aware.",
          },
          {
            role: "user",
            content: `Recent conversation:\n${messageHistory}\n\nPlease respond to the latest message that mentioned you.`,
          },
        ],
        maxTokens: 150,
      });

      await message.reply(text);
    } catch (error) {
      console.error("Error generating AI response:", error);
      await message.reply("Sorry, I'm having trouble thinking right now! 🤖");
    }
  }
}
