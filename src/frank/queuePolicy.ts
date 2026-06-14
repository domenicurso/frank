import type { ChannelControl, IntentStatus, InvalidationReason, SettleChannelJob } from "@/frank/types";

export function isStaleSettleCandidate(
  payload: SettleChannelJob,
  control: ChannelControl,
) {
  return (
    payload.channelRevision < control.channelRevision ||
    payload.sourceEventId !== control.lastSeenEventId
  );
}

export function shouldClearActiveIntent(options: {
  intentStatus: IntentStatus | null;
  hasGenerateQueue: boolean;
  hasActiveExecution: boolean;
}) {
  if (!options.intentStatus) {
    return true;
  }

  if (!["pending", "generating", "sending"].includes(options.intentStatus)) {
    return true;
  }

  return !options.hasGenerateQueue && !options.hasActiveExecution;
}

export function shouldSkipSettleForActiveIntent(
  control: ChannelControl,
  payload: SettleChannelJob,
) {
  return (
    !!control.activeIntentId &&
    (control.activeIntentRevision ?? -1) >= payload.channelRevision
  );
}

export function toIntentAbortStatus(reason: InvalidationReason | undefined) {
  switch (reason) {
    case "message_deleted":
    case "message_edited":
      return "invalidated";
    case "new_direct_message":
    case "new_reply":
    case "channel_shift":
      return "superseded";
    default:
      return "aborted";
  }
}
