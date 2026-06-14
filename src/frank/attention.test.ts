import { describe, expect, test } from "bun:test";

import { decideAttention } from "@/frank/attention";
import type { ChannelRuntimeProjection, FrankGuildSettings } from "@/frank/types";

const settings: FrankGuildSettings = {
  enabled: true,
  attentionMode: "conversation-aware",
  opportunismLevel: 15,
  reactionsEnabled: true,
  burstResponsesEnabled: true,
  maxBurstMessages: 5,
  cooldownSeconds: 0,
  allowedMentions: true,
  allowedReplies: true,
};

const baseRuntime: ChannelRuntimeProjection = {
  guildId: "guild",
  channelId: "channel",
  visibleMessages: [],
  recentEventIds: [],
  activeIntentId: null,
  activeIntentRevision: null,
  activeSnapshotId: null,
  activeSnapshotCreatedAt: null,
  activeJobId: null,
  lastBotMessageId: "bot-1",
  lastBotSentAt: new Date(Date.now() - 30_000).toISOString(),
  lastMentionAt: null,
  pendingIntent: null,
  lastResponseEventId: null,
  lastHumanMessageAt: new Date().toISOString(),
};

describe("decideAttention", () => {
  test("responds to direct mentions", () => {
    const decision = decideAttention(
      {
        ...baseRuntime,
        visibleMessages: [
          {
            id: "m1",
            authorId: "user",
            authorName: "Dom",
            authorUsername: "dom",
            content: "frank what do you think",
            mentionsBot: true,
            replyToMessageId: null,
            createdAt: new Date().toISOString(),
            fromBot: false,
          },
        ],
      },
      {
        id: "m1",
        authorId: "user",
        authorName: "Dom",
        authorUsername: "dom",
        content: "frank what do you think",
        mentionsBot: true,
        replyToMessageId: null,
        createdAt: new Date().toISOString(),
        fromBot: false,
      },
      settings,
      "bot",
    );

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("direct_mention");
  });

  test("cooldown does not block direct mentions", () => {
    const decision = decideAttention(
      {
        ...baseRuntime,
        lastBotSentAt: new Date().toISOString(),
      },
      {
        id: "m2",
        authorId: "user",
        authorName: "Dom",
        authorUsername: "dom",
        content: "hello frank",
        mentionsBot: true,
        replyToMessageId: null,
        createdAt: new Date().toISOString(),
        fromBot: false,
      },
      {
        ...settings,
        cooldownSeconds: 60,
      },
      "bot",
    );

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("direct_mention");
  });

  test("respects cooldown for ambient messages", () => {
    const decision = decideAttention(
      {
        ...baseRuntime,
        lastBotSentAt: new Date().toISOString(),
      },
      {
        id: "m3",
        authorId: "user",
        authorName: "Dom",
        authorUsername: "dom",
        content: "what",
        mentionsBot: false,
        replyToMessageId: null,
        createdAt: new Date().toISOString(),
        fromBot: false,
      },
      {
        ...settings,
        cooldownSeconds: 60,
      },
      "bot",
    );

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe("cooldown");
  });

  test("treats the end of a same-author burst as directed when an earlier burst message summoned Frank", () => {
    const createdAt = new Date().toISOString();
    const decision = decideAttention(
      {
        ...baseRuntime,
        visibleMessages: [
          {
            id: "m4",
            authorId: "user",
            authorName: "Dom",
            authorUsername: "dom",
            content: "frank",
            mentionsBot: true,
            replyToMessageId: null,
            createdAt,
            fromBot: false,
          },
          {
            id: "m5",
            authorId: "user",
            authorName: "Dom",
            authorUsername: "dom",
            content: "is your queue working",
            mentionsBot: false,
            replyToMessageId: null,
            createdAt,
            fromBot: false,
          },
          {
            id: "m6",
            authorId: "user",
            authorName: "Dom",
            authorUsername: "dom",
            content: "who knows",
            mentionsBot: false,
            replyToMessageId: null,
            createdAt,
            fromBot: false,
          },
        ],
      },
      {
        id: "m6",
        authorId: "user",
        authorName: "Dom",
        authorUsername: "dom",
        content: "who knows",
        mentionsBot: false,
        replyToMessageId: null,
        createdAt,
        fromBot: false,
      },
      settings,
      "bot",
    );

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe("continuation");
    expect(decision.targetMessageId).toBe("m6");
  });
});
