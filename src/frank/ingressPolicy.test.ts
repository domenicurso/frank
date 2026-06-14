import { describe, expect, test } from "bun:test";

import { getIncomingMessageInterruptReason } from "@/frank/ingressPolicy";

describe("getIncomingMessageInterruptReason", () => {
  test("prefers direct mention interruption", () => {
    expect(
      getIncomingMessageInterruptReason({
        authorId: "user-1",
        mentionsBot: true,
        repliesToBot: false,
        pendingUnsentExecution: {
          latestAuthorId: "user-1",
        },
      }),
    ).toBe("new_direct_message");
  });

  test("uses reply interruption when replying to frank", () => {
    expect(
      getIncomingMessageInterruptReason({
        authorId: "user-1",
        mentionsBot: false,
        repliesToBot: true,
        pendingUnsentExecution: {
          latestAuthorId: "user-1",
        },
      }),
    ).toBe("new_reply");
  });

  test("interrupts unsent execution for same-speaker follow-up messages", () => {
    expect(
      getIncomingMessageInterruptReason({
        authorId: "user-1",
        mentionsBot: false,
        repliesToBot: false,
        pendingUnsentExecution: {
          latestAuthorId: "user-1",
        },
      }),
    ).toBe("channel_shift");
  });

  test("does not interrupt different-speaker chatter during a pending unsent execution", () => {
    expect(
      getIncomingMessageInterruptReason({
        authorId: "user-2",
        mentionsBot: false,
        repliesToBot: false,
        pendingUnsentExecution: {
          latestAuthorId: "user-1",
        },
      }),
    ).toBeNull();
  });

  test("does not interrupt ambient chatter when nothing provisional is in flight", () => {
    expect(
      getIncomingMessageInterruptReason({
        authorId: "user-1",
        mentionsBot: false,
        repliesToBot: false,
        pendingUnsentExecution: null,
      }),
    ).toBeNull();
  });
});
