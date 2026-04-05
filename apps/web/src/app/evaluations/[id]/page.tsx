"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  EXPERT_MODULES,
  VERDICT_STYLES,
  SEVERITY_STYLES,
  STATUS_LABELS,
} from "@aegis/shared";
import type {
  Evaluation,
  ExpertAssessment,
  ExpertModuleId,
  Finding,
  SSEEvent,
  Severity,
  Verdict,
} from "@aegis/shared";
import { getEvaluation, subscribeToEvents } from "@/lib/api";

// ─── Accent colors per module ────────────────────────────────

const MODULE_ACCENTS: Record<ExpertModuleId, string> = {
  sentinel: "var(--sentinel)",
  watchdog: "var(--watchdog)",
  guardian: "var(--guardian)",
};

// ─── Small components ────────────────────────────────────────

function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative flex h-20 w-20 items-center justify-center">
      <svg className="-rotate-90" width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span className="absolute text-lg font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

// ─── Finding card ────────────────────────────────────────────

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--background)]/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-raised)]/50"
      >
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{finding.title}</div>
          {finding.framework && (
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{finding.framework}</div>
          )}
        </div>
        <span className="mt-0.5 text-xs text-[var(--text-muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="animate-slide-up border-t border-[var(--border-subtle)] px-4 py-3 text-sm">
          <p className="mb-2 text-[var(--text-muted)]">{finding.description}</p>
          {finding.evidence.length > 0 && (
            <div className="space-y-1">
              {finding.evidence.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[var(--text-muted)]">
                    {ev.filePath}{ev.lineNumber ? `:${ev.lineNumber}` : ""}
                  </span>
                  <span className="text-[var(--text-muted)]">{ev.description}</span>
                </div>
              ))}
            </div>
          )}
          {finding.remediation && (
            <div className="mt-3 rounded-lg bg-[var(--approve-bg)] p-3 text-xs text-[var(--approve)]">
              <strong>Remediation:</strong> {finding.remediation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Module card ─────────────────────────────────────────────

function ModuleCard({ moduleId, assessment }: { moduleId: ExpertModuleId; assessment: ExpertAssessment }) {
  const mod = EXPERT_MODULES[moduleId];
  const accent = MODULE_ACCENTS[moduleId];
  const [showFindings, setShowFindings] = useState(false);

  return (
    <div
      className="animate-slide-up rounded-xl border bg-[var(--surface)] p-6"
      style={{ borderColor: `color-mix(in srgb, ${accent} 40%, transparent)` }}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{mod.icon}</span>
            <h3 className="text-lg font-bold" style={{ color: accent }}>{mod.name}</h3>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{assessment.framework || mod.framework}</p>
        </div>
        <ScoreRing score={assessment.score} color={accent} />
      </div>

      {/* Risk level */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">Risk level:</span>
        <SeverityBadge severity={assessment.riskLevel} />
      </div>

      {/* Summary */}
      <p className="mb-4 text-sm leading-relaxed text-[var(--text-muted)]">{assessment.summary}</p>

      {/* Findings toggle */}
      {assessment.findings.length > 0 && (
        <div>
          <button
            onClick={() => setShowFindings(!showFindings)}
            className="mb-3 text-sm font-medium transition hover:brightness-125"
            style={{ color: accent }}
          >
            {showFindings ? "Hide" : "Show"} {assessment.findings.length} finding{assessment.findings.length !== 1 ? "s" : ""} {showFindings ? "▲" : "▼"}
          </button>
          {showFindings && (
            <div className="space-y-2">
              {assessment.findings.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Verdict banner ──────────────────────────────────────────

function VerdictBanner({ verdict, confidence }: { verdict: Verdict; confidence: number }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <div
      className="flex items-center justify-between rounded-xl border p-6"
      style={{ borderColor: style.color, background: style.bg }}
    >
      <div className="flex items-center gap-4">
        <span className="text-4xl" style={{ color: style.color }}>{style.icon}</span>
        <div>
          <div className="text-sm font-medium uppercase tracking-widest" style={{ color: style.color }}>
            Council verdict
          </div>
          <div className="text-3xl font-bold" style={{ color: style.color }}>
            {style.label}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm text-[var(--text-muted)]">Confidence</div>
        <div className="text-2xl font-bold" style={{ color: style.color }}>
          {Math.round(confidence * 100)}%
        </div>
      </div>
    </div>
  );
}

// ─── Live progress view ──────────────────────────────────────

function LiveProgress({
  evaluation,
  events,
}: {
  evaluation: Evaluation;
  events: SSEEvent[];
}) {
  const statusLabel = STATUS_LABELS[evaluation.status] || evaluation.status;
  const pipelineSteps = [
    "pending",
    "cloning",
    "analyzing",
    "sentinel_running",
    "watchdog_running",
    "guardian_running",
    "synthesizing",
    "completed",
  ];
  const currentIdx = pipelineSteps.indexOf(evaluation.status);
  const progress = Math.max(0, Math.round(((currentIdx + 1) / pipelineSteps.length) * 100));

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-6">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-[var(--accent)]" />
          <span className="text-lg font-semibold text-[var(--accent)]">{statusLabel}</span>
        </div>
        {/* Progress bar */}
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{progress}% complete</p>
      </div>

      {/* Pipeline steps */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {pipelineSteps.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div
              key={step}
              className={`rounded-lg border px-2 py-2 text-center text-[10px] font-medium ${
                done
                  ? "border-[var(--approve)]/30 bg-[var(--approve-bg)] text-[var(--approve)]"
                  : active
                    ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)] animate-pulse-glow"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)]/50"
              }`}
            >
              {STATUS_LABELS[step]?.split(" ")[0] || step.replace("_", " ")}
            </div>
          );
        })}
      </div>

      {/* Event log */}
      {events.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-medium">
            Event log
          </div>
          <div className="max-h-64 overflow-y-auto p-4">
            <div className="space-y-2">
              {events.map((ev, i) => (
                <div key={i} className="flex gap-3 text-xs animate-slide-up">
                  <span className="shrink-0 font-mono text-[var(--text-muted)]">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-medium uppercase ${
                      ev.type === "error"
                        ? "bg-[var(--reject-bg)] text-[var(--reject)]"
                        : ev.type === "verdict"
                          ? "bg-[var(--approve-bg)] text-[var(--approve)]"
                          : "bg-[var(--accent)]/10 text-[var(--accent)]"
                    }`}
                  >
                    {ev.type}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {typeof ev.data === "object" && ev.data !== null
                      ? (ev.data as Record<string, unknown>).message as string ||
                        (ev.data as Record<string, unknown>).status as string ||
                        JSON.stringify(ev.data)
                      : String(ev.data)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Completed results view ──────────────────────────────────

function CompletedResults({ evaluation }: { evaluation: Evaluation }) {
  const council = evaluation.council;
  const report = evaluation.report;
  const moduleIds: ExpertModuleId[] = ["sentinel", "watchdog", "guardian"];

  return (
    <div className="space-y-8">
      {/* Verdict */}
      {council && (
        <VerdictBanner verdict={council.verdict} confidence={council.confidence} />
      )}

      {/* Executive summary */}
      {report?.executiveSummary && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6">
          <h2 className="mb-3 text-lg font-semibold">Executive summary</h2>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">{report.executiveSummary}</p>
        </div>
      )}

      {/* Module cards */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Expert assessments</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          {moduleIds.map((id) => {
            const assessment = evaluation.assessments[id];
            if (!assessment) return null;
            return <ModuleCard key={id} moduleId={id} assessment={assessment} />;
          })}
        </div>
      </div>

      {/* Council analysis */}
      {council && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Council analysis</h2>

          {/* Reasoning */}
          <p className="mb-6 text-sm leading-relaxed text-[var(--text-muted)]">{council.reasoning}</p>

          {/* Critiques */}
          {council.critiques.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold">Cross-module critiques</h3>
              <div className="space-y-2">
                {council.critiques.map((c, i) => {
                  const isConflict = c.type === "conflict";
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border px-4 py-3 text-sm ${
                        isConflict
                          ? "border-[var(--review)]/30 bg-[var(--review-bg)]"
                          : c.type === "agreement"
                            ? "border-[var(--approve)]/20 bg-[var(--approve-bg)]"
                            : "border-[var(--border-subtle)] bg-[var(--background)]/50"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span className="font-semibold" style={{ color: MODULE_ACCENTS[c.fromModule] }}>
                          {EXPERT_MODULES[c.fromModule].name}
                        </span>
                        <span className="text-[var(--text-muted)]">→</span>
                        <span className="font-semibold" style={{ color: MODULE_ACCENTS[c.aboutModule] }}>
                          {EXPERT_MODULES[c.aboutModule].name}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            isConflict
                              ? "bg-[var(--review)]/20 text-[var(--review)]"
                              : c.type === "agreement"
                                ? "bg-[var(--approve)]/20 text-[var(--approve)]"
                                : "bg-[var(--info)]/20 text-[var(--info)]"
                          }`}
                        >
                          {c.type}
                        </span>
                      </div>
                      <p className="text-[var(--text-muted)]">{c.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────

export default function EvaluationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEval = useCallback(async () => {
    try {
      const ev = await getEvaluation(id);
      setEvaluation(ev);
      setError(null);
      return ev;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial fetch + SSE
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    fetchEval().then((ev) => {
      if (!ev || ev.status === "completed" || ev.status === "failed") return;

      cleanup = subscribeToEvents(id, (event) => {
        setEvents((prev) => [...prev, event]);

        if (event.type === "status" && event.data) {
          setEvaluation((prev) =>
            prev ? { ...prev, status: (event.data as Record<string, unknown>).status as Evaluation["status"] } : prev
          );
        }

        // Refetch on completion or verdict
        if (event.type === "complete" || event.type === "verdict") {
          fetchEval();
        }
      });
    });

    return () => cleanup?.();
  }, [id, fetchEval]);

  // Polling fallback for in-progress evaluations
  useEffect(() => {
    if (!evaluation || evaluation.status === "completed" || evaluation.status === "failed") return;
    const interval = setInterval(() => fetchEval(), 5000);
    return () => clearInterval(interval);
  }, [evaluation?.status, fetchEval]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="mx-auto max-w-lg pt-20 text-center">
        <div className="rounded-xl border border-[var(--reject)]/30 bg-[var(--reject-bg)] p-6">
          <p className="text-sm text-[var(--reject)]">{error || "Evaluation not found"}</p>
        </div>
        <button
          onClick={() => router.push("/evaluations")}
          className="mt-4 text-sm text-[var(--accent)] transition hover:brightness-125"
        >
          ← Back to evaluations
        </button>
      </div>
    );
  }

  const isComplete = evaluation.status === "completed";
  const isFailed = evaluation.status === "failed";
  const isInProgress = !isComplete && !isFailed;

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="mb-8">
        <button
          onClick={() => router.push("/evaluations")}
          className="mb-4 text-sm text-[var(--text-muted)] transition hover:text-[var(--accent)]"
        >
          ← All evaluations
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {evaluation.application?.name || "Evaluation"}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {evaluation.application?.description || evaluation.id}
            </p>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <div>ID: {evaluation.id.slice(0, 8)}...</div>
            <div>{new Date(evaluation.createdAt).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Failed state */}
      {isFailed && (
        <div className="rounded-xl border border-[var(--reject)]/30 bg-[var(--reject-bg)] p-6">
          <div className="flex items-center gap-2 text-lg font-semibold text-[var(--reject)]">
            <span>✗</span> Evaluation failed
          </div>
          {evaluation.error && (
            <p className="mt-2 text-sm text-[var(--reject)]/80">{evaluation.error}</p>
          )}
        </div>
      )}

      {/* In progress */}
      {isInProgress && <LiveProgress evaluation={evaluation} events={events} />}

      {/* Completed */}
      {isComplete && <CompletedResults evaluation={evaluation} />}
    </div>
  );
}
