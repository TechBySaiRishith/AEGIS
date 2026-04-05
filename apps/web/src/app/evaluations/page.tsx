"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { VERDICT_STYLES, STATUS_LABELS } from "@aegis/shared";
import type { Evaluation, Verdict, EvaluationStatus } from "@aegis/shared";
import { getEvaluations } from "@/lib/api";

function StatusBadge({ status }: { status: EvaluationStatus }) {
  const isRunning = !["completed", "failed"].includes(status);
  const isFailed = status === "failed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isFailed
          ? "bg-[var(--reject-bg)] text-[var(--reject)]"
          : isRunning
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "bg-[var(--approve-bg)] text-[var(--approve)]"
      }`}
    >
      {isRunning && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
      style={{ background: style.bg, color: style.color }}
    >
      {style.icon} {style.label}
    </span>
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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg pt-20 text-center">
        <div className="rounded-xl border border-[var(--reject)]/30 bg-[var(--reject-bg)] p-6">
          <p className="text-sm text-[var(--reject)]">Failed to load evaluations: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluations</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{evaluations.length} evaluation{evaluations.length !== 1 ? "s" : ""}</p>
        </div>
        <a
          href="/"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--background)] transition hover:brightness-110"
        >
          New evaluation
        </a>
      </div>

      {evaluations.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-12 text-center">
          <p className="text-[var(--text-muted)]">No evaluations yet. Submit your first application to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Application</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Status</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Verdict</th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {evaluations.map((ev) => (
                <tr
                  key={ev.id}
                  onClick={() => router.push(`/evaluations/${ev.id}`)}
                  className="cursor-pointer bg-[var(--surface)]/50 transition hover:bg-[var(--surface)]"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{ev.application?.name || "Untitled"}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-muted)] truncate max-w-xs">
                      {ev.application?.description || ev.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={ev.status} />
                  </td>
                  <td className="px-4 py-3">
                    {ev.council?.verdict ? <VerdictBadge verdict={ev.council.verdict} /> : <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--text-muted)]">
                    {new Date(ev.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
