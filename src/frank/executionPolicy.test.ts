import { describe, expect, test } from "bun:test";

import {
  isAbortLikeError,
  normalizeExecutionAbortReason,
  shouldFinalizeBurstChunk,
} from "@/frank/executionPolicy";

describe("shouldFinalizeBurstChunk", () => {
  test("finalizes immediately when the next chunk already exists", () => {
    expect(
      shouldFinalizeBurstChunk({
        chunkText: "depends",
        nextChunkText: "what is it",
        stableForMs: 0,
        finalPlanResolved: false,
      }),
    ).toBe(true);
  });

  test("finalizes a stable complete thought before the final object resolves", () => {
    expect(
      shouldFinalizeBurstChunk({
        chunkText: "yeah send it over.",
        stableForMs: 400,
        finalPlanResolved: false,
      }),
    ).toBe(true);
  });

  test("forces short chunk delivery after a longer stall", () => {
    expect(
      shouldFinalizeBurstChunk({
        chunkText: "hey",
        stableForMs: 950,
        finalPlanResolved: false,
      }),
    ).toBe(true);
  });
});

describe("execution abort helpers", () => {
  test("normalizes interruption reasons", () => {
    expect(normalizeExecutionAbortReason("new_direct_message")).toBe(
      "new_direct_message",
    );
    expect(normalizeExecutionAbortReason(new Error("TimeoutError"))).toBe(
      "worker_timeout",
    );
  });

  test("recognizes abort-like errors", () => {
    expect(isAbortLikeError(new Error("new_reply"))).toBe(true);
    expect(isAbortLikeError(new Error("aborted"))).toBe(true);
    expect(isAbortLikeError(new Error("boom"))).toBe(false);
  });
});
