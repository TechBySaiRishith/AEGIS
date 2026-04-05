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
import { MockProvider } from "./mock.js";

// ─── Default models per provider ─────────────────────────────

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: "claude-sonnet-4-5-20250514",
  openai: "gpt-4o",
  github: "gpt-4o-mini",
  custom: "default",
  mock: "mock-v1",
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
    const isMock = process.env.MOCK_MODE === "1";

    // Mock is always registered when MOCK_MODE is on
    if (isMock) {
      this.register(new MockProvider());
    }

    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.register(
        new AnthropicProvider(DEFAULT_MODELS.anthropic),
      );
    }

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.register(createOpenAIProvider(DEFAULT_MODELS.openai));
    }

    // GitHub Models
    if (process.env.GITHUB_TOKEN) {
      this.register(
        createGitHubModelsProvider(DEFAULT_MODELS.github),
      );
    }

    // Custom OpenAI-compatible
    if (process.env.CUSTOM_LLM_BASE_URL && process.env.CUSTOM_LLM_API_KEY) {
      this.register(createCustomProvider(DEFAULT_MODELS.custom));
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

    // Mock takes priority in mock mode
    if (process.env.MOCK_MODE === "1" && this.providers.has("mock")) {
      return "mock";
    }

    // First available in preference order
    const order: LLMProviderType[] = [
      "anthropic",
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
        "Set at least one API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN) " +
        "or enable MOCK_MODE=1.",
    );
  }

  /** Create an ad-hoc provider with a specific model (not cached in registry) */
  private createWithModel(
    providerId: LLMProviderType,
    model: string,
  ): LLMProvider {
    switch (providerId) {
      case "anthropic":
        return new AnthropicProvider(model);
      case "openai":
        return createOpenAIProvider(model);
      case "github":
        return createGitHubModelsProvider(model);
      case "custom":
        return createCustomProvider(model);
      case "mock":
        return new MockProvider();
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
      "github",
      "custom",
      "mock",
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
