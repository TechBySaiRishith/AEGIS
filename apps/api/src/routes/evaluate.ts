import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  EvaluateRequest,
  EvaluateResponse,
  Evaluation,
  EvaluationStatus,
} from "@aegis/shared";
import { nanoid } from "nanoid";

const evaluate = new Hono();

// In-memory store until the DB layer is wired up
const evaluations = new Map<string, Evaluation>();

// ─── POST /api/evaluate — start a new evaluation ───────────

evaluate.post("/", async (c) => {
  const body = await c.req.json<EvaluateRequest>();

  const id = nanoid(12);
  const now = new Date().toISOString();

  const evaluation: Evaluation = {
    id,
    status: "pending",
    application: {
      id: nanoid(12),
      inputType: body.inputType,
      sourceUrl: body.source,
      name: body.source,
      description: body.description ?? "",
      framework: "unknown",
      language: "unknown",
      entryPoints: [],
      dependencies: [],
      aiIntegrations: [],
      fileStructure: [],
      totalFiles: 0,
      totalLines: 0,
    },
    assessments: {},
    createdAt: now,
    updatedAt: now,
  };

  evaluations.set(id, evaluation);

  const response: EvaluateResponse = {
    evaluationId: id,
    status: "pending",
  };

  return c.json(response, 201);
});

// ─── GET /api/evaluations — list all evaluations ───────────

evaluate.get("/", (c) => {
  const list = Array.from(evaluations.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return c.json(list);
});

// ─── GET /api/evaluations/:id — single evaluation ──────────

evaluate.get("/:id", (c) => {
  const entry = evaluations.get(c.req.param("id"));
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);
  return c.json(entry);
});

// ─── GET /api/evaluations/:id/events — SSE stream (stub) ──

evaluate.get("/:id/events", (c) => {
  const id = c.req.param("id");
  const entry = evaluations.get(id);
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "status",
      data: JSON.stringify({
        type: "status",
        evaluationId: id,
        timestamp: new Date().toISOString(),
        data: { status: entry.status, message: "SSE stream connected (stub)" },
      }),
    });

    // The real implementation will push progress events as modules run.
    // For now, send a complete event after a short delay.
    await stream.sleep(500);

    await stream.writeSSE({
      event: "complete",
      data: JSON.stringify({
        type: "complete",
        evaluationId: id,
        timestamp: new Date().toISOString(),
        data: { message: "Stub — real evaluation pipeline not yet wired" },
      }),
    });
  });
});

export { evaluate };
