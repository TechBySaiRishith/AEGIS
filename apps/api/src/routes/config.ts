import { Hono } from "hono";
import type { LLMProvider } from "@aegis/shared";
import { getLLMRegistry, resetLLMRegistry } from "../llm/registry.js";

/** Map of configurable provider ids to the env var that gates their discovery. */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  github: "GITHUB_TOKEN",
  copilot: "COPILOT_GITHUB_TOKEN",
};

/** Providers that users can configure via the UI. */
const CONFIGURABLE_PROVIDERS: LLMProvider[] = [
  "anthropic",
  "openai",
  "github",
  "copilot",
];

const configRoutes = new Hono();

// ─── GET /  →  list provider status (no secrets) ────────────
configRoutes.get("/providers", (c) => {
  const registry = getLLMRegistry();
  const providers = registry.listProviders();

  const result = CONFIGURABLE_PROVIDERS.map((id) => {
    const entry = providers.find((p) => p.id === id);
    return {
      id,
      configured: !!entry?.available,
      model: entry?.model,
      isDefault: entry?.isDefault ?? false,
    };
  });

  return c.json({ providers: result });
});

// ─── POST /  →  set a provider API key at runtime ───────────
configRoutes.post("/providers", async (c) => {
  const body = await c.req.json<{ provider?: string; apiKey?: string }>();

  const { provider, apiKey } = body;

  if (!provider || typeof provider !== "string") {
    return c.json({ error: "Missing or invalid 'provider' field" }, 400);
  }

  if (!apiKey || typeof apiKey !== "string") {
    return c.json({ error: "Missing or invalid 'apiKey' field" }, 400);
  }

  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return c.json(
      {
        error: `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDER_ENV_MAP).join(", ")}`,
      },
      400,
    );
  }

  // Set the env var at runtime (memory only — never written to disk)
  process.env[envVar] = apiKey;

  // Force the LLM registry to re-discover providers with the new key
  resetLLMRegistry();
  const registry = getLLMRegistry();

  const updated = registry.listProviders().find((p) => p.id === provider);

  return c.json({
    success: true,
    provider,
    configured: !!updated?.available,
    model: updated?.model,
  });
});

export { configRoutes };
