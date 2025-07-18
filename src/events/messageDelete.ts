import { isLoggingEnabled, logModerationAction } from "@/utils/moderation";
import { Events, Message } from "discord.js";

export const name = "MessageDelete";
export const type = Events.MessageDelete;

export async function execute(message: Message) {
  if (await isLoggingEnabled(message.guildId || "0", "message_deletes")) {
    await logModerationAction(
      message.client,
      message.guild!,
      "message_deletes",
      {
        action: "Message Deleted",
        target: message.author,
        moderator: message.author,
        additional: {
          messageId: message.id,
          content: message.content,
        },
      },
    );
  }
}
