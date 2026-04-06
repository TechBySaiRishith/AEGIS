"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  EXPERT_MODULES,
  SEVERITY_STYLES,
  STATUS_LABELS,
  VERDICT_STYLES,
} from "@aegis/shared";
import type {
  Evaluation,
  EvaluationStatus,
  ExpertAssessment,
  ExpertModuleId,
  Finding,
  SSEEvent,
  Severity,
  Verdict,
} from "@aegis/shared";
import { getEvaluation, subscribeToEvents } from "@/lib/api";

const MODULE_ACCENTS: Record<ExpertModuleId, string> = {
  sentinel: "var(--sentinel)",
  watchdog: "var(--watchdog)",
  guardian: "var(--guardian)",
};

const PIPELINE_STEPS: Array<{
  key: EvaluationStatus;
  label: string;
  detail: string;
  moduleId?: ExpertModuleId;
}> = [
  {
    key: "pending",
    label: "Queued",
    detail: "Request accepted and awaiting council intake.",
  },
  {
    key: "cloning",
    label: "Repository intake",
    detail: "Application source is being cloned and profiled.",
  },
  {
    key: "analyzing",
    label: "Profiling",
    detail: "AEGIS is mapping components, dependencies, and AI touchpoints.",
  },
  {
    key: "sentinel_running",
    label: "Sentinel",
    detail: "Security posture and unsafe implementation paths are under review.",
    moduleId: "sentinel",
  },
  {
    key: "watchdog_running",
    label: "Watchdog",
    detail: "Prompt abuse, jailbreak, and data exfiltration vectors are being tested.",
    moduleId: "watchdog",
  },
  {
    key: "guardian_running",
    label: "Guardian",
    detail: "Governance, transparency, and compliance controls are being assessed.",
    moduleId: "guardian",
  },
  {
    key: "synthesizing",
    label: "Council verdict",
    detail: "Expert findings are being synthesized into a unified decision.",
  },
  {
    key: "completed",
    label: "Complete",
    detail: "The evaluation dossier is ready for review.",
  },
];

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isLikelyUrl(value?: string | null) {
  if (!value) return false;
  return /^(https?:\/\/|www\.)/i.test(value);
}

function extractAppName(source?: string | null) {
  if (!source) return "";

  const normalized = source.startsWith("http://") || source.startsWith("https://") ? source : `https://${source}`;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const candidate = segments.at(-1) ?? url.hostname;
    return decodeURIComponent(candidate).replace(/\.git$/i, "");
  } catch {
    const segments = source.split("/").filter(Boolean);
    return segments.at(-1)?.replace(/\.git$/i, "") ?? source;
  }
}

function resolveApplicationTitle(name?: string | null, sourceUrl?: string | null) {
  if (name && !isLikelyUrl(name)) return name;
  const extracted = extractAppName(sourceUrl ?? name);
  return extracted || "Evaluation";
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;

  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em]"
      style={{
        color: style.color,
        background: style.bg,
        borderColor: `color-mix(in srgb, ${style.color} 22%, transparent)`,
      }}
    >
      {style.label}
    </span>
  );
}

