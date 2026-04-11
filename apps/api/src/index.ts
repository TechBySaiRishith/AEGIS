import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { config, validateConfig, availableProviders } from "./config.js";
import { health } from "./routes/health.js";
import { evaluate } from "./routes/evaluate.js";
import { configRoutes } from "./routes/config.js";

// ─── Validate environment before anything else ─────────────

validateConfig();

// ─── App ───────────────────────────────────────────────────

const app = new Hono();

// Global middleware
app.use("*", cors({ origin: config.corsOrigin }));
app.use("*", logger());

// Global error handler
app.onError((err, c) => {
  console.error("[AEGIS] Unhandled error:", err);
  return c.json({ error: err.message ?? "Internal server error" }, 500);
});

// ─── Routes ────────────────────────────────────────────────

app.route("/api/health", health);
app.route("/api/evaluate", evaluate);
app.route("/api/evaluations", evaluate);
app.route("/api/config", configRoutes);

// ─── Startup banner ────────────────────────────────────────

function printBanner(): void {
  const providers = availableProviders();
  const modulesReady = providers.length > 0;

  console.log("");
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│           🛡️  AEGIS AI SAFETY LAB             │");
  console.log("│          Council of Experts Engine            │");
  console.log("├──────────────────────────────────────────────┤");
  console.log(`│  Port:       ${String(config.port).padEnd(32)}│`);
  console.log(`│  CORS:       ${config.corsOrigin.padEnd(32)}│`);
  console.log(`│  Providers:  ${(providers.length ? providers.join(", ") : "none").padEnd(32)}│`);
  console.log(`│  Modules:    ${(modulesReady ? "sentinel, watchdog, guardian" : "waiting for provider").padEnd(32)}│`);
  console.log(`│  Data dir:   ${config.dataDir.padEnd(32)}│`);
  console.log("└──────────────────────────────────────────────┘");
  console.log("");
}

// ─── Start server ──────────────────────────────────────────

serve({ fetch: app.fetch, port: config.port }, () => {
  printBanner();
});

export { app };
