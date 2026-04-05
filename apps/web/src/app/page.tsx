"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXPERT_MODULES } from "@aegis/shared";
import type { InputType } from "@aegis/shared";
import { submitEvaluation } from "@/lib/api";

const INPUT_TYPES: { value: InputType; label: string; placeholder: string }[] = [
  { value: "github_url", label: "GitHub URL", placeholder: "https://github.com/org/repo" },
  { value: "conversation_json", label: "Conversation JSON", placeholder: "https://example.com/conversation.json" },
  { value: "api_endpoint", label: "API endpoint", placeholder: "https://api.example.com/v1/chat" },
];

const STEPS = [
  { num: "01", title: "Submit", desc: "Provide your AI application source — a GitHub URL, conversation log, or API endpoint." },
  { num: "02", title: "Analyze", desc: "Three expert modules evaluate security, LLM safety, and governance compliance in parallel." },
  { num: "03", title: "Verdict", desc: "The Council of Experts synthesizes findings into a unified verdict with confidence score." },
];

export default function Home() {
  const router = useRouter();
  const [inputType, setInputType] = useState<InputType>("github_url");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await submitEvaluation({ inputType, source: source.trim(), description: description.trim() || undefined });
      router.push(`/evaluations/${res.evaluationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setLoading(false);
    }
  };

  const currentInput = INPUT_TYPES.find((t) => t.value === inputType)!;

  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="pt-12 text-center">
        <div className="mb-4 inline-block rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-1.5 text-xs font-medium tracking-wide text-[var(--accent)]">
          UNICC AI Safety Lab
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          <span className="text-[var(--accent)]">AEGIS</span> AI Safety Lab
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--text-muted)]">
          Adversarial evaluation and governance for AI systems — powered by a Council of Experts
          that analyzes security, LLM safety, and compliance in parallel.
        </p>
      </section>

      {/* Submission form */}
      <section className="mx-auto max-w-2xl">
        <form onSubmit={handleSubmit} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg shadow-black/20">
          <h2 className="mb-6 text-lg font-semibold">Run an evaluation</h2>

          {/* Input type selector */}
          <div className="mb-4">
            <label className="mb-2 block text-sm text-[var(--text-muted)]">Input type</label>
            <div className="flex gap-2">
              {INPUT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setInputType(t.value)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    inputType === t.value
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Source input */}
          <div className="mb-4">
            <label className="mb-2 block text-sm text-[var(--text-muted)]">Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={currentInput.placeholder}
              required
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--text-muted)]/50 outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/50"
            />
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="mb-2 block text-sm text-[var(--text-muted)]">Description <span className="text-[var(--text-muted)]/50">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the AI application..."
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--text-muted)]/50 outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/50"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-[var(--reject)]/30 bg-[var(--reject-bg)] px-4 py-2.5 text-sm text-[var(--reject)]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !source.trim()}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--background)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Run evaluation"}
          </button>
        </form>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-8 text-center text-2xl font-bold tracking-tight">How it works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.num} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6">
              <div className="mb-3 text-3xl font-bold text-[var(--accent)]/30">{step.num}</div>
              <h3 className="mb-2 font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-[var(--text-muted)]">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Expert modules */}
      <section className="pb-12">
        <h2 className="mb-8 text-center text-2xl font-bold tracking-tight">Council of Experts</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {(Object.entries(EXPERT_MODULES) as [string, typeof EXPERT_MODULES[keyof typeof EXPERT_MODULES]][]).map(([id, mod]) => {
            const accentVar = `var(--${id})`;
            return (
              <div
                key={id}
                className="rounded-xl border bg-[var(--surface)] p-6"
                style={{ borderColor: `color-mix(in srgb, ${accentVar} 30%, transparent)` }}
              >
                <div className="mb-3 text-3xl">{mod.icon}</div>
                <h3 className="mb-1 font-semibold" style={{ color: accentVar }}>{mod.name}</h3>
                <p className="mb-3 text-xs text-[var(--text-muted)]">{mod.framework}</p>
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">{mod.description}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
