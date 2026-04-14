import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { getEvaluation } from "../db/queries.js";
import { getLLMRegistry } from "../llm/registry.js";
import { listChatMessages, countChatMessages, deleteChatThread } from "./storage.js";
import { streamChatTurn } from "./service.js";
import { publish, replay, subscribe } from "./eventBus.js";
import { RateLimiter } from "./rateLimit.js";
import { CHAT_LIMITS } from "@aegis/shared";

const limiter = new RateLimiter({ max: CHAT_LIMITS.maxMessagesPerMinute, windowMs: 60_000 });
const chat = new Hono();

// Chat requires a provider that implements streaming. Prefer explicit CHAT_PROVIDER,
// then the registry default, then the first provider that has chatStream.
function pickChatProvider() {
  const registry = getLLMRegistry();
  const preferred = process.env.CHAT_PROVIDER;
  if (preferred) {
    const p = registry.get(preferred as Parameters<typeof registry.get>[0]);
    if (p?.chatStream) return p;
  }
  const def = registry.getDefault();
  if (def?.chatStream) return def;
  for (const { id } of registry.listProviders()) {
    const p = registry.get(id);
    if (p?.chatStream) return p;
  }
  return undefined;
}

chat.get("/:id/messages", (c) => {
  const id = c.req.param("id");
  if (!getEvaluation(id)) return c.json({ error: "Evaluation not found" }, 404);
  return c.json(listChatMessages(id));
});

chat.delete("/:id", (c) => {
  const id = c.req.param("id");
  deleteChatThread(id);
  return c.json({ ok: true });
});

const postSchema = z.object({ content: z.string().min(1), attachmentIds: z.array(z.string()).default([]) });

chat.post("/:id/messages", async (c) => {
  const id = c.req.param("id");
  if (!getEvaluation(id)) return c.json({ error: "Evaluation not found" }, 404);
  if (!limiter.tryAcquire(id)) return c.json({ error: "Rate limit exceeded", code: "rate_limited" }, 429);
  if (countChatMessages(id) >= CHAT_LIMITS.maxMessagesPerThread) return c.json({ error: "Thread full", code: "thread_full" }, 400);

  const raw = await c.req.json().catch(() => null);
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid body", code: "invalid_body", issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const provider = pickChatProvider();
  if (!provider) return c.json({ error: "No chat-capable LLM provider configured", code: "no_provider" }, 503);

  let dead = false;
  return streamSSE(c, async (stream) => {
    await streamChatTurn({
      evaluationId: id,
      userContent: body.content,
      attachmentIds: body.attachmentIds,
      provider,
      emit: async (event) => {
        publish(event.messageId, event);
        if (dead) return;
        try {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        } catch {
          dead = true;
        }
      },
    });
  });
});

chat.get("/:id/stream/:messageId", (c) => {
  const messageId = c.req.param("messageId");
  return streamSSE(c, async (stream) => {
    for (const event of replay(messageId)) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    }
    let done = false;
    const unsub = subscribe(messageId, async (event) => {
      if (done) return;
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      if (event.type === "message.done" || event.type === "message.error") done = true;
    });
    try { while (!done) await stream.sleep(1000); } finally { unsub(); }
  });
});

export { chat };
