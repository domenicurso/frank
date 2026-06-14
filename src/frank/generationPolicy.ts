import type { ChannelRuntimeProjection, ResponseSnapshot } from "@/frank/types";

export function shouldSkipStaleGenerationSnapshot(options: {
  runtime: ChannelRuntimeProjection;
  snapshot: ResponseSnapshot;
}) {
  const snapshotCreatedAt = new Date(options.snapshot.createdAt).getTime();
  if (!Number.isFinite(snapshotCreatedAt) || snapshotCreatedAt <= 0) {
    return false;
  }

  const lastHumanAt = options.runtime.lastHumanMessageAt
    ? new Date(options.runtime.lastHumanMessageAt).getTime()
    : 0;
  if (lastHumanAt > snapshotCreatedAt) {
    return true;
  }

  const lastBotAt = options.runtime.lastBotSentAt
    ? new Date(options.runtime.lastBotSentAt).getTime()
    : 0;
  if (lastBotAt > snapshotCreatedAt) {
    return true;
  }

  return false;
}
