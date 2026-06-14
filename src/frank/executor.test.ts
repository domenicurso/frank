import { describe, expect, test } from "bun:test";

import {
  resolveChunkTypingStartedAt,
  shouldSendAsReply,
} from "@/frank/executor";
import type { ResponseSnapshot, VisibleMessage } from "@/frank/types";

function makeMessage(id: string): VisibleMessage {
  return {
    id,
    authorId: "user-1",
    authorName: "Dom",
    authorUsername: "dom",
    content: `message ${id}`,
    mentionsBot: false,
    replyToMessageId: null,
    attachments: [],
    reactions: [],
    lastEdit: null,
    createdAt: `2026-06-14T01:40:0${id}.000Z`,
    fromBot: false,
  };
}

function makeSnapshot(anchorMessageId: string | null, visibleMessages: VisibleMessage[]): ResponseSnapshot {
  return {
    id: "snapshot-1",
    concernId: "concern-1",
    laneKey: "author:user-1",
    guildId: "guild",
    channelId: "channel",
    createdAt: "2026-06-14T01:40:00.000Z",
    anchorMessageId,
    focusAuthorId: "user-1",
    focusMessages: anchorMessageId
      ? visibleMessages.filter((message) => message.id === anchorMessageId)
      : [],
    focusEvents: [],
    visibleMessages,
    pendingIntentContext: null,
    pendingIntent: null,
    memory: [],
    attentionDecision: {
      shouldRespond: true,
      reason: "continuation",
      targetMessageId: anchorMessageId,
      opportunismScore: 1,
    },
  };
}

describe("shouldSendAsReply", () => {
  test("does not reply when the anchor is still recent", () => {
    const visibleMessages = ["1", "2", "3", "4"].map(makeMessage);
    expect(shouldSendAsReply(makeSnapshot("3", visibleMessages))).toBe(false);
  });

  test("replies when the anchor is further up the chat", () => {
    const visibleMessages = ["1", "2", "3", "4", "5"].map(makeMessage);
    expect(shouldSendAsReply(makeSnapshot("1", visibleMessages))).toBe(true);
  });
});

describe("resolveChunkTypingStartedAt", () => {
  test("keeps the original typing start for the first chunk", () => {
    expect(
      resolveChunkTypingStartedAt({
        isFirst: true,
        firstChunkStartedAt: 1_000,
        streamStartedAt: 500,
        now: 2_000,
      }),
    ).toBe(1_000);
  });

  test("starts followup chunks when they actually become active", () => {
    expect(
      resolveChunkTypingStartedAt({
        isFirst: false,
        firstChunkStartedAt: 1_000,
        streamStartedAt: 500,
        now: 2_000,
      }),
    ).toBe(2_000);
  });
});
