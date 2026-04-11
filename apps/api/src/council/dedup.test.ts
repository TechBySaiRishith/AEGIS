import { describe, it, expect } from "vitest";
import { deduplicateFindings } from "./dedup.js";
import type { ExpertAssessment, Finding } from "@aegis/shared";

// ─── Helpers ──────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    title: "Test Finding",
    severity: "high",
    category: "General",
    description: "A test finding",
    evidence: [],
    ...overrides,
  };
}

function makeAssessment(
  moduleId: "sentinel" | "watchdog" | "guardian",
  findings: Finding[],
): ExpertAssessment {
  return {
    moduleId,
    moduleName: moduleId,
    framework: "test",
    status: "completed",
    score: 80,
    riskLevel: "medium",
    findings,
    summary: "Test",
    recommendation: "Test",
    completedAt: new Date().toISOString(),
    model: "test-model",
  };
}

// ─── Tests ────────────────────────────────────────────────

describe("deduplicateFindings", () => {
  it("leaves findings untouched when there are no duplicates", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "SQL Injection",
          evidence: [{ filePath: "db.py", lineNumber: 10, description: "raw query" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Prompt Leakage",
          evidence: [{ filePath: "chat.py", lineNumber: 50, description: "leak" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result[0].findings[0].corroboratedBy).toBeUndefined();
    expect(result[1].findings[0].corroboratedBy).toBeUndefined();
  });

  it("links findings on same file + same line + similar category", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Credentials",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Credential Exposure",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "cred" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result[0].findings[0].corroboratedBy).toEqual([
      { moduleId: "watchdog", findingId: "w1" },
    ]);
    expect(result[1].findings[0].corroboratedBy).toEqual([
      { moduleId: "sentinel", findingId: "s1" },
    ]);
  });

  it("links findings on nearby lines (within ±5)", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Credentials",
          evidence: [{ filePath: "app.py", lineNumber: 3, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Credential Leak",
          evidence: [{ filePath: "app.py", lineNumber: 7, description: "cred" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result[0].findings[0].corroboratedBy).toHaveLength(1);
    expect(result[1].findings[0].corroboratedBy).toHaveLength(1);
  });

  it("does NOT link findings on distant lines", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Credentials",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Credential Leak",
          evidence: [{ filePath: "app.py", lineNumber: 100, description: "cred" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result[0].findings[0].corroboratedBy).toBeUndefined();
    expect(result[1].findings[0].corroboratedBy).toBeUndefined();
  });

  it("does NOT link findings from different files", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Credentials",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Credential Leak",
          evidence: [{ filePath: "config.py", lineNumber: 5, description: "cred" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result[0].findings[0].corroboratedBy).toBeUndefined();
    expect(result[1].findings[0].corroboratedBy).toBeUndefined();
  });

  it("handles three-way match across all modules", () => {
    const assessments = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Secret Key",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Sensitive Key Exposure",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("guardian", [
        makeFinding({
          id: "g1",
          category: "Secret Key Management",
          evidence: [{ filePath: "app.py", lineNumber: 6, description: "key" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    // Each finding corroborated by the other two
    expect(result[0].findings[0].corroboratedBy).toHaveLength(2);
    expect(result[1].findings[0].corroboratedBy).toHaveLength(2);
    expect(result[2].findings[0].corroboratedBy).toHaveLength(2);
  });

  it("handles empty assessments gracefully", () => {
    const assessments = [
      makeAssessment("sentinel", []),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Prompt Injection",
          evidence: [{ filePath: "chat.py", lineNumber: 1, description: "inj" }],
        }),
      ]),
    ];

    const result = deduplicateFindings(assessments);

    expect(result).toHaveLength(2);
    expect(result[0].findings).toHaveLength(0);
    expect(result[1].findings[0].corroboratedBy).toBeUndefined();
  });

  it("does not mutate the original assessments", () => {
    const original = [
      makeAssessment("sentinel", [
        makeFinding({
          id: "s1",
          category: "Hardcoded Credentials",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "key" }],
        }),
      ]),
      makeAssessment("watchdog", [
        makeFinding({
          id: "w1",
          category: "Credential Leak",
          evidence: [{ filePath: "app.py", lineNumber: 5, description: "cred" }],
        }),
      ]),
    ];

    // Snapshot original state
    const originalJson = JSON.stringify(original);

    deduplicateFindings(original);

    // Original objects must be unchanged
    expect(JSON.stringify(original)).toBe(originalJson);
  });
});
