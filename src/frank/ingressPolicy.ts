import type { InvalidationReason } from "@/frank/types";

export function getIncomingMessageInterruptReason(options: {
  mentionsBot: boolean;
  repliesToBot: boolean;
  hasPendingUnsentExecution: boolean;
}): InvalidationReason | null {
  if (options.mentionsBot) {
    return "new_direct_message";
  }

  if (options.repliesToBot) {
    return "new_reply";
  }

  if (options.hasPendingUnsentExecution) {
    return "channel_shift";
  }

  return null;
}
