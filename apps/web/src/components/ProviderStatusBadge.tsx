"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

type ProviderId = "anthropic" | "openai" | "copilot" | "github" | "custom";

type ProviderInfo = {
  available: boolean;
  model?: string;
};

type HealthResponse = {
  status: string;
  version: string;
  providers: Record<ProviderId, ProviderInfo>;
  modules: {
    sentinel: { ready: boolean };
    watchdog: { ready: boolean };
    guardian: { ready: boolean };
  };
};

type BadgeState =
  | { kind: "loading" }
  | { kind: "unreachable"; message: string }
  | { kind: "zero" }
  | { kind: "ready"; available: ProviderId[]; total: number };

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  copilot: "Copilot",
  github: "GitHub Models",
  custom: "Custom",
};

const PROVIDER_ORDER: ProviderId[] = ["anthropic", "openai", "copilot", "github", "custom"];

export default function ProviderStatusBadge() {
  const [state, setState] = useState<BadgeState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/health`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          setState({ kind: "unreachable", message: `Health check failed (${res.status})` });
          return;
        }
        const data = (await res.json()) as HealthResponse;
        const available = PROVIDER_ORDER.filter((id) => data.providers?.[id]?.available);
        if (available.length === 0) {
          setState({ kind: "zero" });
        } else {
          setState({ kind: "ready", available, total: PROVIDER_ORDER.length });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setState({
          kind: "unreachable",
          message: err instanceof Error ? err.message : "Unable to reach AEGIS API",
        });
      }
    }

    load();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="animate-slide-up">
      <BadgeBody state={state} />
    </div>
  );
}

function BadgeBody({ state }: { state: BadgeState }) {
  if (state.kind === "loading") {
    return (
      <div
        className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]"
      >
        <PulseDot color="var(--text-muted)" />
        <span>Polling provider mesh</span>
      </div>
    );
  }

  if (state.kind === "unreachable") {
    return (
      <div
        className="rounded-2xl border border-[var(--reject)]/35 bg-[var(--reject-bg)] px-5 py-4 shadow-[0_18px_38px_rgba(239,68,68,0.12)]"
      >
        <div className="flex items-center gap-3">
          <PulseDot color="var(--reject)" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[var(--reject)]">
            Control plane unreachable
          </span>
        </div>
        <p className="mt-2 text-xs leading-6 text-[var(--text-muted)]">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "zero") {
    return (
      <div
        className="rounded-2xl border border-[var(--review)]/35 bg-[var(--review-bg)] px-5 py-4 shadow-[0_18px_38px_rgba(245,158,11,0.12)]"
      >
        <div className="flex items-center gap-3">
          <PulseDot color="var(--review)" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[var(--review)]">
            No LLM providers configured
          </span>
        </div>
        <p className="mt-2 text-xs leading-6 text-[var(--text-muted)]">
          AEGIS is online but no provider credentials were detected. Configure at least one
          provider so the council can render verdicts.
        </p>
      </div>
    );
  }

  return (
    <div
      className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-full border border-[var(--approve)]/30 bg-[color-mix(in_srgb,var(--approve)_10%,rgba(9,9,11,0.7))] px-4 py-2.5 shadow-[0_18px_38px_rgba(34,197,94,0.10)]"
    >
      <PulseDot color="var(--approve)" />
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[var(--approve)]">
        Providers online
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-white/15" />
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {state.available.length}/{state.total}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-white/15" />
      <span className="flex flex-wrap items-center gap-1.5">
        {state.available.map((id) => (
          <span
            key={id}
            className="rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--text)]"
          >
            {PROVIDER_LABELS[id]}
          </span>
        ))}
      </span>
    </div>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      <span
        className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60"
        style={{ background: color }}
      />
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 14px ${color}` }}
      />
    </span>
  );
}
