import { Hono } from "hono";
import type { HealthResponse, LLMProvider, ExpertModuleId } from "@aegis/shared";
import { config, availableProviders } from "../config.js";

const health = new Hono();

health.get("/", (c) => {
  const providers = availableProviders();

  const providerMap = (
    ["anthropic", "openai", "github", "custom", "mock"] as LLMProvider[]
  ).reduce(
    (acc, p) => {
      const modelRef =
        p === "anthropic" ? config.sentinelModel :
        p === "openai" ? config.watchdogModel :
        p === "mock" ? (config.mockMode ? { model: "mock" } : null) :
        null;

      acc[p] = {
        available: providers.includes(p),
        ...(modelRef ? { model: modelRef.model } : {}),
      };
      return acc;
    },
    {} as HealthResponse["providers"],
  );

  const modules: HealthResponse["modules"] = {
    sentinel: { ready: providers.length > 0 },
    watchdog: { ready: providers.length > 0 },
    guardian: { ready: providers.length > 0 },
  };

  const body: HealthResponse = {
    status: "ok",
    version: "0.1.0",
    providers: providerMap,
    modules,
  };

  return c.json(body);
});

export { health };
