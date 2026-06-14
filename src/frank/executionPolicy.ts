import {
  FRANK_STREAM_FORCE_CHUNK_MS,
  FRANK_STREAM_STABLE_CHUNK_MS,
} from "@/frank/constants";
import type { InvalidationReason } from "@/frank/types";

const INVALIDATION_REASONS = new Set<InvalidationReason>([
  "message_deleted",
  "message_edited",
  "new_direct_message",
  "new_reply",
  "channel_shift",
  "manual_abort",
  "worker_timeout",
]);

function countWords(text: string) {
  let words = 0;
  let inWord = false;

  for (const char of text) {
    const isWhitespace = char === " " || char === "\n" || char === "\t";
    if (isWhitespace) {
      inWord = false;
      continue;
    }

    if (!inWord) {
      words += 1;
      inWord = true;
    }
  }

  return words;
}

function endsWithThoughtBoundary(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lastChar = trimmed[trimmed.length - 1];
  return (
    lastChar === "." ||
    lastChar === "!" ||
    lastChar === "?" ||
    trimmed.includes("\n")
  );
}

export function shouldFinalizeBurstChunk(options: {
  chunkText: string;
  nextChunkText?: string | null;
  stableForMs: number;
  finalPlanResolved: boolean;
}) {
  const chunkText = options.chunkText.trim();
  if (!chunkText) {
    return false;
  }

  if (options.nextChunkText?.trim()) {
    return true;
  }

  if (options.finalPlanResolved) {
    return true;
  }

  if (options.stableForMs >= FRANK_STREAM_FORCE_CHUNK_MS) {
    return true;
  }

  if (options.stableForMs < FRANK_STREAM_STABLE_CHUNK_MS) {
    return false;
  }

  return (
    endsWithThoughtBoundary(chunkText) ||
    chunkText.length >= 18 ||
    countWords(chunkText) >= 4
  );
}

export function normalizeExecutionAbortReason(
  reason: unknown,
): InvalidationReason {
  const value =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? reason.message
        : typeof reason === "object" &&
            reason !== null &&
            "name" in reason &&
            typeof reason.name === "string"
          ? reason.name
          : "";

  if (INVALIDATION_REASONS.has(value as InvalidationReason)) {
    return value as InvalidationReason;
  }

  const lowered = value.toLowerCase();
  if (lowered.includes("timeout")) {
    return "worker_timeout";
  }

  return "manual_abort";
}

export function isAbortLikeError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return true;
    }

    if (INVALIDATION_REASONS.has(error.message as InvalidationReason)) {
      return true;
    }

    return error.message.toLowerCase().includes("aborted");
  }

  if (typeof error === "string") {
    if (INVALIDATION_REASONS.has(error as InvalidationReason)) {
      return true;
    }

    return error.toLowerCase().includes("aborted");
  }

  return false;
}
