import {
  FRANK_DEFAULT_TYPING_CPS,
  FRANK_MAX_BURST_MESSAGES,
  FRANK_MAX_TYPING_MS,
  FRANK_MIN_TYPING_MS,
} from "@/frank/constants";
import type { BurstPlan } from "@/frank/types";

export function validateBurstPlan(
  plan: BurstPlan,
  maxMessages = FRANK_MAX_BURST_MESSAGES,
): BurstPlan {
  const chunks = plan.chunks
    .map((chunk) => ({
      text: chunk.text.trim(),
      pauseMs: chunk.pauseMs,
    }))
    .filter((chunk) => chunk.text.length > 0)
    .slice(0, maxMessages)
    .map((chunk) => ({
      text: chunk.text.slice(0, 1_900),
      pauseMs:
        typeof chunk.pauseMs === "number"
          ? Math.max(0, Math.min(4_000, Math.round(chunk.pauseMs)))
          : undefined,
    }));

  if (chunks.length === 0) {
    return {
      chunks: [{ text: "..." }],
    };
  }

  return {
    chunks,
    reactionEmoji: plan.reactionEmoji ?? null,
  };
}

export function estimateTypingMs(text: string) {
  const base = (text.length / FRANK_DEFAULT_TYPING_CPS) * 1_000;
  const variance = base * 0.2 * Math.random();
  const total = base + variance;
  return Math.max(FRANK_MIN_TYPING_MS, Math.min(FRANK_MAX_TYPING_MS, total));
}
