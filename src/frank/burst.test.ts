import { describe, expect, test } from "bun:test";

import { validateBurstPlan } from "@/frank/burst";

describe("validateBurstPlan", () => {
  test("drops empty chunks and enforces max chunk count", () => {
    const plan = validateBurstPlan(
      {
        chunks: [
          { text: "  " },
          { text: "one" },
          { text: "two" },
          { text: "three" },
        ],
        reactionEmoji: "🔥",
      },
      2,
    );

    expect(plan.chunks.map((chunk) => chunk.text)).toEqual(["one", "two"]);
    expect(plan.reactionEmoji).toBe("🔥");
  });

  test("falls back to placeholder when every chunk is empty", () => {
    const plan = validateBurstPlan({
      chunks: [{ text: "   " }, { text: "" }],
      reactionEmoji: null,
    });

    expect(plan.chunks).toEqual([{ text: "..." }]);
    expect(plan.reactionEmoji).toBeUndefined();
  });
});
