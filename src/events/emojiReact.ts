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

export async function execute(message: Message) {
  // Don't react to bot messages
  if (message.author.bot) return;

  if (Math.random() < 3 / 100) {
    try {
      const randomEmojis = getRandomEmojis(14);

      // Add reactions one by one to avoid rate limits
      for (const emoji of randomEmojis) {
        await message.react(emoji);
        // Small delay to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (error) {
      console.error("Error adding emoji reactions:", error);
    }
  }
}
