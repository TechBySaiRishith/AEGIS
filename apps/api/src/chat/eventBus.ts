import type { ChatSSEEvent } from "@aegis/shared";

interface Entry { event: ChatSSEEvent; ts: number }
const buffers = new Map<string, Entry[]>();   // keyed by assistant messageId
const listeners = new Map<string, Set<(e: ChatSSEEvent) => void>>();
const TTL_MS = 30_000;

const GC_INTERVAL_MS = 60_000;

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entries] of buffers) {
    const kept = entries.filter(e => e.ts >= cutoff);
    if (kept.length === 0 && !listeners.has(id)) {
      buffers.delete(id);
    } else if (kept.length !== entries.length) {
      buffers.set(id, kept);
    }
  }
}, GC_INTERVAL_MS).unref(); // don't hold the process open

export function publish(messageId: string, event: ChatSSEEvent): void {
  const arr = buffers.get(messageId) ?? [];
  arr.push({ event, ts: Date.now() });
  // GC expired
  const cutoff = Date.now() - TTL_MS;
  buffers.set(messageId, arr.filter(e => e.ts >= cutoff));
  const set = listeners.get(messageId);
  if (set) for (const cb of set) cb(event);
}

export function replay(messageId: string): ChatSSEEvent[] {
  return (buffers.get(messageId) ?? []).map(e => e.event);
}

export function subscribe(messageId: string, cb: (e: ChatSSEEvent) => void): () => void {
  let set = listeners.get(messageId);
  if (!set) { set = new Set(); listeners.set(messageId, set); }
  set.add(cb);
  return () => { set!.delete(cb); if (!set!.size) listeners.delete(messageId); };
}
