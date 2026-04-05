import type {
  ApplicationProfile,
  EvaluateRequest,
  EvaluateResponse,
  Evaluation,
  ExpertAssessment,
  SSEEvent,
} from "@aegis/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type EvaluationApiPayload = Partial<Evaluation> & {
  inputType?: ApplicationProfile["inputType"];
  sourceUrl?: string | null;
  applicationName?: string | null;
  applicationDescription?: string | null;
  applicationProfile?: Partial<ApplicationProfile> | null;
  assessments?: ExpertAssessment[] | Evaluation["assessments"];
  verdict?: Evaluation["council"] | null;
};

function normalizeApplication(payload: EvaluationApiPayload): ApplicationProfile {
  const profile = payload.applicationProfile ?? {};

  return {
    id: profile.id ?? `${payload.id ?? "application"}-profile`,
    inputType: profile.inputType ?? payload.inputType ?? "github_url",
    sourceUrl: profile.sourceUrl ?? payload.sourceUrl ?? undefined,
    name: profile.name ?? payload.applicationName ?? payload.sourceUrl ?? "Untitled application",
    description: profile.description ?? payload.applicationDescription ?? "",
    framework: profile.framework ?? "Profile pending",
    language: profile.language ?? "Unknown",
    entryPoints: profile.entryPoints ?? [],
    dependencies: profile.dependencies ?? [],
    aiIntegrations: profile.aiIntegrations ?? [],
    fileStructure: profile.fileStructure ?? [],
    totalFiles: profile.totalFiles ?? 0,
    totalLines: profile.totalLines ?? 0,
    clonedAt: profile.clonedAt ?? undefined,
  };
}

function normalizeAssessments(payload: EvaluationApiPayload): Evaluation["assessments"] {
  if (Array.isArray(payload.assessments)) {
    return Object.fromEntries(
      payload.assessments.map((assessment) => [assessment.moduleId, assessment]),
    ) as Evaluation["assessments"];
  }

  return (payload.assessments ?? {}) as Evaluation["assessments"];
}

function normalizeEvaluation(payload: EvaluationApiPayload): Evaluation {
  return {
    id: payload.id ?? "unknown-evaluation",
    status: payload.status ?? "pending",
    application: payload.application ?? normalizeApplication(payload),
    assessments: normalizeAssessments(payload),
    council: payload.council ?? payload.verdict ?? undefined,
    report: payload.report,
    createdAt: payload.createdAt ?? new Date().toISOString(),
    updatedAt: payload.updatedAt ?? payload.createdAt ?? new Date().toISOString(),
    completedAt: payload.completedAt ?? undefined,
    error: payload.error ?? undefined,
  };
}

function parseEvent(event: MessageEvent<string>, onEvent: (event: SSEEvent) => void) {
  try {
    onEvent(JSON.parse(event.data) as SSEEvent);
  } catch {
    // Ignore malformed events.
  }
}

export async function submitEvaluation(data: EvaluateRequest): Promise<EvaluateResponse> {
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

  const payload = (await res.json()) as EvaluationApiPayload[];
  return payload.map(normalizeEvaluation);
}

export async function getEvaluation(id: string): Promise<Evaluation> {
  const res = await fetch(`${API_BASE}/api/evaluations/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch evaluation (${res.status})`);

  const payload = (await res.json()) as EvaluationApiPayload;
  return normalizeEvaluation(payload);
}

export function subscribeToEvents(id: string, onEvent: (event: SSEEvent) => void): () => void {
  const eventSource = new EventSource(`${API_BASE}/api/evaluations/${id}/events`);
  const eventTypes: SSEEvent["type"][] = ["status", "progress", "finding", "verdict", "error", "complete"];

  eventTypes.forEach((type) => {
    eventSource.addEventListener(type, (event) => parseEvent(event as MessageEvent<string>, onEvent));
  });

  eventSource.onmessage = (event) => parseEvent(event, onEvent);
  eventSource.onerror = () => {
    eventSource.close();
  };

  return () => eventSource.close();
}
