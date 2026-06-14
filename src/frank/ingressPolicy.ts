import type { InvalidationReason } from "@/frank/types";

export function getIncomingMessageInterruptReason(options: {
  authorId: string;
  mentionsBot: boolean;
  repliesToBot: boolean;
  pendingUnsentExecution:
    | {
        latestAuthorId: string | null;
      }
    | null;
}): InvalidationReason | null {
  if (options.mentionsBot) {
    return "new_direct_message";
  }

  if (options.repliesToBot) {
    return "new_reply";
  }

  if (
    options.pendingUnsentExecution &&
    options.pendingUnsentExecution.latestAuthorId === options.authorId
  ) {
    return "channel_shift";
  }

  return null;
}
