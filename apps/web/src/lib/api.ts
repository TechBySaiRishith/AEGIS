import type {
  ApplicationProfile,
  CouncilVerdict,
  EvaluateRequest,
  EvaluateResponse,
  Evaluation,
  ExpertAssessment,
  SSEEvent,
  Verdict,
} from "@aegis/shared";
import { EXPERT_MODULES } from "@aegis/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

type EvaluationApiPayload = Partial<Evaluation> & {
  inputType?: ApplicationProfile["inputType"];
  sourceUrl?: string | null;
  applicationName?: string | null;
  applicationDescription?: string | null;
  applicationProfile?: Partial<ApplicationProfile> | null;
  assessments?: ExpertAssessment[] | Evaluation["assessments"];
  // The API may return the verdict row as a top-level `verdict` field
  // instead of the `council` field expected by the Evaluation type.
  verdict?: Partial<CouncilVerdict> & { verdict?: Verdict } | null;
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
  const raw = Array.isArray(payload.assessments)
    ? payload.assessments
    : payload.assessments
      ? Object.values(payload.assessments)
      : [];

  return Object.fromEntries(
    raw
      .filter((a): a is ExpertAssessment => Boolean(a?.moduleId))
      .map((a) => [
        a.moduleId,
        {
          ...a,
          moduleName: a.moduleName || EXPERT_MODULES[a.moduleId]?.name || a.moduleId,
          framework: a.framework || EXPERT_MODULES[a.moduleId]?.framework || "Unknown",
          status: a.status || "failed",
          score: a.score ?? 0,
          riskLevel: a.riskLevel || "info",
          findings: a.findings ?? [],
          summary: a.summary || (a.status === "failed" ? "Module failed before producing findings." : ""),
          recommendation: a.recommendation || "",
          completedAt: a.completedAt || new Date().toISOString(),
          model: a.model || "unknown",
          error: a.error || undefined,
        } satisfies ExpertAssessment,
      ]),
  ) as Evaluation["assessments"];
}

function normalizeCouncil(payload: EvaluationApiPayload): CouncilVerdict | undefined {
  const source = payload.council ?? payload.verdict;
  if (!source || !source.verdict) return undefined;

  return {
    verdict: source.verdict,
    confidence: source.confidence ?? 0,
    reasoning: source.reasoning ?? "",
    critiques: source.critiques ?? [],
    perModuleSummary: source.perModuleSummary ?? ({} as CouncilVerdict["perModuleSummary"]),
    algorithmicVerdict: source.algorithmicVerdict ?? source.verdict,
    llmEnhanced: source.llmEnhanced ?? false,
    deliberation: source.deliberation,
  };
}

function normalizeEvaluation(payload: EvaluationApiPayload): Evaluation {
  return {
    id: payload.id ?? "unknown-evaluation",
    status: payload.status ?? "pending",
    application: payload.application ?? normalizeApplication(payload),
    assessments: normalizeAssessments(payload),
    council: normalizeCouncil(payload),
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

export function getEvaluationReportHtmlUrl(id: string, options?: { autoPrint?: boolean }): string {
  const url = new URL(`${API_BASE}/api/evaluations/${id}/report/html`);
  if (options?.autoPrint) {
    url.searchParams.set("print", "1");
  }
  return url.toString();
}

export function subscribeToEvents(id: string, onEvent: (event: SSEEvent) => void): () => void {
  let closed = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let es: EventSource | null = null;
  const maxRetries = 8;
  const eventTypes: SSEEvent["type"][] = ["status", "progress", "finding", "verdict", "error", "complete"];

  function connect() {
    if (closed) return;
    es = new EventSource(`${API_BASE}/api/evaluations/${id}/events`);

    eventTypes.forEach((type) => {
      es!.addEventListener(type, (event) => {
        retryCount = 0;
        parseEvent(event as MessageEvent<string>, onEvent);
      });
    });

    es.onmessage = (event) => {
      retryCount = 0;
      parseEvent(event, onEvent);
    };

    es.onopen = () => {
      retryCount = 0;
    };

    es.onerror = () => {
      if (closed) return;
      es?.close();
      es = null;
      retryCount++;
      if (retryCount <= maxRetries) {
        const delay = Math.min(1000 * 2 ** (retryCount - 1), 10_000);
        retryTimer = setTimeout(connect, delay);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    es?.close();
    es = null;
  };
}
