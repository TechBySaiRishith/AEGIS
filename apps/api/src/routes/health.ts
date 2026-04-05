import { Hono } from "hono";
import { APP_VERSION } from "@aegis/shared";
import { getLLMRegistry } from "../llm/registry.js";

const health = new Hono();

health.get("/", (c) => {
  const registry = getLLMRegistry();

  return c.json({
    status: "ok",
    version: APP_VERSION,
    providers: registry.healthStatus(),
    modules: {
      sentinel: { ready: registry.getDefault() !== undefined },
      watchdog: { ready: registry.getDefault() !== undefined },
      guardian: { ready: registry.getDefault() !== undefined },
    },
  });
});

export { health };
