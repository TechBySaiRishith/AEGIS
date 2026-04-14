export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 p-3" aria-label="AEGIS is thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:240ms]" />
    </div>
  );
}
