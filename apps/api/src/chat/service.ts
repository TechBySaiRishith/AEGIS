import { nanoid } from "nanoid";
import { readFile } from "node:fs/promises";
import type { ChatSSEEvent } from "@aegis/shared";
import type { LLMProvider, ChatTurn, ChatContentPart } from "../llm/provider.js";
import { getEvaluation } from "../db/queries.js";
import { insertChatMessage, updateChatMessage, listChatMessages, getChatUploads } from "./storage.js";
import { buildSystemPrompt, budgetTrimHistory, type EvalContext } from "./prompt.js";

export interface StreamChatArgs {
  evaluationId: string;
  userContent: string;
  attachmentIds: string[];
  provider: LLMProvider;
  emit: (event: ChatSSEEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function streamChatTurn(args: StreamChatArgs): Promise<void> {
  const { evaluationId, userContent, attachmentIds, provider, emit, signal } = args;

  const evaluation = getEvaluation(evaluationId);
  if (!evaluation) throw new Error("Evaluation not found");

  // 1. Persist user message
  const uploads = getChatUploads(attachmentIds);
  const userMsgId = nanoid();
  const now = Date.now();
  insertChatMessage({
    id: userMsgId, evaluationId, role: "user", content: userContent,
    attachments: uploads.map(u => ({ id: u.id, name: u.originalName, mime: u.mime, size: u.sizeBytes, url: `/api/uploads/${u.id}` })),
    status: "complete", createdAt: now,
  });

  // 2. Build context
  const ctx: EvalContext = {
    id: evaluation.id,
    verdict: evaluation.verdict?.verdict ?? "UNKNOWN",
    perModuleScores: Object.fromEntries(evaluation.assessments.map(a => [a.moduleId, a.score])),
    findings: evaluation.assessments.flatMap(a => (a.findings ?? []).map((f, i) => ({
      id: `${a.moduleId.toUpperCase().charAt(0)}-${i + 1}`,
      severity: (f as { severity?: string }).severity ?? "medium",
      summary: (f as { summary?: string; title?: string }).summary ?? (f as { title?: string }).title ?? "(no summary)",
      file: (f as { file?: string }).file,
    }))),
  };
  const systemPrompt = buildSystemPrompt(ctx);

  // 3. History → ChatTurn[]
  const prior = listChatMessages(evaluationId).filter(m => m.id !== userMsgId);
  const history: ChatTurn[] = prior.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // 4. Current turn — with attachments as multimodal parts
  const parts: ChatContentPart[] = [{ type: "text", text: userContent }];
  for (const u of uploads) {
    const buf = await readFile(u.storagePath);
    if (u.mime.startsWith("image/")) {
      parts.push({ type: "image", mime: u.mime, dataBase64: buf.toString("base64") });
    } else {
      parts.push({ type: "file", mime: u.mime, dataBase64: buf.toString("base64"), name: u.originalName });
    }
  }

  const messages: ChatTurn[] = [
    { role: "system", content: systemPrompt },
    ...budgetTrimHistory(history, 20_000),
    { role: "user", content: parts },
  ];

  // 5. Persist pending assistant shell
  const assistantId = nanoid();
  insertChatMessage({
    id: assistantId, evaluationId, role: "assistant", content: "",
    attachments: [], status: "streaming", createdAt: Date.now(),
  });
  await emit({ type: "message.start", messageId: assistantId, createdAt: Date.now() });

  // 6. Stream
  if (!provider.chatStream) {
    await emit({ type: "message.error", messageId: assistantId, code: "provider_unsupported", message: "Provider does not support chat streaming" });
    updateChatMessage(assistantId, { status: "error", errorMessage: "provider_unsupported" });
    return;
  }

  let full = "";
  let usage: { prompt: number; completion: number } | undefined;
  try {
    for await (const chunk of provider.chatStream(messages, { signal })) {
      if (chunk.delta) {
        full += chunk.delta;
        await emit({ type: "message.delta", messageId: assistantId, delta: chunk.delta });
      }
      if (chunk.done) usage = chunk.tokenUsage;
    }
    updateChatMessage(assistantId, { content: full, status: "complete", tokenUsage: usage });
    // Extract citations [F-1] and emit
    for (const match of full.matchAll(/\[([A-Z]-\d+)\]/g)) {
      await emit({ type: "message.citation", messageId: assistantId, findingId: match[1] });
    }
    await emit({ type: "message.done", messageId: assistantId, tokenUsage: usage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateChatMessage(assistantId, { status: "error", errorMessage: msg });
    await emit({ type: "message.error", messageId: assistantId, code: "llm_error", message: msg });
  }
}
