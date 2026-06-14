import { describe, expect, test } from "bun:test";

import { buildProfileFromEvidence, buildRetrievalSummary } from "@/frank/memory";
import type { MemoryEvidence, MemoryProfile } from "@/frank/types";

describe("memory profile synthesis", () => {
  test("prefers high-salience evidence in the profile summary", () => {
    const evidence: MemoryEvidence[] = [
      {
        id: "1",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "projects",
        key: "project-frank",
        content: "Dom is working on Frank runtime",
        confidence: 0.9,
        salience: 0.95,
        pinned: true,
        suppressed: false,
        sourceEventId: "a",
        lastObservedAt: new Date().toISOString(),
      },
      {
        id: "2",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "preferences",
        key: "pref-architecture",
        content: "Dom prefers code-owned timing",
        confidence: 0.8,
        salience: 0.8,
        pinned: false,
        suppressed: false,
        sourceEventId: "b",
        lastObservedAt: new Date().toISOString(),
      },
    ];

    const profile = buildProfileFromEvidence(
      "guild",
      "user",
      "dom",
      "Dom",
      evidence,
    );

    expect(profile.summary).toContain("Dom is working on Frank runtime");
    expect(profile.profile.projects[0]).toBe("Dom is working on Frank runtime");
  });

  test("retrieval summary returns the stored profile summary", async () => {
    const profile: MemoryProfile = {
      guildId: "guild",
      subjectType: "user",
      subjectId: "dom-id",
      displayName: "dom",
      summary: "Dom is working on Frank runtime.",
      profile: {
        identity: ["Dom likes building weird chat systems"],
        preferences: ["Dom prefers code-owned timing"],
        projects: ["Dom is working on Frank runtime"],
        relationships: [],
        habits: ["Dom stress tests the bot in live chat"],
        goals: ["Dom wants Frank to feel more human"],
        recent_arc: ["Dom sent a zyn photo earlier"],
      },
      topEvidence: [],
      updatedAt: new Date().toISOString(),
    };

    expect(buildRetrievalSummary(profile)).toBe("Dom is working on Frank runtime.");
  });

  test("fallback profile keeps top distinct evidence without extra filtering", () => {
    const now = new Date().toISOString();
    const profile = buildProfileFromEvidence("guild", "user", "dom", "dom", [
      {
        id: "1",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "projects",
        key: "frank-v2-runtime",
        content: "Dom is working on Frank v2 in ~/Projects/frank",
        confidence: 0.95,
        salience: 0.95,
        pinned: true,
        suppressed: false,
        sourceEventId: "a",
        lastObservedAt: now,
      },
      {
        id: "2",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "projects",
        key: "frank-v2-upgrade",
        content: "Dom is upgrading Frank v2 with a simpler, more reliable runtime",
        confidence: 0.9,
        salience: 0.9,
        pinned: false,
        suppressed: false,
        sourceEventId: "b",
        lastObservedAt: now,
      },
      {
        id: "3",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "goals",
        key: "frank-v2-goal",
        content: "Dom wants Frank to feel more reliable and less bloated",
        confidence: 0.9,
        salience: 0.9,
        pinned: false,
        suppressed: false,
        sourceEventId: "c",
        lastObservedAt: now,
      },
      {
        id: "4",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "recent_arc",
        key: "frank-v2-formatting-fixes",
        content: "Dom was fixing formatting and crash issues in Frank v2",
        confidence: 0.85,
        salience: 0.75,
        pinned: false,
        suppressed: false,
        sourceEventId: "d",
        lastObservedAt: now,
      },
      {
        id: "5",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "preferences",
        key: "test-pings",
        content: "Dom likes testing pings and replies with Frank",
        confidence: 0.8,
        salience: 0.6,
        pinned: false,
        suppressed: false,
        sourceEventId: "e",
        lastObservedAt: now,
      },
      {
        id: "6",
        guildId: "guild",
        subjectType: "user",
        subjectId: "dom",
        category: "preferences",
        key: "conversation-boundary",
        content: "Dom prefers sexual or flirty conversation to be shut down",
        confidence: 0.9,
        salience: 0.85,
        pinned: false,
        suppressed: false,
        sourceEventId: "f",
        lastObservedAt: now,
      },
    ]);

    expect(profile.profile.projects).toHaveLength(2);
    expect(profile.profile.goals).toEqual([
      "Dom wants Frank to feel more reliable and less bloated",
    ]);
    expect(profile.profile.recent_arc).toEqual([
      "Dom was fixing formatting and crash issues in Frank v2",
    ]);
    expect(profile.profile.preferences).toEqual([
      "Dom prefers sexual or flirty conversation to be shut down",
      "Dom likes testing pings and replies with Frank",
    ]);
  });
});
