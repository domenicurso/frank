import { ingestMessageCreate } from "@/frank";
import { frankDebug } from "@/frank/debug";
import type { Message } from "discord.js";
import { Client, Events } from "discord.js";

export const name = "AIController";
export const type = Events.MessageCreate;

let watchdog: NodeJS.Timeout | null = null;

export function startAIControllerWatchdog(client: Client) {
  if (watchdog) return;

  watchdog = setInterval(() => {
    if (client.listenerCount(Events.MessageCreate) > 0) {
      return;
    }

    client.on(Events.MessageCreate, execute);
    frankDebug("ingress", "message_create_listener_rebound", {
      listenerCount: client.listenerCount(Events.MessageCreate),
    });
  }, 5_000);
}

export function stopProcessingCleanup() {
  // Frank uses the shared worker loop instead of per-channel processing maps.
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
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
