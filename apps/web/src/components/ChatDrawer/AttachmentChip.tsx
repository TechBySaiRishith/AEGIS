export function AttachmentChip({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  const kb = (size / 1024).toFixed(0);
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-white/80">
      📎 <span className="max-w-[180px] truncate">{name}</span>
      <span className="text-white/40">{kb} KB</span>
      <button type="button" onClick={onRemove} aria-label="Remove" className="text-white/50 hover:text-white">✕</button>
    </span>
  );
}
