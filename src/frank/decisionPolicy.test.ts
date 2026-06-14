import { describe, expect, test } from "bun:test";

import {
  shouldDelayResponseDecision,
  shouldSkipStaleResponseDecision,
} from "@/frank/decisionPolicy";
import type {
  ChannelRuntimeProjection,
  PersistedEvent,
} from "@/frank/types";

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

function makeMessageCreate(
  overrides: Partial<Extract<PersistedEvent, { type: "message_create" }>> = {},
): Extract<PersistedEvent, { type: "message_create" }> {
  return {
    type: "message_create",
    eventKey: "message_create:1",
    guildId: "guild",
    channelId: "channel",
    messageId: "message-1",
    authorId: "user-1",
    authorName: "dom",
    authorUsername: "dom",
    content: "hey frank",
    mentionsBot: true,
    mentionsUserIds: [],
    mentionedUsers: [],
    mentionedChannels: [],
    replyToMessageId: null,
    replyPreview: null,
    createdAt: "2026-06-13T21:24:00.000Z",
    attachments: [],
    ...overrides,
  };
}

describe("decision policy", () => {
  test("delays response decisions while a snapshot is still active", () => {
    expect(
      shouldDelayResponseDecision(
        makeRuntime({ activeSnapshotId: "snapshot-1" }),
      ),
    ).toBe(true);
    expect(shouldDelayResponseDecision(makeRuntime())).toBe(false);
  });

  test("skips decisions triggered by messages older than the last bot send", () => {
    const runtime = makeRuntime({
      lastBotSentAt: "2026-06-13T21:24:05.000Z",
    });
    const sourceEvent = makeMessageCreate({
      createdAt: "2026-06-13T21:24:00.000Z",
    });

    expect(
      shouldSkipStaleResponseDecision({
        runtime,
        sourceEvent,
      }),
    ).toBe(true);
  });

  test("keeps decisions for newer human messages", () => {
    const runtime = makeRuntime({
      lastBotSentAt: "2026-06-13T21:24:05.000Z",
    });
    const sourceEvent = makeMessageCreate({
      createdAt: "2026-06-13T21:24:08.000Z",
    });

    expect(
      shouldSkipStaleResponseDecision({
        runtime,
        sourceEvent,
      }),
    ).toBe(false);
  });
});
