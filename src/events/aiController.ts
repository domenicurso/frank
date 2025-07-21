import { client } from "@/client";
import { Events } from "discord.js";
import type { Message } from "node_modules/discord.js/typings";

export const name = "AIController";
export const type = Events.MessageCreate;

export async function execute(message: Message) {
  // Ignore messages sent by the bot itself
  if (message.author.bot) return;

  // Check if the bot is mentioned in the message
  if (message.mentions.has(client.user?.id!)) {
    message.reply("youre so cool for pinging me you rizz god");
  }
}
