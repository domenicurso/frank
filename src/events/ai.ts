import { ingestMessageCreate } from "@/frank";
import type { Message } from "discord.js";
import { Events } from "discord.js";

export const name = "AIController";
export const type = Events.MessageCreate;

export function stopProcessingCleanup() {
  // Frank uses the shared worker loop instead of per-channel processing maps.
}

export async function execute(message: Message) {
  if (!message.guild || message.author.bot || !message.channel.isTextBased()) {
    return;
  }

  try {
    await ingestMessageCreate(message);
  } catch (error) {
    console.error("[Frank] Error ingesting message:", error);
  }
}
