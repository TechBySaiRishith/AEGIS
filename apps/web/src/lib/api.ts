import type {
  EvaluateRequest,
  EvaluateResponse,
  Evaluation,
  SSEEvent,
} from "@aegis/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function submitEvaluation(
  data: EvaluateRequest
): Promise<EvaluateResponse> {
  const res = await fetch(`${API_BASE}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Evaluation failed (${res.status})`);
  }
  return res.json();
}

export async function getEvaluations(): Promise<Evaluation[]> {
  const res = await fetch(`${API_BASE}/api/evaluations`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch evaluations (${res.status})`);
  return res.json();
}

export async function getEvaluation(id: string): Promise<Evaluation> {
  const res = await fetch(`${API_BASE}/api/evaluations/${id}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch evaluation (${res.status})`);
  return res.json();
}

export function subscribeToEvents(
  id: string,
  onEvent: (event: SSEEvent) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/evaluations/${id}/events`);

  es.onmessage = (e) => {
    try {
      const event: SSEEvent = JSON.parse(e.data);
      onEvent(event);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    es.close();
  };

  return () => es.close();
}
