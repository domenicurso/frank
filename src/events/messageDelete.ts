import { trackMessageDeleted } from "@/database/userStats";
import { Events, Message } from "discord.js";

export const name = "MessageDelete";
export const type = Events.MessageDelete;

export async function execute(message: Message) {
  // Ignore bot messages and messages not in guilds
  if (message.author.bot || !message.guild) {
    return;
  }

  // Decrement message count for the user
  await trackMessageDeleted(message.author.id, message.guild.id);
}
