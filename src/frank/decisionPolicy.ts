import type {
  ChannelRuntimeProjection,
  PersistedEvent,
} from "@/frank/types";

function getEventTimestamp(event: PersistedEvent | null) {
  if (!event) return null;

  switch (event.type) {
    case "message_create":
    case "reaction_add":
      return event.createdAt;
    case "message_update":
      return event.editedAt;
    case "message_delete":
      return event.deletedAt;
    default:
      return null;
  }
}

export function shouldDelayResponseDecision(runtime: ChannelRuntimeProjection) {
  return runtime.activeSnapshotId !== null;
}

export function shouldSkipStaleResponseDecision(options: {
  runtime: ChannelRuntimeProjection;
  sourceEvent: PersistedEvent | null;
}) {
  if (!options.runtime.lastBotSentAt) {
    return false;
  }

  const sourceTimestamp = getEventTimestamp(options.sourceEvent);
  if (!sourceTimestamp) {
    return false;
  }

  return (
    new Date(sourceTimestamp).getTime() <=
    new Date(options.runtime.lastBotSentAt).getTime()
  );
}
