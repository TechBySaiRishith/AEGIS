import type { ChatMessage } from "@aegis/shared";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export async function fetchChatHistory(evaluationId: string): Promise<ChatMessage[]> {
  const r = await fetch(`${API}/api/evaluations/${evaluationId}/messages`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadChatFile(evaluationId: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API}/api/uploads/${evaluationId}`, { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json()).error || "upload failed");
  return (await r.json()) as { id: string; name: string; mime: string; size: number; url: string };
}

export async function deleteChatThread(evaluationId: string) {
  await fetch(`${API}/api/evaluations/${evaluationId}`, { method: "DELETE" });
}
