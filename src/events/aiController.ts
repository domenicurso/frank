import { client } from "@/client";
import { generateAIResponse } from "@/utils/aiResponse";
import percent from "@/utils/percent";
import type { Message, TextChannel } from "discord.js";
import { Events } from "discord.js";

export const name = "AIController";
export const type = Events.MessageCreate;

export async function execute(message: Message) {
  // Ignore messages sent by the bot itself
  if (message.author.bot) return;

  // Ignore messages from people on the blacklist
  const blacklisted_ids: string[] = [];
  if (blacklisted_ids.includes(message.author.id)) return;

  // Check if bot should respond (mentioned OR replying to bot message)
  const isMentioned = message.mentions.has(client.user?.id!);
  const isReplyToBot =
    message.reference?.messageId &&
    (
      await message.channel.messages
        .fetch(message.reference.messageId)
        .catch(() => null)
    )?.author.id === client.user?.id;

  if (isMentioned || isReplyToBot || percent(10)) {
    if (message.channel.isTextBased()) {
      try {
        await (message.channel as TextChannel).sendTyping();

        const response = await generateAIResponse(message);

        await message.reply(response || "The message content is empty.");
      } catch (error) {
        console.error("Error generating AI response:", error);
        await message.reply("There was an error generating the response.");
      }
    }
  }
}
