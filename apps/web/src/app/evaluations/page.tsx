"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VERDICT_STYLES, STATUS_LABELS } from "@aegis/shared";
import type { Evaluation, Verdict, EvaluationStatus } from "@aegis/shared";
import { getEvaluations } from "@/lib/api";
import { displayName } from "./display-name";

function StatusBadge({ status }: { status: EvaluationStatus }) {
  const isRunning = !["completed", "failed"].includes(status);
  const isFailed = status === "failed";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em] ${
        isFailed
          ? "border-[var(--reject)]/20 bg-[var(--reject-bg)] text-[var(--reject)]"
          : isRunning
            ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border-[var(--approve)]/20 bg-[var(--approve-bg)] text-[var(--approve)]"
      }`}
    >
      {isRunning ? <span className="h-2 w-2 animate-pulse-glow rounded-full bg-current" /> : null}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.REVIEW;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em]"
      style={{
        color: style.color,
        background: style.bg,
        borderColor: `color-mix(in srgb, ${style.color} 20%, transparent)`,
      }}
    >
      <span>{style.icon}</span>
      {style.label}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="panel rounded-[1.5rem] p-5">
            <div className="skeleton animate-shimmer h-3 w-24" />
            <div className="skeleton animate-shimmer mt-4 h-8 w-20" />
            <div className="skeleton animate-shimmer mt-3 h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="panel overflow-hidden rounded-[1.75rem]">
        <div className="space-y-4 p-6">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="grid gap-4 border-b border-white/6 pb-4 last:border-b-0 last:pb-0 lg:grid-cols-[2fr_1.2fr_1.2fr_1fr]">
              <div className="space-y-3">
                <div className="skeleton animate-shimmer h-4 w-44" />
                <div className="skeleton animate-shimmer h-3 w-72" />
              </div>
              <div className="skeleton animate-shimmer h-9 w-32" />
              <div className="skeleton animate-shimmer h-9 w-32" />
              <div className="skeleton animate-shimmer h-4 w-24 justify-self-end" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EvaluationsPage() {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEvaluations()
      .then(setEvaluations)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const active = evaluations.filter((evaluation) => !["completed", "failed"].includes(evaluation.status)).length;
    const completed = evaluations.filter((evaluation) => evaluation.status === "completed").length;
    const flagged = evaluations.filter((evaluation) => evaluation.council?.verdict === "REJECT").length;

    return [
      { label: "Total evaluations", value: evaluations.length.toString().padStart(2, "0") },
      { label: "Active runs", value: active.toString().padStart(2, "0") },
      { label: "Reject verdicts", value: flagged.toString().padStart(2, "0") },
      { label: "Completed", value: completed.toString().padStart(2, "0") },
    ];
  }, [evaluations]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl pt-20 text-center">
        <div className="panel rounded-[1.75rem] border-[var(--reject)]/25 bg-[linear-gradient(180deg,rgba(239,68,68,0.16),rgba(24,24,27,0.96))] p-8">
          <div className="text-[0.72rem] uppercase tracking-[0.26em] text-[var(--reject)]">Load failure</div>
          <p className="mt-4 text-base text-[var(--reject)]">Failed to load evaluations: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <section className="panel animate-scale-in rounded-[2rem] px-6 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="section-kicker">Evaluation archive</div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Operational review ledger</h1>
            <p className="max-w-2xl text-base leading-8 text-[var(--text-muted)]">
              Monitor every intake, in-flight council review, and final verdict from a single
              mission-ready surface.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-5 py-3 text-sm font-semibold text-[var(--accent)] transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--accent)]/14"
          >
            Launch new evaluation
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat, index) => (
            <div key={stat.label} className={`panel-interactive rounded-[1.4rem] border border-white/8 bg-white/[0.03] px-5 py-5 animate-slide-up ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : index === 2 ? "stagger-3" : "stagger-4"}`}>
              <div className="metric-label">{stat.label}</div>
              <div className="metric-value mt-4">{stat.value}</div>
            </div>
          ))}
        </div>
      </section>

      {evaluations.length === 0 ? (
        <div className="panel animate-scale-in rounded-[2rem] p-10 text-center sm:p-14">
          <div className="mx-auto grid h-[4.5rem] w-[4.5rem] place-items-center rounded-[1.75rem] border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-3xl text-[var(--accent)] shadow-[0_0_40px_rgba(34,211,238,0.12)]">
            ⌁
          </div>
          <h2 className="mt-6 text-2xl font-semibold">No evaluations yet</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--text-muted)]">
            Submit an AI application for review from the homepage — paste any public GitHub repo
            URL, an LLM conversation JSON export, or a live API endpoint to see the full Council of
            Experts pipeline in action.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-5 py-3 text-sm font-semibold text-[var(--accent)] transition duration-200 hover:bg-[var(--accent)]/14"
          >
            Go to homepage →
          </Link>
        </div>
      ) : (
        <section className="panel overflow-hidden rounded-[2rem] animate-scale-in">
          <div className="border-b border-white/6 px-6 py-5 sm:px-8">
            <div className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">
              Recent activity
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-[0.72rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  <th className="px-6 py-4 sm:px-8">Application</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Verdict</th>
                  <th className="px-6 py-4 text-right sm:px-8">Opened</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((evaluation) => (
                  <tr
                    key={evaluation.id}
                    onClick={() => router.push(`/evaluations/${evaluation.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/evaluations/${evaluation.id}`);
                      }
                    }}
                    tabIndex={0}
                    className="group cursor-pointer border-t border-white/6 transition duration-200 hover:bg-white/[0.035]"
                  >
                    <td className="px-6 py-5 sm:px-8">
                        <div className="space-y-2">
                          <div className="font-semibold text-[var(--text)] transition group-hover:text-[var(--accent)]">
                            {displayName(evaluation)}
                          </div>
                          <div className="max-w-xl text-sm leading-6 text-[var(--text-muted)]">
                            {evaluation.application.description || evaluation.application.sourceUrl || evaluation.id}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <StatusBadge status={evaluation.status} />
                    </td>
                    <td className="px-6 py-5">
                      {evaluation.council?.verdict ? (
                        <VerdictBadge verdict={evaluation.council.verdict} />
                      ) : (
                        <span className="inline-flex rounded-full border border-white/8 px-3 py-1 text-[0.72rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right text-[var(--text-muted)] sm:px-8">
                      {new Date(evaluation.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      <div className="mt-1 text-xs text-[var(--text-muted)]/75">
                        {new Date(evaluation.createdAt).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
