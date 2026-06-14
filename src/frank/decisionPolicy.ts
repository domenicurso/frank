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

function getTimestamp(value: string | null | undefined) {
  if (!value) return 0;

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isActiveSnapshotStale(runtime: ChannelRuntimeProjection) {
  const activeSnapshotCreatedAt = getTimestamp(runtime.activeSnapshotCreatedAt);
  if (!activeSnapshotCreatedAt) {
    return false;
  }

  return (
    getTimestamp(runtime.lastHumanMessageAt) > activeSnapshotCreatedAt ||
    getTimestamp(runtime.lastBotSentAt) > activeSnapshotCreatedAt
  );
}

export function shouldSkipResponseDecisionBehindActiveSnapshot(options: {
  runtime: ChannelRuntimeProjection;
  sourceEvent: PersistedEvent | null;
}) {
  const activeSnapshotCreatedAt = getTimestamp(
    options.runtime.activeSnapshotCreatedAt,
  );
  if (!activeSnapshotCreatedAt) {
    return false;
  }

  const sourceTimestamp = getTimestamp(getEventTimestamp(options.sourceEvent));
  if (!sourceTimestamp) {
    return false;
  }

  return sourceTimestamp <= activeSnapshotCreatedAt;
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
