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
  activeSnapshotId: null,
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
});
