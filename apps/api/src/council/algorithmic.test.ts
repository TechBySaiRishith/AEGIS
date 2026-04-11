import { describe, it, expect } from "vitest";
import { computeAlgorithmicVerdict } from "./algorithmic";
import {
  cleanApproveAssessments,
  corroboratingAssessments,
  criticalRejectAssessments,
  disagreementRiskLevelAssessments,
  disagreementScoreAssessments,
  failedModuleAssessments,
  makeAssessment,
  makeFinding,
  reviewTriggerAssessments,
  tightSigmaAssessments,
} from "./__fixtures__/assessments";

describe("computeAlgorithmicVerdict", () => {
  describe("Pass 1 — REJECT scan", () => {
    it("triggers REJECT when any module score is below 30", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 15, riskLevel: "high" }),
        makeAssessment({ moduleId: "watchdog", score: 75 }),
        makeAssessment({ moduleId: "guardian", score: 80 }),
      ]);
      expect(result.verdict).toBe("REJECT");
      expect(result.reasoning).toMatch(/Sentinel \(15\/100\)/);
    });

    it("triggers REJECT when any critical finding exists, even with score ≥ 30", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 70,
          findings: [
            makeFinding({
              id: "C1",
              title: "RCE in upload",
              severity: "critical",
              category: "rce",
            }),
          ],
        }),
        makeAssessment({ moduleId: "watchdog", score: 80 }),
        makeAssessment({ moduleId: "guardian", score: 85 }),
      ]);
      expect(result.verdict).toBe("REJECT");
      expect(result.reasoning).toMatch(
        /REJECT trigger — critical findings in Sentinel: \[C1\] RCE in upload/,
      );
    });

    it("does not trigger REJECT when all scores ≥ 30 and no criticals", () => {
      const result = computeAlgorithmicVerdict(cleanApproveAssessments());
      expect(result.verdict).not.toBe("REJECT");
    });

    it("REJECT reasoning lists module name and score in `Name (score/100)` format", () => {
      const result = computeAlgorithmicVerdict(criticalRejectAssessments());
      expect(result.verdict).toBe("REJECT");
      expect(result.reasoning).toMatch(/Sentinel \(15\/100\)/);
      expect(result.reasoning).toMatch(/Watchdog \(20\/100\)/);
      expect(result.reasoning).toMatch(/Guardian \(10\/100\)/);
    });

    it("does NOT trigger REJECT from a failed module's placeholder score=0", () => {
      // Real-world scenario: Watchdog's LLM call fails and the failed
      // assessment is emitted with score=0. Pass 1 must skip failed modules
      // so one crashed expert can't drag the whole council to REJECT.
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 85, riskLevel: "low" }),
        makeAssessment({
          moduleId: "watchdog",
          score: 0,
          status: "failed",
          riskLevel: "critical",
          error: "provider timed out",
        }),
        makeAssessment({ moduleId: "guardian", score: 88, riskLevel: "low" }),
      ]);
      expect(result.verdict).toBe("APPROVE");
    });

    it("forces REJECT when every module failed (no coverage = no approval)", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 0, status: "failed", error: "x" }),
        makeAssessment({ moduleId: "watchdog", score: 0, status: "failed", error: "x" }),
        makeAssessment({ moduleId: "guardian", score: 0, status: "failed", error: "x" }),
      ]);
      expect(result.verdict).toBe("REJECT");
      expect(result.reasoning).toMatch(/no completed modules/i);
    });
  });

  describe("Pass 2 — REVIEW scan", () => {
    it("triggers REVIEW when any score is below 60 (and no REJECT)", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 55 }),
        makeAssessment({ moduleId: "watchdog", score: 80 }),
        makeAssessment({ moduleId: "guardian", score: 85 }),
      ]);
      expect(result.verdict).toBe("REVIEW");
      expect(result.reasoning).toMatch(/REVIEW trigger — score below 60/);
    });

    it("triggers REVIEW when ≥2 modules have high findings (HIGH_FINDING_MODULE_THRESHOLD=2)", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 75,
          findings: [
            makeFinding({ id: "S1", severity: "high", category: "csrf" }),
          ],
        }),
        makeAssessment({
          moduleId: "watchdog",
          score: 80,
          findings: [
            makeFinding({ id: "W1", severity: "high", category: "output" }),
          ],
        }),
        makeAssessment({ moduleId: "guardian", score: 85 }),
      ]);
      expect(result.verdict).toBe("REVIEW");
      expect(result.reasoning).toMatch(
        /REVIEW trigger — high-severity findings across 2 modules/,
      );
    });

    it("APPROVES when only 1 module has a high finding and all scores ≥ 60", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 75,
          findings: [
            makeFinding({ id: "S1", severity: "high", category: "csrf" }),
          ],
        }),
        makeAssessment({ moduleId: "watchdog", score: 80 }),
        makeAssessment({ moduleId: "guardian", score: 85 }),
      ]);
      // Only 1 module with high → below threshold of 2, no score <60, no critical
      expect(result.verdict).toBe("APPROVE");
    });

    it("REJECT precedence over REVIEW: score<30 plus high findings still yields REJECT", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 20,
          findings: [
            makeFinding({ id: "S1", severity: "high", category: "csrf" }),
          ],
        }),
        makeAssessment({
          moduleId: "watchdog",
          score: 80,
          findings: [
            makeFinding({ id: "W1", severity: "high", category: "output" }),
          ],
        }),
        makeAssessment({ moduleId: "guardian", score: 85 }),
      ]);
      expect(result.verdict).toBe("REJECT");
      // Pass 2 reasoning should not appear when REJECT supersedes
      expect(result.reasoning).not.toMatch(/REVIEW trigger/);
    });

    it("APPROVES the cleanApproveAssessments fixture", () => {
      const result = computeAlgorithmicVerdict(cleanApproveAssessments());
      expect(result.verdict).toBe("APPROVE");
      expect(result.reasoning).toMatch(/All modules passed/);
    });
  });

  describe("Pass 3 — Corroborations", () => {
    it("records a corroboration when the same category appears in 2+ modules", () => {
      const result = computeAlgorithmicVerdict(corroboratingAssessments());
      expect(result.deliberation.corroborations.length).toBeGreaterThanOrEqual(1);
      expect(result.deliberation.corroborations[0]).toMatch(/auth/i);
    });

    it("matches categories case-insensitively (Auth vs auth)", () => {
      const result = computeAlgorithmicVerdict(corroboratingAssessments());
      // Sentinel uses "Auth", Watchdog uses "auth" — must still corroborate
      expect(
        result.deliberation.corroborations.some((c) => /auth/i.test(c)),
      ).toBe(true);
    });

    it("records no corroborations when categories are disjoint across modules", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 80,
          findings: [
            makeFinding({ id: "S1", severity: "low", category: "csrf" }),
          ],
        }),
        makeAssessment({
          moduleId: "watchdog",
          score: 82,
          findings: [
            makeFinding({ id: "W1", severity: "low", category: "prompt-injection" }),
          ],
        }),
        makeAssessment({
          moduleId: "guardian",
          score: 85,
          findings: [
            makeFinding({ id: "G1", severity: "low", category: "governance" }),
          ],
        }),
      ]);
      expect(result.deliberation.corroborations).toEqual([]);
    });
  });

  describe("Pass 4 — Disagreements", () => {
    it("creates a disagreement entry when score Δ ≥ 30 between two modules", () => {
      const result = computeAlgorithmicVerdict(disagreementScoreAssessments());
      expect(result.deliberation.disagreements.length).toBeGreaterThanOrEqual(1);
      // sentinel 95 vs guardian 40 → Δ55
      expect(
        result.deliberation.disagreements.some((d) => /Δ55/.test(d)),
      ).toBe(true);
    });

    it("creates a disagreement when riskLevel weight Δ ≥ 2 with scoreDiff < 30", () => {
      const result = computeAlgorithmicVerdict(
        disagreementRiskLevelAssessments(),
      );
      expect(
        result.deliberation.disagreements.some((d) => /Risk-level conflict/.test(d)),
      ).toBe(true);
    });

    it("resolution defers to the stricter assessment (lower score / higher risk)", () => {
      const result = computeAlgorithmicVerdict(disagreementScoreAssessments());
      // Stricter is the lowest-scoring module — Guardian (40)
      expect(
        result.deliberation.disagreements.some((d) =>
          /defers to the stricter assessment from Guardian/.test(d),
        ),
      ).toBe(true);
    });
  });

  describe("Pass 5 — Confidence calibration", () => {
    it("returns confidence 0 (and REJECT) for empty assessments", () => {
      const result = computeAlgorithmicVerdict([]);
      expect(result.verdict).toBe("REJECT");
      expect(result.confidence).toBe(0);
    });

    it("applies the tight-σ boost when ≥3 modules agree and σ < 10", () => {
      const result = computeAlgorithmicVerdict(tightSigmaAssessments());
      expect(result.verdict).toBe("APPROVE");
      // base 3/3 * 0.9 = 0.9, +0.05 tight-σ → 0.95
      expect(result.confidence).toBeCloseTo(0.95, 2);
      expect(
        result.deliberation.confidenceFactors.some((f) =>
          /\+5% confidence: modules converge tightly/.test(f),
        ),
      ).toBe(true);
    });

    it("does NOT apply the tight-σ boost with only 2 modules even if σ is tight", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 80, riskLevel: "low" }),
        makeAssessment({ moduleId: "watchdog", score: 82, riskLevel: "low" }),
      ]);
      expect(result.verdict).toBe("APPROVE");
      // base 2/2 * 0.9 = 0.9 — no boost because completedModules < 3
      expect(result.confidence).toBeCloseTo(0.9, 2);
      expect(
        result.deliberation.confidenceFactors.every(
          (f) => !/converge tightly/.test(f),
        ),
      ).toBe(true);
    });

    it("lowers confidence when a module has status='failed'", () => {
      const result = computeAlgorithmicVerdict(failedModuleAssessments());
      // 2 completed both APPROVE-eligible → base 0.9, -0.15 failure penalty → 0.75
      expect(result.confidence).toBeCloseTo(0.75, 2);
      expect(
        result.deliberation.confidenceFactors.some((f) =>
          /1 module\(s\) failed/.test(f),
        ),
      ).toBe(true);
    });

    it("raises confidence when corroborations are present", () => {
      const corroborated = computeAlgorithmicVerdict(corroboratingAssessments());
      // No corroboration baseline: same fixture but disjoint categories
      const baseline = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 75,
          riskLevel: "medium",
          findings: [
            makeFinding({ id: "S1", severity: "medium", category: "csrf" }),
          ],
        }),
        makeAssessment({
          moduleId: "watchdog",
          score: 78,
          riskLevel: "medium",
          findings: [
            makeFinding({ id: "W1", severity: "medium", category: "prompt-injection" }),
          ],
        }),
        makeAssessment({
          moduleId: "guardian",
          score: 80,
          riskLevel: "low",
          findings: [],
        }),
      ]);
      expect(corroborated.confidence).toBeGreaterThan(baseline.confidence);
      expect(
        corroborated.deliberation.confidenceFactors.some((f) =>
          /independently corroborated/.test(f),
        ),
      ).toBe(true);
    });

    it("lowers confidence when disagreements are present", () => {
      const result = computeAlgorithmicVerdict(disagreementScoreAssessments());
      expect(result.deliberation.disagreements.length).toBeGreaterThan(0);
      expect(
        result.deliberation.confidenceFactors.some((f) =>
          /disagreement\(s\) between modules/.test(f),
        ),
      ).toBe(true);
      // Heavy disagreement penalty + 1/3 base → clamped to 0.1
      expect(result.confidence).toBe(0.1);
    });

    it("clamps confidence to the [0.1, 0.98] range", () => {
      // Force a single failed module against an empty completed set:
      // huge penalties should clamp to 0.1, not go negative.
      const allFailed = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", status: "failed", score: 0 }),
        makeAssessment({ moduleId: "watchdog", status: "failed", score: 0 }),
        makeAssessment({ moduleId: "guardian", status: "failed", score: 0 }),
      ]);
      expect(allFailed.confidence).toBeGreaterThanOrEqual(0.1);
      expect(allFailed.confidence).toBeLessThanOrEqual(0.98);

      // And the upper-bound check via the criticalReject fixture (unanimous REJECT,
      // tight σ, plus the 0.98 ceiling).
      const unanimousReject = computeAlgorithmicVerdict(
        criticalRejectAssessments(),
      );
      expect(unanimousReject.confidence).toBeLessThanOrEqual(0.98);
      expect(unanimousReject.confidence).toBeGreaterThanOrEqual(0.1);
    });

    it("base confidence formula: modulesAgreeingWithVerdict / completed * 0.9", () => {
      // 3 agreeing on APPROVE → 3/3 * 0.9 = 0.9 baseline (before any boosts).
      // Scores 70/72/94 chosen carefully: max delta = 24 (< 30, no
      // disagreement penalty) but σ ≈ 10.9 (≥ 10, defeats tight-σ boost).
      const result = computeAlgorithmicVerdict([
        makeAssessment({ moduleId: "sentinel", score: 70, riskLevel: "low" }),
        makeAssessment({ moduleId: "watchdog", score: 72, riskLevel: "low" }),
        makeAssessment({ moduleId: "guardian", score: 94, riskLevel: "low" }),
      ]);
      expect(result.verdict).toBe("APPROVE");
      expect(result.deliberation.disagreements.length).toBe(0);
      expect(result.confidence).toBeCloseTo(0.9, 2);
    });
  });

  describe("Coverage floor (insufficient independent corroboration)", () => {
    // Real-world scenario: 2 of 3 experts crashed (e.g., provider timeout),
    // leaving a single module with a clean score. A single module has no
    // independent corroboration, so the council must NOT issue APPROVE even
    // if that one module is happy — it downgrades to REVIEW and caps the
    // conviction at the coverage-floor ceiling (0.5).

    it("downgrades APPROVE → REVIEW when only 1 of 3 modules completes", () => {
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 88,
          riskLevel: "low",
          findings: [],
        }),
        makeAssessment({
          moduleId: "watchdog",
          status: "failed",
          score: 0,
          error: "provider timed out",
        }),
        makeAssessment({
          moduleId: "guardian",
          status: "failed",
          score: 0,
          error: "provider timed out",
        }),
      ]);
      expect(result.verdict).toBe("REVIEW");
      expect(result.confidence).toBeLessThanOrEqual(0.5);
      expect(
        result.deliberation.confidenceFactors.some((f) =>
          /insufficient coverage/i.test(f),
        ),
      ).toBe(true);
    });

    it("does NOT downgrade REJECT → REVIEW when only 1 module completes", () => {
      // A single module finding a critical issue is enough for REJECT — we
      // defer to the stricter assessment. The coverage floor only blocks
      // APPROVE, not safety-driven rejections.
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 20,
          riskLevel: "critical",
          findings: [
            makeFinding({
              id: "S1",
              severity: "critical",
              title: "Hardcoded credential",
              category: "secrets",
            }),
          ],
        }),
        makeAssessment({
          moduleId: "watchdog",
          status: "failed",
          score: 0,
          error: "boom",
        }),
        makeAssessment({
          moduleId: "guardian",
          status: "failed",
          score: 0,
          error: "boom",
        }),
      ]);
      expect(result.verdict).toBe("REJECT");
    });

    it("does NOT downgrade when exactly 2 of 3 modules complete", () => {
      // Two independent modules is enough corroboration — coverage floor
      // only kicks in below 2 completed.
      const result = computeAlgorithmicVerdict([
        makeAssessment({
          moduleId: "sentinel",
          score: 88,
          riskLevel: "low",
          findings: [],
        }),
        makeAssessment({
          moduleId: "watchdog",
          score: 85,
          riskLevel: "low",
          findings: [],
        }),
        makeAssessment({
          moduleId: "guardian",
          status: "failed",
          score: 0,
          error: "boom",
        }),
      ]);
      expect(result.verdict).toBe("APPROVE");
      expect(
        result.deliberation.confidenceFactors.some((f) =>
          /insufficient coverage/i.test(f),
        ),
      ).toBe(false);
    });
  });

  describe("REVIEW fixture sanity check", () => {
    it("reviewTriggerAssessments resolves to REVIEW", () => {
      const result = computeAlgorithmicVerdict(reviewTriggerAssessments());
      expect(result.verdict).toBe("REVIEW");
    });
  });
});
