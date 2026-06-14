import { describe, expect, test } from "bun:test";

import { getIncomingMessageInterruptReason } from "@/frank/ingressPolicy";

describe("getIncomingMessageInterruptReason", () => {
  test("prefers direct mention interruption", () => {
    expect(
      getIncomingMessageInterruptReason({
        mentionsBot: true,
        repliesToBot: false,
        hasPendingUnsentExecution: true,
      }),
    ).toBe("new_direct_message");
  });

  test("uses reply interruption when replying to frank", () => {
    expect(
      getIncomingMessageInterruptReason({
        mentionsBot: false,
        repliesToBot: true,
        hasPendingUnsentExecution: true,
      }),
    ).toBe("new_reply");
  });

  test("interrupts unsent execution for follow-up human messages", () => {
    expect(
      getIncomingMessageInterruptReason({
        mentionsBot: false,
        repliesToBot: false,
        hasPendingUnsentExecution: true,
      }),
    ).toBe("channel_shift");
  });

  test("does not interrupt ambient chatter when nothing provisional is in flight", () => {
    expect(
      getIncomingMessageInterruptReason({
        mentionsBot: false,
        repliesToBot: false,
        hasPendingUnsentExecution: false,
      }),
    ).toBeNull();
  });
});
