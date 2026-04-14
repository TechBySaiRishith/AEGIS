import type { ChatMessage } from "@aegis/shared";
import type { ReactNode } from "react";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} px-5 py-2`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm ${
          mine
            ? "bg-[var(--accent)]/25 text-white border border-[var(--accent)]/60"
            : "bg-white/[0.05] text-white/90 border border-white/10"
        }`}
      >
        {mine && (
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--accent)]/80">You</div>
        )}
        <div className="prose-chat">
          <FormattedContent content={message.content} />
        </div>
        {message.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.attachments.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                📎 {a.name}
              </span>
            ))}
          </div>
        ) : null}
        {message.status === "error" && (
          <div className="mt-2 text-xs text-red-300">Error: {message.errorMessage}</div>
        )}
      </div>
    </div>
  );
}

// ─── Minimal markdown renderer ─────────────────────────────────
// Supports: fenced code blocks, headers (#, ##, ###), bold (**), italic (*/_),
// inline code (`), unordered lists (- / *), ordered lists (1.), citations [F-1],
// blank-line paragraph separation, horizontal rules (---).

function FormattedContent({ content }: { content: string }) {
  // Split by fenced code blocks first so we don't touch their content.
  const segments = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith("```")) {
          const m = /^```([a-z0-9]*)\n?([\s\S]*?)```$/m.exec(seg);
          const lang = m?.[1] ?? "";
          const code = m?.[2] ?? seg.slice(3, -3);
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 text-[12px] text-white/90"
            >
              {lang && <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">{lang}</div>}
              <code className="whitespace-pre font-mono">{code}</code>
            </pre>
          );
        }
        return <BlockRenderer key={i} text={seg} />;
      })}
    </>
  );
}

function BlockRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-white/10" />);
      i++;
      continue;
    }

    // Headers
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? "mt-3 mb-2 text-base font-semibold text-white"
          : level === 2
          ? "mt-3 mb-1.5 text-[15px] font-semibold text-white"
          : "mt-2 mb-1 text-[13.5px] font-semibold text-white";
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-white/40">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-white/40">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive non-blank lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5">
        {renderInline(paraLines.join(" "))}
      </p>,
    );
  }

  return <>{blocks}</>;
}

function renderInline(text: string): ReactNode {
  // Order matters: citations → inline code → bold → italic
  const nodes: ReactNode[] = [];
  // Tokenize by a combined regex capturing each inline pattern.
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[A-Z]-\d+\])/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-white/10 px-1 py-0.5 text-[12px] font-mono text-white">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(
        <em key={key++} className="italic text-white/90">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (/^\[[A-Z]-\d+\]$/.test(token)) {
      nodes.push(
        <span
          key={key++}
          className="mx-0.5 inline-flex rounded-md border border-[var(--accent)]/50 bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]"
        >
          {token.slice(1, -1)}
        </span>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
