import { ingestMessageDelete } from "@/frank";
import { Events, Message } from "discord.js";
import type { PartialMessage } from "discord.js";

export const name = "MessageDelete";
export const type = Events.MessageDelete;

export async function execute(message: Message | PartialMessage) {
  if (message.guild && message.channel?.isTextBased()) {
    await ingestMessageDelete(message);
  }
}
