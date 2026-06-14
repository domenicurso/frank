import { describe, expect, test } from "bun:test";

import {
  buildResponseSnapshot,
  chooseAnchorMessageId,
  isBareSummonContent,
  resolveFocusMessages,
} from "@/frank/snapshot";
import type {
  ChannelRuntimeProjection,
  Concern,
  ConversationLane,
  FrankGuildSettings,
  VisibleMessage,
} from "@/frank/types";

const settings: FrankGuildSettings = {
  enabled: true,
  attentionMode: "conversation-aware",
  opportunismLevel: 0,
  reactionsEnabled: true,
  burstResponsesEnabled: true,
  maxBurstMessages: 8,
  cooldownSeconds: 0,
  allowedMentions: true,
  allowedReplies: true,
};

function makeMessage(overrides: Partial<VisibleMessage> = {}): VisibleMessage {
  return {
    id: overrides.id ?? "m1",
    authorId: overrides.authorId ?? "user-1",
    authorName: overrides.authorName ?? "Dom",
    authorUsername: overrides.authorUsername ?? "dom",
    content: overrides.content ?? "frank can you help me",
    mentionsBot: overrides.mentionsBot ?? true,
    repliesToBot: overrides.repliesToBot ?? false,
    replyToMessageId: overrides.replyToMessageId ?? null,
    replyPreview: overrides.replyPreview ?? null,
    mentionedUsers: overrides.mentionedUsers ?? [],
    mentionedChannels: overrides.mentionedChannels ?? [],
    attachments: overrides.attachments ?? [],
    createdAt: overrides.createdAt ?? "2026-06-13T23:00:00.000Z",
    fromBot: overrides.fromBot ?? false,
  };
}

function makeRuntime(messages: VisibleMessage[]): ChannelRuntimeProjection {
  return {
    guildId: "guild",
    channelId: "channel",
    visibleMessages: messages,
    recentEventIds: [],
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
    activeJobId: null,
    lastBotMessageId: "bot-1",
    lastBotSentAt: null,
    lastMentionAt: null,
    pendingIntent: null,
    lastResponseEventId: null,
    lastHumanMessageAt: messages[messages.length - 1]?.createdAt ?? null,
  };
}

function makeLane(overrides: Partial<ConversationLane> = {}): ConversationLane {
  return {
    laneKey: overrides.laneKey ?? "author:user-1",
    guildId: "guild",
    channelId: "channel",
    authorId: "user-1",
    replyRootMessageId: overrides.replyRootMessageId ?? null,
    status: overrides.status ?? "queued",
    activeConcernId: overrides.activeConcernId ?? "concern-1",
    activeTurnId: overrides.activeTurnId ?? null,
    lastHumanActivityAt: overrides.lastHumanActivityAt ?? null,
    lastBotActivityAt: overrides.lastBotActivityAt ?? null,
    updatedAt: overrides.updatedAt ?? "2026-06-13T23:00:00.000Z",
  };
}

function makeConcern(overrides: Partial<Concern> = {}): Concern {
  return {
    id: overrides.id ?? "concern-1",
    laneKey: overrides.laneKey ?? "author:user-1",
    guildId: "guild",
    channelId: "channel",
    sourceEventIds: overrides.sourceEventIds ?? ["e1", "e2", "e3"],
    sourceMessageIds: overrides.sourceMessageIds ?? ["m1", "m2", "m3"],
    focusAuthorId: overrides.focusAuthorId ?? "user-1",
    anchorMessageId: overrides.anchorMessageId ?? null,
    status: overrides.status ?? "queued",
    supersededByConcernId: overrides.supersededByConcernId ?? null,
    reasonCode: overrides.reasonCode ?? "direct_mention",
    attemptCount: overrides.attemptCount ?? 0,
    snapshotId: overrides.snapshotId ?? null,
    snapshotCreatedAt: overrides.snapshotCreatedAt ?? null,
    snapshot: overrides.snapshot ?? null,
    createdAt: overrides.createdAt ?? "2026-06-13T23:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-13T23:00:00.000Z",
  };
}

describe("snapshot concern focus", () => {
  test("resolves merged focus messages in source order", () => {
    const runtime = makeRuntime([
      makeMessage({ id: "m1", content: "frank can you help me", mentionsBot: true }),
      makeMessage({ id: "m2", content: "its for finals", mentionsBot: false }),
      makeMessage({ id: "m3", content: "its this week", mentionsBot: false }),
    ]);

    const focus = resolveFocusMessages(runtime, makeConcern());
    expect(focus.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  });

  test("anchors a merged concern to the initiating direct ask over later fragments", () => {
    const lane = makeLane();
    const focusMessages = [
      makeMessage({ id: "m1", content: "frank can you help me", mentionsBot: true }),
      makeMessage({ id: "m2", content: "its for finals", mentionsBot: false }),
      makeMessage({ id: "m3", content: "its this week", mentionsBot: false }),
    ];

    expect(chooseAnchorMessageId(focusMessages, lane)).toBe("m1");
  });

  test("treats bare summons as summons", () => {
    expect(isBareSummonContent("frank")).toBe(true);
    expect(isBareSummonContent("frank botello")).toBe(true);
    expect(isBareSummonContent("frank what is this")).toBe(false);
  });

  test("builds a concern snapshot with focus messages and anchor", async () => {
    const runtime = makeRuntime([
      makeMessage({ id: "m1", content: "frank", mentionsBot: true }),
      makeMessage({ id: "m2", content: "what is trickle down economics", mentionsBot: false }),
    ]);
    const concern = makeConcern({
      sourceMessageIds: ["m1", "m2"],
      reasonCode: "bare_summon",
    });
    const lane = makeLane();

    const snapshot = await buildResponseSnapshot({
      runtime,
      concern,
      lane,
      settings,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.focusMessages?.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(snapshot?.anchorMessageId).toBe("m2");
  });

  test("includes a wider recent-message tail in snapshot context", async () => {
    const runtime = makeRuntime(
      Array.from({ length: 10 }, (_, index) =>
        makeMessage({
          id: `m${index + 1}`,
          content: `message ${index + 1}`,
          mentionsBot: index === 1,
          createdAt: `2026-06-13T23:00:${String(index).padStart(2, "0")}.000Z`,
        }),
      ),
    );
    const concern = makeConcern({
      sourceMessageIds: ["m2"],
      reasonCode: "direct_mention",
    });
    const lane = makeLane();

    const snapshot = await buildResponseSnapshot({
      runtime,
      concern,
      lane,
      settings,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.visibleMessages.map((message) => message.id)).toEqual([
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
    ]);
  });
});
