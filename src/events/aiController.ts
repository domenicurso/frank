import { client } from "@/client";
import { generateAIResponse } from "@/utils/aiResponse";
import type { Message, TextChannel } from "discord.js";
import { Events } from "discord.js";

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

export const name = "AIController";
export const type = Events.MessageCreate;

export async function execute(message: Message) {
  // Ignore messages sent by the bot itself
  if (message.author.bot) return;

  // Check if bot should respond (mentioned OR replying to bot message)
  const isMentioned = message.mentions.has(client.user?.id!);
  const isReplyToBot =
    message.reference?.messageId &&
    (
      await message.channel.messages
        .fetch(message.reference.messageId)
        .catch(() => null)
    )?.author.id === client.user?.id;

  if (isMentioned || isReplyToBot) {
    if (message.channel.isTextBased()) {
      try {
        await (message.channel as TextChannel).sendTyping();

        const response = await generateAIResponse(message);

        await message.reply(response || "kys I aint responding to ts rn");
      } catch (error) {
        console.error("Error generating AI response:", error);
        await message.reply("Sorry, I'm having trouble thinking right now! 🤖");
      }
    }
  }
}
