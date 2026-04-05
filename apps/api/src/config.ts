import "dotenv/config";
import type { LLMProvider } from "@aegis/shared";
import { isCopilotAvailable } from "./llm/copilot.js";

// ─── Helpers ───────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) return "";
  return value;
}

function parseModelRef(raw: string): { provider: LLMProvider; model: string } | null {
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash === -1) return null;
  const provider = raw.slice(0, slash) as LLMProvider;
  const model = raw.slice(slash + 1);
  if (!model) return null;
  return { provider, model };
}

// ─── Config object ─────────────────────────────────────────

export const config = {
  port: Number(env("PORT", "3001")),
  corsOrigin: env("CORS_ORIGIN", "http://localhost:3000"),
  dataDir: env("DATA_DIR", "./data"),
  mockMode: env("MOCK_MODE") === "1",

  // API keys
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  openaiApiKey: env("OPENAI_API_KEY"),
  githubToken: env("GITHUB_TOKEN"),
  customLlmBaseUrl: env("CUSTOM_LLM_BASE_URL"),
  customLlmApiKey: env("CUSTOM_LLM_API_KEY"),

  // Per-module model overrides (format: "provider/model-name")
  sentinelModel: parseModelRef(env("SENTINEL_MODEL")),
  watchdogModel: parseModelRef(env("WATCHDOG_MODEL")),
  guardianModel: parseModelRef(env("GUARDIAN_MODEL")),
  synthesizerModel: parseModelRef(env("SYNTHESIZER_MODEL")),

  // Fallback model used when no module-specific override is set
  defaultModel: parseModelRef(env("AEGIS_DEFAULT_MODEL")),
} as const;

export type Config = typeof config;

// ─── Provider availability ─────────────────────────────────

export function availableProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];
  if (config.anthropicApiKey) providers.push("anthropic");
  if (isCopilotAvailable()) providers.push("copilot");
  if (config.openaiApiKey) providers.push("openai");
  if (config.githubToken) providers.push("github");
  if (config.customLlmBaseUrl && config.customLlmApiKey) providers.push("custom");
  if (config.mockMode) providers.push("mock");
  return providers;
}

// ─── Startup validation ────────────────────────────────────

export function validateConfig(): void {
  const hasKey =
    config.anthropicApiKey ||
    config.openaiApiKey ||
    config.githubToken ||
    (config.customLlmBaseUrl && config.customLlmApiKey) ||
    isCopilotAvailable();

  if (!hasKey && !config.mockMode) {
    throw new Error(
      "AEGIS startup failed: no LLM API key configured and MOCK_MODE is not enabled.\n" +
        "Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN, COPILOT_GITHUB_TOKEN, " +
        "CUSTOM_LLM_BASE_URL+CUSTOM_LLM_API_KEY, or set MOCK_MODE=1."
    );
  }
}
