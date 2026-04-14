const PROMPTS = [
  "Summarize the key findings",
  "How do I fix the top issue?",
  "Explain Guardian's verdict",
  "What are the biggest security risks?",
  "Show remediation steps for critical findings",
];

export function SuggestedPrompts({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="text-sm font-semibold text-white">Ask anything about this evaluation</div>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
