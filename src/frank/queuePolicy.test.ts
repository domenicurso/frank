import { describe, expect, test } from "bun:test";

import {
  isStaleSettleCandidate,
  shouldClearActiveIntent,
  shouldSkipSettleForActiveIntent,
  toIntentAbortStatus,
} from "@/frank/queuePolicy";
import type { ChannelControl, SettleChannelJob } from "@/frank/types";

function makeControl(overrides: Partial<ChannelControl> = {}): ChannelControl {
  return {
    guildId: "guild",
    channelId: "channel",
    channelRevision: 4,
    lastSeenEventId: "event-4",
    lastHumanMessageId: "message-4",
    lastHumanMessageAt: "2026-06-13T22:00:00.000Z",
    lastBotMessageId: null,
    lastBotSentAt: null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
    pendingSettleAt: null,
    updatedAt: "2026-06-13T22:00:00.000Z",
    ...overrides,
  };
}

function makeSettleJob(overrides: Partial<SettleChannelJob> = {}): SettleChannelJob {
  return {
    guildId: "guild",
    channelId: "channel",
    sourceEventId: "event-4",
    channelRevision: 4,
    ...overrides,
  };
}

describe("queue policy", () => {
  test("treats older settle work as stale", () => {
    expect(
      isStaleSettleCandidate(
        makeSettleJob({ channelRevision: 3 }),
        makeControl(),
      ),
    ).toBe(true);
  });

  test("treats mismatched source event settle work as stale", () => {
    expect(
      isStaleSettleCandidate(
        makeSettleJob({ sourceEventId: "event-3" }),
        makeControl(),
      ),
    ).toBe(true);
  });

  test("clears active intents when nothing is generating or sending them", () => {
    expect(
      shouldClearActiveIntent({
        intentStatus: "pending",
        hasGenerateQueue: false,
        hasActiveExecution: false,
      }),
    ).toBe(true);
  });

  test("keeps active intents that still have live work attached", () => {
    expect(
      shouldClearActiveIntent({
        intentStatus: "generating",
        hasGenerateQueue: true,
        hasActiveExecution: false,
      }),
    ).toBe(false);
  });

  test("skips settle work behind the active intent revision", () => {
    expect(
      shouldSkipSettleForActiveIntent(
        makeControl({
          activeIntentId: "intent-1",
          activeIntentRevision: 5,
        }),
        makeSettleJob({ channelRevision: 4 }),
      ),
    ).toBe(true);
  });

  test("maps deletion invalidation to invalidated intent status", () => {
    expect(toIntentAbortStatus("message_deleted")).toBe("invalidated");
    expect(toIntentAbortStatus("channel_shift")).toBe("superseded");
    expect(toIntentAbortStatus("worker_timeout")).toBe("aborted");
  });
});
