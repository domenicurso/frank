import { describe, expect, test } from "bun:test";

import {
  applyDiscordEventToRuntime,
  markBurstInterrupted,
  releasePendingSnapshot,
} from "@/frank/runtime";
import type { ChannelRuntimeProjection, ResponseSnapshot } from "@/frank/types";

function makeRuntime(
  overrides: Partial<ChannelRuntimeProjection> = {},
): ChannelRuntimeProjection {
  return {
    guildId: "guild",
    channelId: "channel",
    visibleMessages: [],
    recentEventIds: [],
    ...overrides,
    activeIntentId: overrides.activeIntentId ?? null,
    activeIntentRevision: overrides.activeIntentRevision ?? null,
    activeSnapshotId: overrides.activeSnapshotId ?? null,
    activeSnapshotCreatedAt: overrides.activeSnapshotCreatedAt ?? null,
    activeJobId: overrides.activeJobId ?? null,
    lastBotMessageId: overrides.lastBotMessageId ?? null,
    lastBotSentAt: overrides.lastBotSentAt ?? null,
    lastMentionAt: overrides.lastMentionAt ?? null,
    pendingIntent: overrides.pendingIntent ?? null,
    lastResponseEventId: overrides.lastResponseEventId ?? null,
    lastHumanMessageAt: overrides.lastHumanMessageAt ?? null,
  };
}

function makeSnapshot(id: string): ResponseSnapshot {
  return {
    id,
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
  };
}

describe("runtime interruption guards", () => {
  test("releases the currently pending snapshot", () => {
    const runtime = makeRuntime({
      activeSnapshotId: "snapshot-1",
      activeSnapshotCreatedAt: "2026-06-14T01:40:00.000Z",
    });
    const next = releasePendingSnapshot(runtime, "snapshot-1");

    expect(next.activeSnapshotId).toBeNull();
    expect(next.activeSnapshotCreatedAt).toBeNull();
  });

  test("does not clear a newer active snapshot when an older generation aborts", () => {
    const runtime = makeRuntime({ activeSnapshotId: "snapshot-2" });
    const next = markBurstInterrupted(
      runtime,
      makeSnapshot("snapshot-1"),
      ["old thought"],
      "2026-06-14T01:40:05.000Z",
    );

    expect(next.activeSnapshotId).toBe("snapshot-2");
    expect(next.pendingIntent).toBeNull();
  });

  test("records reaction adds on visible messages", () => {
    const runtime = makeRuntime({
      visibleMessages: [
        {
          id: "message-1",
          authorId: "user-1",
          authorName: "Dom",
          authorUsername: "dom",
          content: "hello",
          mentionsBot: false,
          replyToMessageId: null,
          attachments: [],
          reactions: [],
          lastEdit: null,
          createdAt: "2026-06-14T01:40:00.000Z",
          fromBot: false,
        },
      ],
    });

    const next = applyDiscordEventToRuntime(runtime, {
      type: "reaction_add",
      eventKey: "reaction_add:message-1:user-2:1",
      guildId: "guild",
      channelId: "channel",
      messageId: "message-1",
      userId: "user-2",
      userName: "Sam",
      userUsername: "sam",
      emoji: "😂",
      createdAt: "2026-06-14T01:40:05.000Z",
    });

    expect(next.visibleMessages[0]?.reactions).toEqual([
      {
        userId: "user-2",
        userName: "Sam",
        userUsername: "sam",
        emoji: "😂",
        createdAt: "2026-06-14T01:40:05.000Z",
      },
    ]);
  });

  test("tracks the last edit on visible messages", () => {
    const runtime = makeRuntime({
      visibleMessages: [
        {
          id: "message-1",
          authorId: "user-1",
          authorName: "Dom",
          authorUsername: "dom",
          content: "2+4",
          mentionsBot: true,
          replyToMessageId: null,
          attachments: [],
          reactions: [],
          lastEdit: null,
          createdAt: "2026-06-14T01:40:00.000Z",
          fromBot: false,
        },
      ],
    });

    const next = applyDiscordEventToRuntime(runtime, {
      type: "message_update",
      eventKey: "message_update:message-1:1",
      guildId: "guild",
      channelId: "channel",
      messageId: "message-1",
      oldContent: "2+4",
      newContent: "2*4",
      editedAt: "2026-06-14T01:40:05.000Z",
    });

    expect(next.visibleMessages[0]?.lastEdit).toEqual({
      oldContent: "2+4",
      editedAt: "2026-06-14T01:40:05.000Z",
    });
  });
});
