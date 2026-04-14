import { describe, it, expect } from "vitest";
import { buildSystemPrompt, budgetTrimHistory } from "./prompt.js";
describe("chat prompt", () => {
  it("includes verdict and top findings", () => {
    const prompt = buildSystemPrompt({
      id: "eval-1",
      verdict: "REVIEW",
      perModuleScores: { sentinel: 80, watchdog: 60, guardian: 70 },
      findings: [{ id: "F-1", severity: "high", summary: "SQL injection in login", file: "auth.ts" }],
    });
    expect(prompt).toContain("REVIEW");
    expect(prompt).toContain("F-1");
    expect(prompt).toContain("<user-attachment>");
  });

  it("budgetTrimHistory drops oldest assistant messages first", () => {
    const msgs = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(10_000) },
      { role: "user", content: "c".repeat(100) },
      { role: "assistant", content: "d".repeat(100) },
    ];
    const trimmed = budgetTrimHistory(msgs as never, 500);
    expect(trimmed.some(m => typeof m.content === "string" && m.content.startsWith("b"))).toBe(false);
  });
});
