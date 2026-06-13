import { logDebug } from "@/log";

const debugFlag = process.env.FRANK_DEBUG?.trim().toLowerCase();

const FRANK_DEBUG_ENABLED =
  debugFlag === "1" ||
  debugFlag === "true" ||
  debugFlag === "yes" ||
  debugFlag === "on";

function truncateString(value: string, max = 280) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...<truncated ${value.length - max} chars>`;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "<max-depth>";
  if (value == null) return value;

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message, 500),
      stack: truncateString(value.stack || "", 1200),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 24);
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, sanitize(entryValue, depth + 1)]),
    );
  }

  return String(value);
}

export function frankDebug(scope: string, event: string, payload?: unknown) {
  if (!FRANK_DEBUG_ENABLED) return;

  if (payload === undefined) {
    logDebug(`frank:${scope}`, event);
    return;
  }

  logDebug(`frank:${scope}`, event, sanitize(payload));
}

export function frankDebugEnabled() {
  return FRANK_DEBUG_ENABLED;
}
