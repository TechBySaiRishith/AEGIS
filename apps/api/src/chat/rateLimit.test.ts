import { describe, it, expect, vi } from "vitest";
import { RateLimiter } from "./rateLimit.js";
describe("RateLimiter", () => {
  it("allows N, then blocks", () => {
    vi.useFakeTimers();
    const rl = new RateLimiter({ max: 3, windowMs: 60_000 });
    expect(rl.tryAcquire("k")).toBe(true);
    expect(rl.tryAcquire("k")).toBe(true);
    expect(rl.tryAcquire("k")).toBe(true);
    expect(rl.tryAcquire("k")).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rl.tryAcquire("k")).toBe(true);
  });
});
