import percent from "@/utils/percent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type CoreMessage } from "ai";
import { Events, Message } from "discord.js";
import emojiData from "unicode-emoji-json";

export const name = "EmojiReact";
export const type = Events.MessageCreate;

const emojis = Object.keys(emojiData);

function getRandomEmojis(count: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * emojis.length);
    const emoji = emojis[randomIndex];
    if (emoji) {
      result.push(emoji);
    }
  }
  return result;
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export async function execute(message: Message) {
  // Don't react to bot messages
  if (message.author.bot) return;

  if (percent(0.01)) {
    try {
      const randomEmojis = getRandomEmojis(13);

      // Add reactions one by one to avoid rate limits
      for (const emoji of randomEmojis) {
        await message.react(emoji);
        // Small delay to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error("Error adding emoji reactions:", error);
    }
  } else if (percent(5)) {
    try {
      const promptMessages: CoreMessage[] = [
        {
          role: "system",
          content: "Based on the user's input, response with a SINGLE emoji",
        },
        { role: "user", content: message.content },
      ];

      const { text } = await generateText({
        model: openrouter("google/gemini-2.5-flash"),
        messages: promptMessages,
        maxTokens: 20,
        temperature: 0.7,
      });

      await message.react(text);
    } catch (error) {
      console.error("Error adding emoji reactions:", error);
    }
  }
}
