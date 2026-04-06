"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EXPERT_MODULES } from "@aegis/shared";
import type { InputType } from "@aegis/shared";
import { submitEvaluation } from "@/lib/api";

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/;

const INPUT_TYPES: { value: InputType; label: string; placeholder: string; hint: string }[] = [
  {
    value: "github_url",
    label: "GitHub URL",
    placeholder: "https://github.com/FlashCarrot/VeriMedia",
    hint: "Repository or branch to inspect",
  },
  {
    value: "conversation_json",
    label: "Conversation JSON",
    placeholder: '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}',
    hint: "Transcript, traces, or prompt logs",
  },
  {
    value: "api_endpoint",
    label: "API endpoint",
    placeholder: "https://api.example.com/v1/chat",
    hint: "Live model or AI workflow endpoint",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Intake and scoping",
    desc: "AEGIS fingerprints the application, input surface, and operating context before any expert analysis begins.",
  },
  {
    num: "02",
    title: "Parallel expert review",
    desc: "Sentinel, Watchdog, and Guardian execute concurrently across security, LLM behavior, and governance controls.",
  },
  {
    num: "03",
    title: "Council verdict",
    desc: "A unified decision package consolidates findings, confidence, and remediation priorities for leadership review.",
  },
];

const HERO_METRICS = [
  { label: "Expert modules", value: "03" },
  { label: "Risk domains", value: "05" },
  { label: "Council synthesis", value: "Live" },
];