function ScoreRing({ score, color, label }: { score: number; color: string; label: string }) {
  const gradientId = useId().replace(/:/g, "");
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.max(0, Math.min(score, 100)) / 100) * circumference;

  return (
    <div
      className="relative flex h-28 w-28 items-center justify-center"
      aria-label={`${label}: ${score} out of 100`}
      role="img"
    >
      <svg className="-rotate-90 overflow-visible" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id={`${gradientId}-gradient`} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.18" />
            <stop offset="30%" stopColor={color} stopOpacity="0.92" />
            <stop offset="100%" stopColor={color} stopOpacity="0.45" />
          </linearGradient>
          <filter id={`${gradientId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={`url(#${gradientId}-gradient)`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          filter={`url(#${gradientId}-glow)`}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-5 rounded-full border border-white/8 bg-black/30" />
      <div className="absolute text-center">
        <div className="text-[0.62rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">{label}</div>
        <div className="mt-1 text-3xl font-semibold" style={{ color, fontFamily: "var(--font-mono)" }}>
          {score}
        </div>
      </div>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-[1.35rem] border border-white/8 bg-black/18 transition duration-200 hover:border-white/12">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start gap-4 px-4 py-4 text-left sm:px-5"
      >
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text)]">{finding.title}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {finding.category}
            {finding.framework ? ` · ${finding.framework}` : ""}
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {open ? "Hide" : "Open"}
        </span>
      </button>

      <div className={`grid overflow-hidden transition-all duration-300 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0">
          <div className="border-t border-white/8 px-4 py-4 sm:px-5">
            <p className="text-sm leading-7 text-[var(--text-muted)]">{finding.description}</p>

            {finding.evidence.length > 0 ? (
              <div className="mt-4 space-y-3">
                {finding.evidence.map((evidence, index) => (
                  <div key={`${finding.id}-evidence-${index}`} className="code-surface rounded-[1.15rem] p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--accent)]">
                      <span className="rounded-full border border-[var(--accent)]/15 px-2 py-1" style={{ fontFamily: "var(--font-mono)" }}>
                        {evidence.filePath}
                        {evidence.lineNumber ? `:${evidence.lineNumber}` : ""}
                      </span>
                      <span className="text-[var(--text-muted)]">Evidence</span>
                    </div>
                    {evidence.snippet ? (
                      <pre
                        className="mt-3 overflow-x-auto text-xs leading-6 text-[#d4f7ff]"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        <code>{evidence.snippet}</code>
                      </pre>
                    ) : null}
                    <p className="mt-3 text-xs leading-6 text-[var(--text-muted)]">{evidence.description}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {finding.remediation ? (
              <div className="mt-4 rounded-[1.15rem] border border-[var(--approve)]/15 bg-[var(--approve-bg)] px-4 py-3 text-sm leading-7 text-[var(--approve)]">
                <span className="mr-2 font-semibold uppercase tracking-[0.14em]">Remediation</span>
                {finding.remediation}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleCard({ moduleId, assessment }: { moduleId: ExpertModuleId; assessment: ExpertAssessment }) {
  const accent = MODULE_ACCENTS[moduleId];
  const module = EXPERT_MODULES[moduleId];
  const [showFindings, setShowFindings] = useState(false);

  return (
    <div
      className="panel panel-interactive rounded-[1.75rem] p-6"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(24,24,27,0.96)) 0%, rgba(24,24,27,0.96) 52%), linear-gradient(135deg, rgba(255,255,255,0.04), transparent)`,
      }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="grid h-[3.25rem] w-[3.25rem] place-items-center rounded-[1.25rem] border border-white/10 bg-black/18 text-2xl">
              {module.icon}
            </div>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Expert module</div>
              <h3 className="mt-1 text-2xl font-semibold" style={{ color: accent }}>
                {module.name}
              </h3>
            </div>
          </div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {assessment.framework || module.framework}
          </p>
        </div>

        <ScoreRing score={assessment.score} color={accent} label="Score" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SeverityBadge severity={assessment.riskLevel} />
        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {assessment.status}
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {assessment.findings.length} finding{assessment.findings.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-6 text-sm leading-7 text-[var(--text-muted)]">{assessment.summary}</p>

      {assessment.recommendation ? (
        <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-black/18 px-4 py-4">
          <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">Recommended action</div>
          <p className="mt-2 text-sm leading-7 text-[var(--text)]">{assessment.recommendation}</p>
        </div>
      ) : null}

      {assessment.findings.length > 0 ? (
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={() => setShowFindings((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] transition duration-200 hover:border-white/16 hover:text-[var(--text)]"
          >
            {showFindings ? "Collapse findings" : "Expand findings"}
          </button>

          <div className={`grid overflow-hidden transition-all duration-300 ${showFindings ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="min-h-0 space-y-3">
              {assessment.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VerdictBanner({ verdict, confidence }: { verdict: Verdict; confidence: number }) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.REVIEW;
  const confidencePercent = Math.round(confidence * 100);

  return (
    <div
      className="panel animate-scale-in rounded-[2rem] p-7 sm:p-8"
      style={{
        borderColor: `color-mix(in srgb, ${style.color} 32%, rgba(255,255,255,0.08))`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${style.color} 16%, rgba(24,24,27,0.98)), rgba(24,24,27,0.98) 60%), radial-gradient(circle at top right, color-mix(in srgb, ${style.color} 18%, transparent), transparent 36%)`,
      }}
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <div className="text-[0.72rem] uppercase tracking-[0.24em]" style={{ color: style.color }}>
            Council verdict
          </div>
          <div className="mt-4 flex items-center gap-4">
            <div
              className="grid h-16 w-16 place-items-center rounded-[1.5rem] border border-white/10 bg-black/20 text-4xl"
              style={{ color: style.color }}
            >
              {style.icon}
            </div>
            <div>
              <h2 className="text-4xl font-semibold tracking-[-0.04em]" style={{ color: style.color }}>
                {style.label}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--text-muted)]">
                The council synthesis is complete and ready for final stakeholder review.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Confidence</div>
              <div className="mt-2 text-4xl font-semibold" style={{ color: style.color, fontFamily: "var(--font-mono)" }}>
                {confidencePercent}%
              </div>
            </div>
            <div className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Audit ready
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${confidencePercent}%`,
                background: `linear-gradient(90deg, color-mix(in srgb, ${style.color} 92%, white 8%), color-mix(in srgb, ${style.color} 68%, white 32%))`,
                boxShadow: `0 0 24px color-mix(in srgb, ${style.color} 28%, transparent)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveProgress({ evaluation, events }: { evaluation: Evaluation; events: SSEEvent[] }) {
  const currentStepIndex = Math.max(
    PIPELINE_STEPS.findIndex((step) => step.key === evaluation.status),
    0,
  );
  const progress = Math.round(((currentStepIndex + 1) / PIPELINE_STEPS.length) * 100);
  const recentEvents = events.slice(-8).reverse();

  return (
    <div className="space-y-8 animate-fade-in">
      <section className="panel rounded-[2rem] p-7 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="section-kicker">Evaluation in progress</div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              {STATUS_LABELS[evaluation.status] ?? evaluation.status}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--text-muted)]">
              AEGIS is continuously updating the evaluation stream as expert modules complete their
              analysis and the council prepares a verdict.
            </p>

            <div className="mt-8 h-3 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(34,211,238,0.95),rgba(167,139,250,0.75))] transition-all duration-700"
                style={{ width: `${progress}%`, boxShadow: "0 0 28px rgba(34, 211, 238, 0.26)" }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
              <span>Pipeline progress</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{progress}%</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.4rem] border border-white/8 bg-black/18 px-4 py-5">
              <div className="metric-label">Events streamed</div>
              <div className="metric-value mt-4">{events.length.toString().padStart(2, "0")}</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/8 bg-black/18 px-4 py-5">
              <div className="metric-label">Current stage</div>
              <div className="mt-4 text-lg font-semibold text-[var(--text)]">{currentStepIndex + 1} / {PIPELINE_STEPS.length}</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/8 bg-black/18 px-4 py-5">
              <div className="metric-label">Run status</div>
              <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
                <span className="h-2.5 w-2.5 animate-pulse-glow rounded-full bg-[var(--accent)]" />
                Live
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel rounded-[1.8rem] p-6 sm:p-7">
          <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Timeline</div>
          <div className="mt-6 space-y-4">
            {PIPELINE_STEPS.map((step, index) => {
              const completed = index < currentStepIndex;
              const active = index === currentStepIndex;
              const accent = step.moduleId ? MODULE_ACCENTS[step.moduleId] : "var(--accent)";

              return (
                <div
                  key={step.key}
                  className={`rounded-[1.3rem] border px-4 py-4 transition duration-200 ${
                    completed
                      ? "border-[var(--approve)]/16 bg-[var(--approve-bg)]"
                      : active
                        ? "border-[var(--accent)]/24 bg-[var(--accent)]/10"
                        : "border-white/8 bg-black/12"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`mt-1 grid h-9 w-9 place-items-center rounded-full border text-xs font-semibold uppercase tracking-[0.18em] ${
                        completed
                          ? "border-[var(--approve)]/20 bg-[var(--approve-bg)] text-[var(--approve)]"
                          : active
                            ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]"
                            : "border-white/10 bg-white/[0.03] text-[var(--text-muted)]"
                      }`}
                    >
                      {completed ? "✓" : `${index + 1}`}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-[var(--text)]">{step.label}</div>
                        {active ? (
                          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/18 bg-[var(--accent)]/10 px-2.5 py-1 text-[0.66rem] uppercase tracking-[0.18em] text-[var(--accent)]">
                            <span className="h-2 w-2 animate-pulse-glow rounded-full bg-current" />
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[var(--text-muted)]">{step.detail}</p>
                      {step.moduleId ? (
                        <div className="mt-3 inline-flex rounded-full border border-white/8 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em]" style={{ color: accent }}>
                          {EXPERT_MODULES[step.moduleId].name}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel rounded-[1.8rem] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Live event stream</div>
              <div className="mt-2 text-xl font-semibold">Telemetry feed</div>
            </div>
            <div className="rounded-full border border-white/8 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {recentEvents.length} visible
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {(recentEvents.length ? recentEvents : [{
              type: "status",
              evaluationId: evaluation.id,
              timestamp: new Date().toISOString(),
              data: { message: STATUS_LABELS[evaluation.status] ?? evaluation.status },
            }]).map((event, index) => {
              const tone =
                event.type === "error"
                  ? "var(--reject)"
                  : event.type === "verdict"
                    ? "var(--approve)"
                    : "var(--accent)";
              const message =
                typeof event.data === "object" && event.data !== null
                  ? ((event.data as Record<string, unknown>).message as string | undefined) ??
                    ((event.data as Record<string, unknown>).status as string | undefined) ??
                    JSON.stringify(event.data)
                  : String(event.data);

              return (
                <div key={`${event.timestamp}-${index}`} className="rounded-[1.2rem] border border-white/8 bg-black/18 px-4 py-4 animate-slide-up">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/8 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em]" style={{ color: tone }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
                      {event.type}
                    </div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                      {new Date(event.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{message}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function CompletedResults({ evaluation }: { evaluation: Evaluation }) {
  const moduleIds: ExpertModuleId[] = ["sentinel", "watchdog", "guardian"];
  const council = evaluation.council;
  const assessments = moduleIds
    .map((moduleId) => evaluation.assessments[moduleId])
    .filter((assessment): assessment is ExpertAssessment => Boolean(assessment));

  const totalFindings = assessments.reduce((sum, assessment) => sum + assessment.findings.length, 0);
  const averageScore = assessments.length
    ? Math.round(assessments.reduce((sum, assessment) => sum + assessment.score, 0) / assessments.length)
    : 0;
  const highestRisk = assessments.some((assessment) => assessment.riskLevel === "critical")
    ? "critical"
    : assessments.some((assessment) => assessment.riskLevel === "high")
      ? "high"
      : assessments.some((assessment) => assessment.riskLevel === "medium")
        ? "medium"
        : assessments.some((assessment) => assessment.riskLevel === "low")
          ? "low"
          : "info";

  return (
    <div className="space-y-8 animate-fade-in">
      {council ? <VerdictBanner verdict={council.verdict} confidence={council.confidence} /> : null}

      <section className="grid gap-4 xl:grid-cols-4">
        {[
          { label: "Average score", value: averageScore.toString(), suffix: "/100" },
          { label: "Total findings", value: totalFindings.toString().padStart(2, "0") },
          { label: "Highest risk", value: (SEVERITY_STYLES[highestRisk] ?? SEVERITY_STYLES.info).label },
          { label: "Completed modules", value: assessments.length.toString().padStart(2, "0") },
        ].map((metric, index) => (
          <div key={metric.label} className={`panel rounded-[1.5rem] px-5 py-5 animate-slide-up ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : index === 2 ? "stagger-3" : "stagger-4"}`}>
            <div className="metric-label">{metric.label}</div>
            <div className="mt-4 flex items-end gap-2">
              <div className="metric-value">{metric.value}</div>
              {metric.suffix ? <div className="pb-1 text-sm text-[var(--text-muted)]">{metric.suffix}</div> : null}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Application dossier</div>
          <h2 className="mt-3 text-2xl font-semibold">Mission context</h2>
          <div className="mt-6 space-y-5 text-sm text-[var(--text-muted)]">
            <div>
              <div className="metric-label">Description</div>
              <p className="mt-2 leading-7 text-[var(--text)]">
                {evaluation.application.description || "No mission note supplied."}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="metric-label">Framework</div>
                <div className="mt-2 text-[var(--text)]">{evaluation.application.framework || "Profile pending"}</div>
              </div>
              <div>
                <div className="metric-label">Language</div>
                <div className="mt-2 text-[var(--text)]">{evaluation.application.language || "Unknown"}</div>
              </div>
              <div>
                <div className="metric-label">Files scanned</div>
                <div className="mt-2 text-[var(--text)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {evaluation.application.totalFiles || 0}
                </div>
              </div>
              <div>
                <div className="metric-label">Lines analyzed</div>
                <div className="mt-2 text-[var(--text)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {evaluation.application.totalLines || 0}
                </div>
              </div>
            </div>
            {evaluation.application.entryPoints.length > 0 ? (
              <div>
                <div className="metric-label">Entry points</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {evaluation.application.entryPoints.slice(0, 6).map((entryPoint) => (
                    <span key={entryPoint} className="data-chip rounded-full px-3 py-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      {entryPoint}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Council analysis</div>
          <h2 className="mt-3 text-2xl font-semibold">Narrative synthesis</h2>
          <p className="mt-5 text-sm leading-7 text-[var(--text-muted)]">
            {evaluation.report?.executiveSummary || council?.reasoning || "Council reasoning unavailable."}
          </p>

          {council?.perModuleSummary ? (
            <div className="mt-6 grid gap-3 lg:grid-cols-3">
              {moduleIds.map((moduleId) => {
                const summary = council.perModuleSummary[moduleId];
                if (!summary) return null;

                return (
                  <div
                    key={moduleId}
                    className="rounded-[1.25rem] border border-white/8 bg-black/18 px-4 py-4"
                  >
                    <div className="text-[0.72rem] uppercase tracking-[0.18em]" style={{ color: MODULE_ACCENTS[moduleId] }}>
                      {EXPERT_MODULES[moduleId].name}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{summary}</p>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Expert assessments</div>
            <h2 className="mt-2 text-2xl font-semibold">Module verdicts</h2>
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-3">
          {moduleIds.map((moduleId) => {
            const assessment = evaluation.assessments[moduleId];
            return assessment ? <ModuleCard key={moduleId} moduleId={moduleId} assessment={assessment} /> : null;
          })}
        </div>
      </section>

      {council?.critiques.length ? (
        <section className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">Cross-module dialogue</div>
          <h2 className="mt-3 text-2xl font-semibold">Council critiques</h2>
          <div className="mt-6 space-y-3">
            {council.critiques.map((critique, index) => {
              const tone =
                critique.type === "conflict"
                  ? "var(--review)"
                  : critique.type === "agreement"
                    ? "var(--approve)"
                    : "var(--guardian)";

              return (
                <div key={`${critique.fromModule}-${critique.aboutModule}-${index}`} className="rounded-[1.25rem] border border-white/8 bg-black/18 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-3 text-[0.72rem] uppercase tracking-[0.18em]">
                    <span style={{ color: MODULE_ACCENTS[critique.fromModule] }}>
                      {EXPERT_MODULES[critique.fromModule].name}
                    </span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span style={{ color: MODULE_ACCENTS[critique.aboutModule] }}>
                      {EXPERT_MODULES[critique.aboutModule].name}
                    </span>
                    <span
                      className="rounded-full border px-3 py-1"
                      style={{
                        color: tone,
                        borderColor: `color-mix(in srgb, ${tone} 18%, transparent)`,
                        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                      }}
                    >
                      {critique.type}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{critique.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function EvaluationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvaluation = useCallback(async () => {
    try {
      const nextEvaluation = await getEvaluation(id);
      setEvaluation(nextEvaluation);
      setError(null);
      return nextEvaluation;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evaluation");
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    fetchEvaluation().then((nextEvaluation) => {
      if (!nextEvaluation || ["completed", "failed"].includes(nextEvaluation.status)) return;

      cleanup = subscribeToEvents(id, (event) => {
        setEvents((previous) => [...previous, event]);

        if (event.type === "status") {
          const status = (event.data as Record<string, unknown>).status as EvaluationStatus | undefined;
          if (status) {
            setEvaluation((previous) => (previous ? { ...previous, status } : previous));
          }
        }

        if (event.type === "verdict" || event.type === "complete") {
          void fetchEvaluation();
        }
      });
    });

    return () => cleanup?.();
  }, [fetchEvaluation, id]);

  useEffect(() => {
    if (!evaluation || ["completed", "failed"].includes(evaluation.status)) return;
    const interval = window.setInterval(() => {
      void fetchEvaluation();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [evaluation?.status, fetchEvaluation]);

  const metaItems = useMemo(
    () => [
      { label: "Evaluation ID", value: evaluation ? evaluation.id : "—", kind: "id" as const },
      { label: "Opened", value: evaluation ? formatDate(evaluation.createdAt) : "—", kind: "date" as const },
      { label: "Updated", value: evaluation ? formatDate(evaluation.updatedAt) : "—", kind: "date" as const },
    ],
    [evaluation],
  );

  if (loading) {
    return (
      <div className="flex min-h-[52vh] items-center justify-center">
        <div className="panel rounded-[1.8rem] px-8 py-7 text-center">
          <div className="mx-auto h-12 w-12 animate-spin-slow rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
          <p className="mt-5 text-sm uppercase tracking-[0.22em] text-[var(--text-muted)]">Loading dossier</p>
        </div>
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="mx-auto max-w-2xl pt-20 text-center">
        <div className="panel rounded-[1.9rem] border-[var(--reject)]/25 bg-[linear-gradient(180deg,rgba(239,68,68,0.16),rgba(24,24,27,0.96))] p-8">
          <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--reject)]">Unavailable</div>
          <p className="mt-4 text-base text-[var(--reject)]">{error || "Evaluation not found"}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/evaluations")}
          className="mt-6 rounded-full border border-white/10 px-4 py-2 text-sm text-[var(--text-muted)] transition duration-200 hover:text-[var(--accent)]"
        >
          Back to evaluations
        </button>
      </div>
    );
  }

  const isComplete = evaluation.status === "completed";
  const isFailed = evaluation.status === "failed";
  const title = resolveApplicationTitle(evaluation.application.name, evaluation.application.sourceUrl);
  const sourceUrl = evaluation.application.sourceUrl || (isLikelyUrl(evaluation.application.name) ? evaluation.application.name : "");
  const subtitle = evaluation.application.description;

  return (
    <div className="space-y-8 pb-12">
      <section className="panel animate-scale-in rounded-[2rem] px-6 py-8 sm:px-8 lg:px-10">
        <button
          type="button"
          onClick={() => router.push("/evaluations")}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] transition duration-200 hover:border-white/16 hover:text-[var(--accent)]"
        >
          ← All evaluations
        </button>

        <div className="mt-6 flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="section-kicker">Evaluation dossier</div>
            <h1
              className="mt-5 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text)] sm:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h1>
            {sourceUrl ? (
              <div
                className="mt-3 max-w-3xl text-sm leading-7 text-[var(--text-muted)] break-all"
                style={{ fontFamily: "var(--font-mono)" }}
                title={sourceUrl}
              >
                {sourceUrl}
              </div>
            ) : null}
            {subtitle ? <p className="mt-4 max-w-3xl text-sm leading-8 text-[var(--text-muted)]">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap gap-3 xl:max-w-[32rem] xl:justify-end">
            {metaItems.map((item, index) => (
              <div
                key={item.label}
                className={`min-w-[10.5rem] flex-1 rounded-[1.3rem] border border-white/8 bg-[color:var(--surface)]/70 px-4 py-4 animate-slide-up sm:flex-none ${
                  item.kind === "id" ? "sm:min-w-[14rem] xl:min-w-[15rem]" : "sm:min-w-[11rem]"
                } ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3"}`}
              >
                <div className="metric-label">{item.label}</div>
                <div
                  className={`mt-3 min-w-0 text-[var(--text)] ${
                    item.kind === "id" ? "text-xs leading-6 break-all" : "text-sm leading-6 whitespace-nowrap"
                  }`}
                  style={{ fontFamily: item.kind === "id" ? "var(--font-mono)" : "var(--font-body)" }}
                  title={item.value}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {isFailed ? (
        <section className="panel rounded-[1.9rem] border-[var(--reject)]/25 bg-[linear-gradient(180deg,rgba(239,68,68,0.16),rgba(24,24,27,0.96))] p-7 sm:p-8">
          <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--reject)]">Evaluation failed</div>
          <h2 className="mt-3 text-3xl font-semibold text-[var(--text)]">Execution terminated</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--reject)]/90">
            {evaluation.error || "The evaluation pipeline ended in a failed state before producing a verdict."}
          </p>
        </section>
      ) : null}

      {!isComplete && !isFailed ? <LiveProgress evaluation={evaluation} events={events} /> : null}
      {isComplete ? <CompletedResults evaluation={evaluation} /> : null}
    </div>
  );
}
