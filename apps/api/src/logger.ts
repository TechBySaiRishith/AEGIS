/**
 * Minimal structured logger for AEGIS API.
 *
 * Respects LOG_LEVEL env var: "debug" | "info" | "warn" | "error"
 * Default level: "info"
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function currentLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (env in LEVEL_RANK) return env as LogLevel;
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel()];
}

function format(tag: string, message: string, data?: Record<string, unknown>): string {
  const base = `[${tag}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export const log = {
  debug(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("debug")) console.log(format(tag, message, data));
  },

  info(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("info")) console.log(format(tag, message, data));
  },

  warn(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(format(tag, message, data));
  },

  error(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("error")) console.error(format(tag, message, data));
  },
};
