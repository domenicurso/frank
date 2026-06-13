import { ingestMessageUpdate } from "@/frank";
import { Events, Message } from "discord.js";
import type { PartialMessage } from "discord.js";

export const name = "MessageUpdate";
export const type = Events.MessageUpdate;

export async function execute(
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  await ingestMessageUpdate(oldMessage, newMessage);
}
