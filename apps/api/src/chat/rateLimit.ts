// apps/api/src/chat/rateLimit.ts
export class RateLimiter {
  private buckets = new Map<string, number[]>();
  constructor(private opts: { max: number; windowMs: number }) {}
  tryAcquire(key: string): boolean {
    const now = Date.now();
    const arr = this.buckets.get(key) ?? [];
    const kept = arr.filter(t => now - t < this.opts.windowMs);
    if (kept.length >= this.opts.max) { this.buckets.set(key, kept); return false; }
    kept.push(now);
    this.buckets.set(key, kept);
    return true;
  }
}
