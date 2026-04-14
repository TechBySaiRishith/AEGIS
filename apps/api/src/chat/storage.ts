import type { ChatAttachment, ChatMessage, ChatMessageStatus, ChatRole } from "@aegis/shared";
import { sqlite } from "../db/connection.js";

export interface ChatMessageRow {
  id: string;
  evaluationId: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachment[];
  tokenUsage?: { prompt: number; completion: number };
  status: ChatMessageStatus;
  errorMessage?: string;
  createdAt: number;
}

export function insertChatMessage(m: ChatMessageRow): void {
  sqlite.prepare(
    `INSERT INTO chat_messages (id, evaluation_id, role, content, attachments, token_usage, status, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.id, m.evaluationId, m.role, m.content,
    JSON.stringify(m.attachments ?? []),
    m.tokenUsage ? JSON.stringify(m.tokenUsage) : null,
    m.status, m.errorMessage ?? null, m.createdAt,
  );
}

export function updateChatMessage(id: string, patch: Partial<Pick<ChatMessageRow, "content" | "status" | "tokenUsage" | "errorMessage">>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  if (patch.content !== undefined) { sets.push("content = ?"); vals.push(patch.content); }
  if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
  if (patch.tokenUsage !== undefined) { sets.push("token_usage = ?"); vals.push(JSON.stringify(patch.tokenUsage)); }
  if (patch.errorMessage !== undefined) { sets.push("error_message = ?"); vals.push(patch.errorMessage); }
  if (!sets.length) return;
  vals.push(id);
  sqlite.prepare(`UPDATE chat_messages SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function listChatMessages(evaluationId: string): ChatMessage[] {
  const rows = sqlite.prepare(
    `SELECT * FROM chat_messages WHERE evaluation_id = ? ORDER BY created_at ASC`
  ).all(evaluationId) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string,
    evaluationId: r.evaluation_id as string,
    role: r.role as ChatRole,
    content: r.content as string,
    attachments: JSON.parse((r.attachments as string) || "[]"),
    status: r.status as ChatMessageStatus,
    createdAt: r.created_at as number,
    tokenUsage: r.token_usage ? JSON.parse(r.token_usage as string) : undefined,
    errorMessage: (r.error_message as string) ?? undefined,
  }));
}

export function countChatMessages(evaluationId: string): number {
  const r = sqlite.prepare(`SELECT COUNT(*) AS c FROM chat_messages WHERE evaluation_id = ?`).get(evaluationId) as { c: number };
  return r.c;
}

export function deleteChatThread(evaluationId: string): void {
  sqlite.prepare(`DELETE FROM chat_messages WHERE evaluation_id = ?`).run(evaluationId);
}

export interface ChatUploadRow {
  id: string; evaluationId: string; originalName: string; mime: string; sizeBytes: number; storagePath: string; createdAt: number;
}

export function insertChatUpload(u: ChatUploadRow): void {
  sqlite.prepare(
    `INSERT INTO chat_uploads (id, evaluation_id, original_name, mime, size_bytes, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(u.id, u.evaluationId, u.originalName, u.mime, u.sizeBytes, u.storagePath, u.createdAt);
}

export function getChatUpload(id: string): ChatUploadRow | undefined {
  const r = sqlite.prepare(`SELECT * FROM chat_uploads WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return {
    id: r.id as string, evaluationId: r.evaluation_id as string, originalName: r.original_name as string,
    mime: r.mime as string, sizeBytes: r.size_bytes as number, storagePath: r.storage_path as string,
    createdAt: r.created_at as number,
  };
}

export function getChatUploads(ids: string[]): ChatUploadRow[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite.prepare(`SELECT * FROM chat_uploads WHERE id IN (${placeholders})`).all(...ids) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string, evaluationId: r.evaluation_id as string, originalName: r.original_name as string,
    mime: r.mime as string, sizeBytes: r.size_bytes as number, storagePath: r.storage_path as string,
    createdAt: r.created_at as number,
  }));
}
