import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMRegistry, resetLLMRegistry, getLLMRegistry } from "./registry";
import { parseModelSpec, moduleEnvKey } from "./provider";

// Keys discover() inspects on every construction. We clear them in the
// test-local beforeEach so leakage from the host environment (e.g. a
// developer running tests with ANTHROPIC_API_KEY set) doesn't pollute
// the "no providers" baseline scenarios.
const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "CUSTOM_LLM_BASE_URL",
  "CUSTOM_LLM_API_KEY",
  "AEGIS_DEFAULT_MODEL",
  "SENTINEL_MODEL",
  "WATCHDOG_MODEL",
  "GUARDIAN_MODEL",
];

describe("parseModelSpec", () => {
  it("parses a valid provider/model string", () => {
    expect(parseModelSpec("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("returns undefined when no slash is present", () => {
    expect(parseModelSpec("claude-sonnet-4-5")).toBeUndefined();
  });

  it("returns undefined when the slash has no model part", () => {
    expect(parseModelSpec("anthropic/")).toBeUndefined();
  });

  it("returns undefined for unknown providers", () => {
    expect(parseModelSpec("bogus/foo-bar")).toBeUndefined();
  });

  it("accepts all five supported providers", () => {
    for (const p of ["anthropic", "openai", "copilot", "github", "custom"]) {
      expect(parseModelSpec(`${p}/foo`)?.provider).toBe(p);
    }
  });
});

describe("moduleEnvKey", () => {
  it("uppercases the module id and appends _MODEL", () => {
    expect(moduleEnvKey("sentinel")).toBe("SENTINEL_MODEL");
    expect(moduleEnvKey("watchdog")).toBe("WATCHDOG_MODEL");
    expect(moduleEnvKey("guardian")).toBe("GUARDIAN_MODEL");
  });
});

describe("LLMRegistry", () => {
  beforeEach(() => {
    for (const key of PROVIDER_ENV_KEYS) {
      vi.stubEnv(key, "");
    }
    resetLLMRegistry();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetLLMRegistry();
  });

  it("discovers only the mock provider when no env keys are set", () => {
    const registry = new LLMRegistry();
    const providers = registry.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("mock");
    expect(registry.getDefault()?.id).toBe("mock");
  });

  it("registers the Anthropic provider when ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const registry = new LLMRegistry();
    const providers = registry.listProviders();
    expect(providers.map((p) => p.id)).toContain("anthropic");
    expect(registry.get("anthropic")?.isAvailable()).toBe(true);
  });

  it("picks Anthropic as default when it is the only available provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const registry = new LLMRegistry();
    const def = registry.getDefault();
    expect(def?.id).toBe("anthropic");
  });

  it("honours AEGIS_DEFAULT_MODEL to select a non-preferred provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    vi.stubEnv("AEGIS_DEFAULT_MODEL", "openai/gpt-4o-mini");
    const registry = new LLMRegistry();
    const def = registry.getDefault();
    expect(def?.id).toBe("openai");
    // Default model on the registered provider should reflect the env spec.
    expect(def?.model).toBe("gpt-4o-mini");
  });

  it("honours per-module overrides via <MODULE>_MODEL", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    vi.stubEnv("SENTINEL_MODEL", "openai/gpt-4o");
    const registry = new LLMRegistry();
    const sentinel = registry.getProviderForModule("sentinel");
    expect(sentinel.id).toBe("openai");
    expect(sentinel.model).toBe("gpt-4o");
  });

  it("falls back to the default provider when <MODULE>_MODEL is unresolvable", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("GUARDIAN_MODEL", "bogus/nothing");
    const registry = new LLMRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const guardian = registry.getProviderForModule("guardian");
    expect(guardian.id).toBe("anthropic");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("getProviderForModule returns mock when no real providers are registered", () => {
    const registry = new LLMRegistry();
    const provider = registry.getProviderForModule("sentinel");
    expect(provider.id).toBe("mock");
  });

  it("healthStatus reports every known provider with availability", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const registry = new LLMRegistry();
    const health = registry.healthStatus();
    expect(health.anthropic.available).toBe(true);
    expect(health.openai.available).toBe(false);
    expect(health.copilot.available).toBe(false);
    expect(health.github.available).toBe(false);
    expect(health.custom.available).toBe(false);
  });

  it("createProviderWithModel builds an ad-hoc provider without caching", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const registry = new LLMRegistry();
    const adhoc = registry.createProviderWithModel(
      "anthropic",
      "claude-opus-4-6",
    );
    expect(adhoc.model).toBe("claude-opus-4-6");
    // Original cached provider remains unchanged
    expect(registry.get("anthropic")?.model).not.toBe("claude-opus-4-6");
  });

  it("getLLMRegistry returns a cached singleton until resetLLMRegistry is called", () => {
    const a = getLLMRegistry();
    const b = getLLMRegistry();
    expect(a).toBe(b);
    resetLLMRegistry();
    const c = getLLMRegistry();
    expect(c).not.toBe(a);
  });
});
