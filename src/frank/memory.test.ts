import { describe, expect, test } from "bun:test";

import { buildProfileFromEvidence } from "@/frank/memory";
import type { MemoryEvidence } from "@/frank/types";

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
});
