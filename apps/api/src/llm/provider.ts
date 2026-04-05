import type {
  LLMProvider as LLMProviderType,
  LLMResponse,
  ExpertModuleId,
} from "@aegis/shared";

// ─── Completion Options ──────────────────────────────────────
export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// ─── Provider Interface ──────────────────────────────────────
export interface LLMProvider {
  /** Unique provider key — matches the shared LLMProvider union */
  readonly id: LLMProviderType;

  /** Human-readable name for logs / health endpoint */
  readonly displayName: string;

  /** The model identifier this provider instance will use */
  readonly model: string;

  /** Send a prompt and receive a completion */
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;

  /** True when the provider has valid credentials configured */
  isAvailable(): boolean;
}

// ─── Error Types ─────────────────────────────────────────────

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly provider: LLMProviderType,
    public readonly code: "auth" | "timeout" | "rate_limit" | "unknown",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

// ─── Constants ───────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes per attempt
export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 5_000; // 5s base → 5s, 15s, 45s exponential

/**
 * Parse a model spec of the form "provider/model-name" into its parts.
 * Returns undefined when the string doesn't match.
 */
export function parseModelSpec(
  spec: string,
): { provider: LLMProviderType; model: string } | undefined {
  const slash = spec.indexOf("/");
  if (slash < 1) return undefined;
  const provider = spec.slice(0, slash) as LLMProviderType;
  const model = spec.slice(slash + 1);
  if (!model) return undefined;
  const valid: LLMProviderType[] = [
    "anthropic",
    "openai",
    "copilot",
    "github",
    "custom",
  ];
  if (!valid.includes(provider)) return undefined;
  return { provider, model };
}

/** Env-var name for per-module model overrides */
export function moduleEnvKey(moduleId: ExpertModuleId): string {
  return `${moduleId.toUpperCase()}_MODEL`;
}
