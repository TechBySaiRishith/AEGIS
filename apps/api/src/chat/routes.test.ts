import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock DB-dependent modules before importing the router
vi.mock("../db/queries.js", () => ({
  getEvaluation: vi.fn(),
}));
vi.mock("./storage.js", () => ({
  listChatMessages: vi.fn(() => []),
  countChatMessages: vi.fn(() => 0),
  deleteChatThread: vi.fn(),
  insertChatMessage: vi.fn(),
  updateChatMessage: vi.fn(),
}));
vi.mock("../llm/registry.js", () => ({
  getLLMRegistry: vi.fn(() => ({ getDefault: vi.fn(() => null) })),
}));
vi.mock("./service.js", () => ({
  streamChatTurn: vi.fn(),
}));
vi.mock("./eventBus.js", () => ({
  publish: vi.fn(),
  replay: vi.fn(() => []),
  subscribe: vi.fn(() => () => {}),
}));

import { getEvaluation } from "../db/queries.js";
import { countChatMessages } from "./storage.js";
import { getLLMRegistry } from "../llm/registry.js";
import { chat } from "./routes.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/evaluations", chat);
  return app;
}

describe("chat routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /:id/messages → 404 for unknown evaluation", async () => {
    vi.mocked(getEvaluation).mockReturnValue(null as never);
    const app = makeApp();
    const res = await app.request("/api/evaluations/unknown-eval/messages");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("POST /:id/messages → 429 when rate-limiter blocks", async () => {
    // Use an evaluation ID that will be found but then saturate the limiter
    const evalId = `rl-test-${Date.now()}`;
    vi.mocked(getEvaluation).mockReturnValue({ id: evalId } as never);
    vi.mocked(countChatMessages).mockReturnValue(0);
    vi.mocked(getLLMRegistry).mockReturnValue({ getDefault: vi.fn(() => ({})) } as never);

    const app = makeApp();
    const body = JSON.stringify({ content: "hello" });
    const headers = { "Content-Type": "application/json" };

    // The rate limiter allows maxMessagesPerMinute (30) requests per key.
    // Exhaust the bucket by sending 30 real requests through the same key.
    let lastResponse: Response | undefined;
    for (let i = 0; i <= 30; i++) {
      lastResponse = await app.request(`/api/evaluations/${evalId}/messages`, {
        method: "POST",
        headers,
        body,
      });
    }
    expect(lastResponse?.status).toBe(429);
    const json = await lastResponse?.json();
    expect(json.code).toBe("rate_limited");
  });

  it("POST /:id/messages → 400 when thread is full", async () => {
    vi.mocked(getEvaluation).mockReturnValue({ id: "eval-full" } as never);
    vi.mocked(countChatMessages).mockReturnValue(500); // maxMessagesPerThread = 500
    const app = makeApp();
    const res = await app.request("/api/evaluations/eval-full/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("thread_full");
  });

  it("POST /:id/messages → 503 when registry has no provider", async () => {
    vi.mocked(getEvaluation).mockReturnValue({ id: "eval-noprov" } as never);
    vi.mocked(countChatMessages).mockReturnValue(0);
    vi.mocked(getLLMRegistry).mockReturnValue({ getDefault: vi.fn(() => null) } as never);
    const app = makeApp();
    const res = await app.request("/api/evaluations/eval-noprov/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("no_provider");
  });
});
