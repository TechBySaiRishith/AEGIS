import type {
  LLMProvider as LLMProviderType,
  ExpertModuleId,
} from "@aegis/shared";
import {
  type LLMProvider,
  parseModelSpec,
  moduleEnvKey,
} from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import {
  createOpenAIProvider,
  createGitHubModelsProvider,
  createCustomProvider,
} from "./openai-compat.js";
import { CopilotProvider, isCopilotAvailable } from "./copilot.js";

// ─── Default models per provider ─────────────────────────────

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: "claude-sonnet-4-5-20250514",
  openai: "gpt-4o",
  copilot: "claude-sonnet-4.5",
  github: "gpt-4.1-mini",
  custom: "default",
};

// ─── Registry ────────────────────────────────────────────────

export class LLMRegistry {
  private providers = new Map<LLMProviderType, LLMProvider>();
  private defaultProvider: LLMProviderType | null = null;

  constructor() {
    this.discover();
  }

  /** Scan environment variables and register every provider that has credentials */
  private discover(): void {
    // If AEGIS_DEFAULT_MODEL points at a provider, use its model when
    // registering that provider so health/status endpoints report the
    // operator's configured model rather than the hardcoded fallback.
    const envDefault = process.env.AEGIS_DEFAULT_MODEL;
    const envDefaultParsed = envDefault ? parseModelSpec(envDefault) : undefined;
    const modelFor = (p: LLMProviderType): string =>
      envDefaultParsed?.provider === p ? envDefaultParsed.model : DEFAULT_MODELS[p];

    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.register(new AnthropicProvider(modelFor("anthropic")));
    }

    // GitHub Copilot (premium models via api.githubcopilot.com)
    if (isCopilotAvailable()) {
      this.register(new CopilotProvider(modelFor("copilot")));
    }

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.register(createOpenAIProvider(modelFor("openai")));
    }

    // GitHub Models
    if (process.env.GITHUB_TOKEN && !process.env.GITHUB_TOKEN.startsWith("ghu_")) {
      this.register(createGitHubModelsProvider(modelFor("github")));
    }

    // Custom OpenAI-compatible
    if (process.env.CUSTOM_LLM_BASE_URL && process.env.CUSTOM_LLM_API_KEY) {
      this.register(createCustomProvider(modelFor("custom")));
    }

    // Resolve default
    this.defaultProvider = this.resolveDefault();
  }

  private register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  private resolveDefault(): LLMProviderType | null {
    // Explicit env var
    const envDefault = process.env.AEGIS_DEFAULT_MODEL;
    if (envDefault) {
      const parsed = parseModelSpec(envDefault);
      if (parsed && this.providers.has(parsed.provider)) {
        return parsed.provider;
      }
    }

    // First available in preference order
    const order: LLMProviderType[] = [
      "anthropic",
      "copilot",
      "openai",
      "github",
      "custom",
    ];
    for (const p of order) {
      if (this.providers.has(p)) return p;
    }

    return null;
  }

  // ─── Public API ──────────────────────────────────────────

  /** Get a provider by id, or undefined */
  get(id: LLMProviderType): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /** Get the default provider (first available or explicitly configured) */
  getDefault(): LLMProvider | undefined {
    if (!this.defaultProvider) return undefined;
    return this.providers.get(this.defaultProvider);
  }

  /**
   * Resolve the provider for a specific expert module.
   *
   * Resolution order:
   * 1. `<MODULE>_MODEL` env var (e.g. SENTINEL_MODEL=anthropic/claude-sonnet-4-5-20250514)
   * 2. `AEGIS_DEFAULT_MODEL` env var
   * 3. First available provider
   */
  getProviderForModule(moduleId: ExpertModuleId): LLMProvider {
    // 1. Per-module override
    const moduleSpec = process.env[moduleEnvKey(moduleId)];
    if (moduleSpec) {
      const parsed = parseModelSpec(moduleSpec);
      if (parsed) {
        const existing = this.providers.get(parsed.provider);
        if (existing) {
          // If the model differs from the registered default, create a
          // fresh provider with the requested model.
          if (existing.model !== parsed.model) {
            return this.createWithModel(parsed.provider, parsed.model);
          }
          return existing;
        }
      }
      console.warn(
        `[llm] ${moduleEnvKey(moduleId)}="${moduleSpec}" could not be resolved — falling back to default`,
      );
    }

    // 2–3. Default / AEGIS_DEFAULT_MODEL
    const envDefault = process.env.AEGIS_DEFAULT_MODEL;
    if (envDefault) {
      const parsed = parseModelSpec(envDefault);
      if (parsed) {
        const existing = this.providers.get(parsed.provider);
        if (existing) {
          if (existing.model !== parsed.model) {
            return this.createWithModel(parsed.provider, parsed.model);
          }
          return existing;
        }
      }
    }

    const fallback = this.getDefault();
    if (fallback) return fallback;

    throw new Error(
      `[llm] No LLM provider available for module "${moduleId}". ` +
        "Set at least one API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, COPILOT_GITHUB_TOKEN, GITHUB_TOKEN).",
    );
  }

  /** Create an ad-hoc provider with a specific model (not cached in registry) */
  createProviderWithModel(
    providerId: LLMProviderType,
    model: string,
  ): LLMProvider {
    return this.createWithModel(providerId, model);
  }

  /** Create an ad-hoc provider with a specific model (not cached in registry) */
  private createWithModel(
    providerId: LLMProviderType,
    model: string,
  ): LLMProvider {
    switch (providerId) {
      case "anthropic":
        return new AnthropicProvider(model);
      case "copilot":
        return new CopilotProvider(model);
      case "openai":
        return createOpenAIProvider(model);
      case "github":
        return createGitHubModelsProvider(model);
      case "custom":
        return createCustomProvider(model);
    }
  }

  /** List all registered providers with availability status */
  listProviders(): Array<{
    id: LLMProviderType;
    available: boolean;
    model: string;
    isDefault: boolean;
  }> {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      available: p.isAvailable(),
      model: p.model,
      isDefault: p.id === this.defaultProvider,
    }));
  }

  /** Health-check record matching the HealthResponse.providers shape */
  healthStatus(): Record<
    LLMProviderType,
    { available: boolean; model?: string }
  > {
    const all: LLMProviderType[] = [
      "anthropic",
      "openai",
      "copilot",
      "github",
      "custom",
    ];
    const result = {} as Record<
      LLMProviderType,
      { available: boolean; model?: string }
    >;
    for (const id of all) {
      const p = this.providers.get(id);
      result[id] = p
        ? { available: p.isAvailable(), model: p.model }
        : { available: false };
    }
    return result;
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _instance: LLMRegistry | null = null;

export function getLLMRegistry(): LLMRegistry {
  if (!_instance) {
    _instance = new LLMRegistry();
  }
  return _instance;
}

/** Reset the singleton (useful for tests) */
export function resetLLMRegistry(): void {
  _instance = null;
}
