import { trackMessageSent } from "@/database/userStats";
import { Events, Message } from "discord.js";

export const name = "MessageStats";
export const type = Events.MessageCreate;

export async function execute(message: Message) {
  // Ignore bot messages and messages not in guilds
  if (message.author.bot || !message.guild) {
    return;
  }

  // Track the message in user stats
  // await trackMessageSent(message.author.id, message.guild.id);
}