export default function Home() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputType, setInputType] = useState<InputType>("github_url");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const currentInput = INPUT_TYPES.find((type) => type.value === inputType) ?? INPUT_TYPES[0];

  const validateSource = (value: string, type: InputType = inputType): boolean => {
    const trimmed = value.trim();

    if (!trimmed) {
      setSourceError(null);
      return true;
    }

    if (type === "github_url" && !GITHUB_URL_RE.test(trimmed)) {
      setSourceError("Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo)");
      return false;
    }

    if (type === "api_endpoint") {
      try {
        const parsed = new URL(trimmed);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid protocol");
      } catch {
        setSourceError("Please enter a valid API endpoint URL.");
        return false;
      }
    }

    if (type === "conversation_json") {
      try {
        JSON.parse(trimmed);
      } catch {
        setSourceError("Please provide valid JSON conversation content.");
        return false;
      }
    }

    setSourceError(null);
    return true;
  };

  const handleJsonUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setSource(result);
      validateSource(result, "conversation_json");
    };

    reader.onerror = () => {
      setSourceError("Unable to read the selected JSON file.");
    };

    reader.readAsText(file);
    event.target.value = "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedSource = source.trim();
    if (!trimmedSource || !validateSource(trimmedSource)) return;

    setLoading(true);
    setError(null);

    try {
      const response = await submitEvaluation({
        inputType,
        source: trimmedSource,
        description: description.trim() || undefined,
      });
      router.push(`/evaluations/${response.evaluationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-24 pb-14">
      <section className="panel animate-scale-in rounded-[2rem] px-6 py-10 sm:px-8 lg:px-10 lg:py-12">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_48%),radial-gradient(circle_at_72%_60%,rgba(167,139,250,0.12),transparent_36%)]" />
        <div className="absolute -left-12 top-16 h-40 w-40 rounded-full bg-[var(--accent)]/10 blur-3xl" />
        <div className="absolute right-16 top-8 h-24 w-24 animate-float rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 blur-xl" />
        <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <div className="relative space-y-8">
            <div className="animate-slide-up">
              <div className="section-kicker">Council of Experts</div>
              <h1
                className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.05em] sm:text-6xl lg:text-[4.8rem] lg:leading-[0.96]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Mission control for
                <span className="text-gradient"> AI safety assurance</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--text-muted)] sm:text-lg">
                AEGIS gives UNICC security researchers a command-center view of AI application
                risk, combining adversarial evaluation, governance review, and production security
                analysis in one authoritative workflow.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {HERO_METRICS.map((metric, index) => (
                <div
                  key={metric.label}
                  className={`panel-interactive animate-slide-up rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-5 ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3"}`}
                >
                  <div className="metric-label">{metric.label}</div>
                  <div className="metric-value mt-3">{metric.value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">
              <span className="data-chip rounded-full px-3 py-2">Security posture</span>
              <span className="data-chip rounded-full px-3 py-2">LLM resilience</span>
              <span className="data-chip rounded-full px-3 py-2">Governance controls</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="panel animate-slide-up stagger-2 rounded-[1.75rem] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="section-kicker">Start evaluation</div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight">Submit an AI system</h2>
                <p className="mt-2 text-sm leading-7 text-[var(--text-muted)]">
                  Point AEGIS at a repository, transcript, or endpoint and launch the expert review.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-4 py-3 text-right">
                <div className="metric-label">Mode</div>
                <div className="mt-2 text-sm font-semibold text-[var(--accent)]">Dark operations</div>
              </div>
            </div>

            <div className="mt-8 space-y-6">
              <div>
                <label className="mb-3 block text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  Intake format
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {INPUT_TYPES.map((type, index) => {
                    const active = inputType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => {
                          setInputType(type.value);
                          setSource("");
                          setSourceError(null);
                          setError(null);
                        }}
                        className={`panel-interactive rounded-2xl border px-4 py-4 text-left ${
                          active
                            ? "border-[var(--accent)]/45 bg-[var(--accent)]/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                            : "border-white/8 bg-white/[0.025] hover:border-white/16"
                        } ${index === 0 ? "animate-slide-up stagger-1" : index === 1 ? "animate-slide-up stagger-2" : "animate-slide-up stagger-3"}`}
                      >
                        <div className="text-sm font-semibold text-[var(--text)]">{type.label}</div>
                        <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{type.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-3 block text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    {inputType === "conversation_json" ? "Conversation payload" : "Source locator"}
                  </label>
                  {inputType === "conversation_json" ? (
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={handleJsonUpload}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3.5 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition duration-200 hover:border-[var(--accent)]/45 hover:bg-[var(--accent)]/10"
                        >
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 11V3m0 0L5.25 5.75M8 3l2.75 2.75M3 11.5v1.25C3 13.44 3.56 14 4.25 14h7.5c.69 0 1.25-.56 1.25-1.25V11.5"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Load JSON file
                        </button>
                        <span className="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Import a local transcript into the payload field
                        </span>
                      </div>
                      <textarea
                        value={source}
                        onChange={(event) => {
                          setSource(event.target.value);
                          if (sourceError) validateSource(event.target.value, "conversation_json");
                        }}
                        onBlur={() => validateSource(source, "conversation_json")}
                        placeholder={currentInput.placeholder}
                        required
                        rows={11}
                        className={`w-full resize-none rounded-2xl border bg-black/30 px-4 py-3.5 font-mono text-sm leading-6 text-[var(--text)] transition duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60 ${
                          sourceError ? "border-[var(--reject)]/60" : "border-white/10"
                        }`}
                      />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={source}
                      onChange={(event) => {
                        setSource(event.target.value);
                        if (sourceError) validateSource(event.target.value);
                      }}
                      onBlur={() => validateSource(source)}
                      placeholder={currentInput.placeholder}
                      required
                      className={`w-full rounded-2xl border bg-black/30 px-4 py-3.5 text-sm text-[var(--text)] transition duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60 ${
                        sourceError ? "border-[var(--reject)]/60" : "border-white/10"
                      }`}
                    />
                  )}
                  {sourceError ? <p className="mt-2 text-xs text-[var(--reject)]">{sourceError}</p> : null}
                </div>

                <div>
                  <label className="mb-3 block text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    Mission note
                    <span className="ml-2 tracking-normal lowercase text-[var(--text-muted)]/75">optional</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe the deployment context, threat posture, or research objective."
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-sm leading-7 text-[var(--text)] transition duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60"
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-[var(--reject)]/25 bg-[var(--reject-bg)] px-4 py-3 text-sm text-[var(--reject)]">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || !source.trim() || !!sourceError}
                className="group relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--accent)]/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(8,145,178,0.88))] px-4 py-3.5 text-sm font-semibold text-[var(--background)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(34,211,238,0.22)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="absolute inset-y-0 left-0 w-24 animate-scan bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)] opacity-70" />
                <span className="relative flex items-center gap-2">
                  {loading ? (
                    <>
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--background)]" />
                      Initializing evaluation…
                    </>
                  ) : (
                    <>Launch Council review</>
                  )}
                </span>
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="space-y-8">
        <div className="max-w-3xl space-y-3">
          <div className="section-kicker">How it works</div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">A deliberate three-stage review pipeline</h2>
          <p className="text-[var(--text-muted)]">
            Built for high-stakes deployments where every finding needs context, traceability, and an
            institution-ready decision path.
          </p>
        </div>

        <div className="relative grid gap-5 lg:grid-cols-3">
          <div className="pointer-events-none absolute left-[16.66%] right-[16.66%] top-12 hidden h-px bg-[linear-gradient(90deg,rgba(34,211,238,0.18),rgba(167,139,250,0.22),rgba(245,158,11,0.16))] lg:block" />
          {STEPS.map((step, index) => (
            <div key={step.num} className={`panel panel-interactive animate-slide-up rounded-[1.6rem] p-6 ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3"}`}>
              <div className="relative mb-6 flex items-center gap-4">
                <div className="relative grid h-12 w-12 place-items-center rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                  <span className="absolute inset-1 rounded-xl border border-white/8" />
                  <span className="relative">{step.num}</span>
                </div>
                <div className="text-lg font-semibold">{step.title}</div>
              </div>
              <p className="text-sm leading-7 text-[var(--text-muted)]">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <div className="max-w-3xl space-y-3">
          <div className="section-kicker">Council of Experts</div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Three perspectives, one unified decision surface</h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {(Object.entries(EXPERT_MODULES) as Array<
            [string, (typeof EXPERT_MODULES)[keyof typeof EXPERT_MODULES]]
          >).map(([id, module], index) => {
            const accent = `var(--${id})`;
            return (
              <div
                key={id}
                className={`panel panel-interactive animate-slide-up rounded-[1.75rem] p-6 ${index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3"}`}
                style={{
                  borderColor: `color-mix(in srgb, ${accent} 34%, rgba(255,255,255,0.08))`,
                  background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 12%, rgba(24,24,27,0.98)) 0%, rgba(24,24,27,0.96) 50%), linear-gradient(135deg, rgba(255,255,255,0.04), transparent)`,
                }}
              >
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-black/20 text-2xl">
                      {module.icon}
                    </div>
                    <h3 className="mt-5 text-2xl font-semibold" style={{ color: accent }}>
                      {module.name}
                    </h3>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--text-muted)]">
                      {module.framework}
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 px-3 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Module 0{index + 1}
                  </div>
                </div>

                <p className="mt-6 text-sm leading-7 text-[var(--text-muted)]">{module.description}</p>

                <div className="mt-8 flex items-center justify-between border-t border-white/8 pt-4 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <span>Distinct lens</span>
                  <span style={{ color: accent }}>Always in council</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
