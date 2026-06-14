import { describe, expect, test } from "bun:test";

import { shouldSkipStaleGenerationSnapshot } from "@/frank/generationPolicy";
import type { ChannelRuntimeProjection, ResponseSnapshot } from "@/frank/types";

function makeRuntime(
  overrides: Partial<ChannelRuntimeProjection> = {},
): ChannelRuntimeProjection {
  return {
    guildId: "guild",
    channelId: "channel",
    visibleMessages: [],
    recentEventIds: [],
    activeSnapshotId: null,
    activeJobId: null,
    lastBotMessageId: null,
    lastBotSentAt: null,
    lastMentionAt: null,
    pendingIntent: null,
    lastResponseEventId: null,
    lastHumanMessageAt: null,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ResponseSnapshot> = {},
): ResponseSnapshot {
  return {
    id: "snapshot-1",
    guildId: "guild",
    channelId: "channel",
    createdAt: "2026-06-14T01:40:00.000Z",
    anchorMessageId: "message-1",
    visibleMessages: [],
    pendingIntent: null,
    memory: [],
    attentionDecision: {
      shouldRespond: true,
      reason: "direct_mention",
      targetMessageId: "message-1",
      opportunismScore: 1,
    },
    ...overrides,
  };
}

describe("shouldSkipStaleGenerationSnapshot", () => {
  test("skips when newer human activity exists", () => {
    expect(
      shouldSkipStaleGenerationSnapshot({
        runtime: makeRuntime({
          lastHumanMessageAt: "2026-06-14T01:40:05.000Z",
        }),
        snapshot: makeSnapshot(),
      }),
    ).toBe(true);
  });

  test("skips when a newer bot send already happened", () => {
    expect(
      shouldSkipStaleGenerationSnapshot({
        runtime: makeRuntime({
          lastBotSentAt: "2026-06-14T01:40:05.000Z",
        }),
        snapshot: makeSnapshot(),
      }),
    ).toBe(true);
  });

  test("keeps a snapshot that still matches the latest runtime state", () => {
    expect(
      shouldSkipStaleGenerationSnapshot({
        runtime: makeRuntime({
          lastHumanMessageAt: "2026-06-14T01:39:58.000Z",
          lastBotSentAt: "2026-06-14T01:39:50.000Z",
        }),
        snapshot: makeSnapshot(),
      }),
    ).toBe(false);
  });
});
