import chalk from "chalk";
import { inspect } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelStyles: Record<LogLevel, (value: string) => string> = {
  debug: chalk.cyan,
  info: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
};

function timestamp() {
  return chalk.gray(
    new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: false,
    }),
  );
}

function scopeLabel(scope: string, level: LogLevel) {
  return levelStyles[level](scope.toUpperCase().padEnd(10));
}

function formatPayload(payload: unknown) {
  return inspect(payload, {
    colors: true,
    compact: false,
    depth: 6,
    breakLength: 100,
    sorted: true,
    // maxArrayLength: 12,
    maxStringLength: 320,
  })
    .split("\n")
    .map((line) => `  ${chalk.gray("│")} ${line}`)
    .join("\n");
}

export function logLine(
  level: LogLevel,
  scope: string,
  message: string,
  payload?: unknown,
) {
  const color = levelStyles[level];
  console.log(`${timestamp()} ${scopeLabel(scope, level)} ${color(message)}`);
  if (payload !== undefined) {
    console.log(formatPayload(payload));
  }
}

export function logDebug(scope: string, message: string, payload?: unknown) {
  logLine("debug", scope, message, payload);
}

export function logInfo(scope: string, message: string, payload?: unknown) {
  logLine("info", scope, message, payload);
}

export function logWarn(scope: string, message: string, payload?: unknown) {
  logLine("warn", scope, message, payload);
}

export function logError(
  scope: string,
  message: string,
  error?: unknown,
  payload?: unknown,
) {
  logLine("error", scope, message, payload);
  if (error !== undefined) {
    console.log(formatPayload(error));
  }
}
