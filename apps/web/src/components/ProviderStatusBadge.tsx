"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConfigurableProviderId,
  type ProviderConfigEntry,
  configureProvider,
  getProviders,
} from "@/lib/api";

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
  const [showSettings, setShowSettings] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/api/health`, {
        signal,
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshRef.current = () => { load(); };
    load(controller.signal);
    return () => { controller.abort(); };
  }, [load]);

  const handleRefresh = useCallback(() => {
    refreshRef.current();
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="animate-slide-up">
      <BadgeBody
        state={state}
        onSettingsClick={() => setShowSettings(true)}
      />
      {showSettings && (
        <ProviderSettingsModal
          onClose={() => setShowSettings(false)}
          onConfigured={handleRefresh}
        />
      )}
    </div>
  );
}

function BadgeBody({ state, onSettingsClick }: { state: BadgeState; onSettingsClick: () => void }) {
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
        <button
          type="button"
          onClick={onSettingsClick}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--review)]/40 bg-[var(--review)]/10 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--review)] transition-colors hover:bg-[var(--review)]/20"
        >
          <GearIcon />
          Configure providers
        </button>
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
      <span aria-hidden="true" className="h-3 w-px bg-white/15" />
      <button
        type="button"
        onClick={onSettingsClick}
        className="inline-flex items-center rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        aria-label="Configure providers"
        title="Configure providers"
      >
        <GearIcon />
      </button>
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

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ─── Settings Modal ──────────────────────────────────────────

const CONFIGURABLE_PROVIDER_LABELS: Record<ConfigurableProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  copilot: "GitHub Copilot",
  github: "GitHub Models",
};

const PROVIDER_PLACEHOLDER: Record<ConfigurableProviderId, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  copilot: "ghu_...",
  github: "ghp_... or github_pat_...",
};

function ProviderSettingsModal({
  onClose,
  onConfigured,
}: {
  onClose: () => void;
  onConfigured: () => void;
}) {
  const [providers, setProviders] = useState<ProviderConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchProviders() {
      try {
        const data = await getProviders();
        if (!cancelled) setProviders(data);
      } catch {
        if (!cancelled) setError("Failed to load provider status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchProviders();
    return () => { cancelled = true; };
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleConfigure(providerId: ConfigurableProviderId) {
    const input = inputRefs.current[providerId];
    const key = input?.value?.trim();
    if (!key) return;

    setSaving(providerId);
    setError(null);
    setSuccessMsg(null);

    try {
      const result = await configureProvider(providerId, key);
      if (result.success) {
        // Refresh the provider list
        const updated = await getProviders();
        setProviders(updated);
        if (input) input.value = "";
        setSuccessMsg(`${CONFIGURABLE_PROVIDER_LABELS[providerId]} configured successfully`);
        onConfigured();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Configuration failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Configure LLM Providers"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-[var(--surface)] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--text)]">
            Configure Providers
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-xs leading-5 text-[var(--text-muted)]">
          Add API keys to enable LLM providers. Keys are stored in memory only and never written to disk.
        </p>

        {/* Status messages */}
        {error && (
          <div className="mb-3 rounded-lg border border-[var(--reject)]/30 bg-[var(--reject)]/10 px-3 py-2 text-xs text-[var(--reject)]">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-3 rounded-lg border border-[var(--approve)]/30 bg-[var(--approve)]/10 px-3 py-2 text-xs text-[var(--approve)]">
            {successMsg}
          </div>
        )}

        {/* Provider list */}
        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--text-muted)]">Loading providers…</div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/8 bg-black/30 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text)]">
                    {CONFIGURABLE_PROVIDER_LABELS[p.id]}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider ${
                      p.configured
                        ? "border border-[var(--approve)]/30 text-[var(--approve)]"
                        : "border border-white/10 text-[var(--text-muted)]"
                    }`}
                  >
                    {p.configured ? "Active" : "Not configured"}
                  </span>
                </div>
                {p.configured && p.model && (
                  <p className="mt-1 font-mono text-[0.65rem] text-[var(--text-muted)]">
                    Model: {p.model}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    ref={(el) => { inputRefs.current[p.id] = el; }}
                    type="password"
                    placeholder={PROVIDER_PLACEHOLDER[p.id]}
                    className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]/50 focus:border-white/25 focus:outline-none"
                    aria-label={`API key for ${CONFIGURABLE_PROVIDER_LABELS[p.id]}`}
                    disabled={saving === p.id}
                  />
                  <button
                    type="button"
                    onClick={() => handleConfigure(p.id)}
                    disabled={saving === p.id}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--text)] transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    {saving === p.id ? "Saving…" : p.configured ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
