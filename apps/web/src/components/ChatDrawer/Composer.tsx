"use client";
import { useRef, useState } from "react";
import { uploadChatFile } from "@/lib/chat";
import { AttachmentChip } from "./AttachmentChip";
import { CHAT_LIMITS, type ChatAttachment } from "@aegis/shared";

interface Upload { id: string; name: string; size: number; mime: string; url: string }

export function Composer({ evaluationId, draft, onDraftChange, streaming, onSubmit }: {
  evaluationId: string;
  draft: string;
  onDraftChange: (v: string) => void;
  streaming: boolean;
  onSubmit: (content: string, attachmentIds: string[], attachmentMeta: ChatAttachment[]) => Promise<void>;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const remaining = CHAT_LIMITS.maxFilesPerMessage - uploads.length;
    const toUpload = Array.from(files).slice(0, remaining);
    for (const file of toUpload) {
      try {
        const result = await uploadChatFile(evaluationId, file);
        setUploads(u => [...u, { id: result.id, name: result.name, size: result.size, mime: result.mime, url: result.url }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    }
  };

  const send = async () => {
    if (!draft.trim() && !uploads.length) return;
    if (streaming) return;
    const meta: ChatAttachment[] = uploads.map(u => ({ id: u.id, name: u.name, mime: u.mime, size: u.size, url: u.url }));
    await onSubmit(draft.trim(), uploads.map(u => u.id), meta);
    setUploads([]);
  };

  return (
    <div className="border-t border-white/10 bg-black/20 px-4 py-3">
      {error && <div className="mb-2 text-xs text-red-300">{error}</div>}
      {uploads.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {uploads.map(u => (
            <AttachmentChip key={u.id} name={u.name} size={u.size}
              onRemove={() => setUploads(arr => arr.filter(a => a.id !== u.id))} />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          rows={2}
          placeholder="Ask anything about this report…"
          className="min-h-[48px] max-h-[140px] flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[var(--accent)]/40 focus:outline-none"
        />
        <input ref={fileInput} type="file" multiple hidden
          accept={CHAT_LIMITS.allowedMimeTypes.join(",")}
          onChange={e => handleFiles(e.target.files)} />
        <button type="button" onClick={() => fileInput.current?.click()}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-white/70 hover:bg-white/10"
          aria-label="Attach file">📎</button>
        <button onClick={send} disabled={streaming || (!draft.trim() && !uploads.length)}
          className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20 disabled:opacity-40"
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-white/30">⌘↵ to send · up to {CHAT_LIMITS.maxFilesPerMessage} files, {CHAT_LIMITS.maxFileBytes / 1024 / 1024} MB each</div>
    </div>
  );
}
