import type {
  ExpertAssessment,
  ExpertModuleId,
  Finding,
  Severity,
} from "@aegis/shared";

/**
 * Test fixtures for ExpertAssessment + Finding objects used by the
 * algorithmic-arbitration vitest suite. All factories return fully-typed
 * shapes with safe defaults that callers can override via partials.
 */

export function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    id: "F1",
    title: "Generic finding",
    severity: "medium",
    category: "generic",
    description: "Generic finding description",
    evidence: [
      {
        filePath: "src/index.ts",
        description: "Generic evidence",
      },
    ],
    remediation: "Address the generic finding.",
    framework: "CWE-000",
    ...partial,
  };
}

const moduleNameFor: Record<ExpertModuleId, string> = {
  sentinel: "Sentinel",
  watchdog: "Watchdog",
  guardian: "Guardian",
};

const frameworkFor: Record<ExpertModuleId, string> = {
  sentinel: "CWE/OWASP Web",
  watchdog: "OWASP LLM Top 10",
  guardian: "NIST AI RMF",
};

export function makeAssessment(
  partial: Partial<ExpertAssessment> = {},
): ExpertAssessment {
  const moduleId: ExpertModuleId = partial.moduleId ?? "sentinel";
  return {
    moduleId,
    moduleName: moduleNameFor[moduleId],
    framework: frameworkFor[moduleId],
    status: "completed",
    score: 75,
    riskLevel: "medium" as Severity,
    findings: [],
    summary: "Default summary.",
    recommendation: "Default recommendation.",
    completedAt: "2026-04-11T00:00:00.000Z",
    model: "test-model",
    ...partial,
  };
}

/** Three assessments — every score < 30 and every module has a critical finding. */
export function criticalRejectAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 15,
      riskLevel: "critical",
      findings: [
        makeFinding({
          id: "S1",
          title: "SQL injection in /login",
          severity: "critical",
          category: "injection",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 20,
      riskLevel: "critical",
      findings: [
        makeFinding({
          id: "W1",
          title: "Prompt injection vector",
          severity: "critical",
          category: "prompt-injection",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 10,
      riskLevel: "critical",
      findings: [
        makeFinding({
          id: "G1",
          title: "No model governance",
          severity: "critical",
          category: "governance",
        }),
      ],
    }),
  ];
}

/** ≥2 modules with high findings, scores 40-55, no criticals → REVIEW. */
export function reviewTriggerAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 55,
      riskLevel: "high",
      findings: [
        makeFinding({
          id: "S1",
          title: "Missing CSRF protection",
          severity: "high",
          category: "csrf",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 50,
      riskLevel: "high",
      findings: [
        makeFinding({
          id: "W1",
          title: "Unbounded LLM output",
          severity: "high",
          category: "output-handling",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 40,
      riskLevel: "medium",
      findings: [
        makeFinding({
          id: "G1",
          title: "Audit log gap",
          severity: "medium",
          category: "audit",
        }),
      ],
    }),
  ];
}

/** All scores ≥ 60, max severity medium → APPROVE. */
export function cleanApproveAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 88,
      riskLevel: "low",
      findings: [
        makeFinding({
          id: "S1",
          title: "Verbose error message",
          severity: "low",
          category: "info-disclosure",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 82,
      riskLevel: "low",
      findings: [
        makeFinding({
          id: "W1",
          title: "System prompt visible",
          severity: "medium",
          category: "prompt-hygiene",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 90,
      riskLevel: "low",
      findings: [],
    }),
  ];
}

/** ≥2 modules with score delta ≥ 30 (no critical/high so REJECT/REVIEW from score only). */
export function disagreementScoreAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 95,
      riskLevel: "low",
      findings: [],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 60,
      riskLevel: "medium",
      findings: [],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 40,
      riskLevel: "medium",
      findings: [],
    }),
  ];
}

/** scoreDiff < 30 between all pairs but riskLevel weight Δ ≥ 2 between two modules. */
export function disagreementRiskLevelAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 70,
      // weight 0
      riskLevel: "info",
      findings: [],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 65,
      // weight 2 — Δ from sentinel = 2 (≥2) and scoreDiff = 5 (<30)
      riskLevel: "medium",
      findings: [],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 68,
      riskLevel: "low",
      findings: [],
    }),
  ];
}

/** Same category (case-insensitive) appears across 2+ modules. */
export function corroboratingAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 75,
      riskLevel: "medium",
      findings: [
        makeFinding({
          id: "S1",
          title: "Weak auth check",
          severity: "medium",
          category: "Auth",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "watchdog",
      score: 78,
      riskLevel: "medium",
      findings: [
        makeFinding({
          id: "W1",
          title: "Token leak in logs",
          severity: "medium",
          // case differs from sentinel — should still corroborate
          category: "auth",
        }),
      ],
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 80,
      riskLevel: "low",
      findings: [],
    }),
  ];
}

/** One module with status = "failed". */
export function failedModuleAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({
      moduleId: "sentinel",
      score: 80,
      riskLevel: "low",
      findings: [],
    }),
    makeAssessment({
      // Failed module: score set to a neutral value (75) rather than 0 so it
      // does not trip Pass-1 REJECT. Pass 1 iterates ALL assessments (not just
      // completed), so a failed module with score=0 would cause the whole
      // council to REJECT on score alone — which isn't what this fixture is
      // trying to isolate. This lets Pass 5 apply its -0.15 failed penalty
      // cleanly against an otherwise-APPROVE base.
      moduleId: "watchdog",
      score: 75,
      riskLevel: "medium",
      status: "failed",
      findings: [],
      error: "module crashed",
    }),
    makeAssessment({
      moduleId: "guardian",
      score: 82,
      riskLevel: "low",
      findings: [],
    }),
  ];
}

/** Three completed modules agreeing on APPROVE with σ < 10 — should trigger tight-σ boost. */
export function tightSigmaAssessments(): ExpertAssessment[] {
  return [
    makeAssessment({ moduleId: "sentinel", score: 80, riskLevel: "low", findings: [] }),
    makeAssessment({ moduleId: "watchdog", score: 82, riskLevel: "low", findings: [] }),
    makeAssessment({ moduleId: "guardian", score: 78, riskLevel: "low", findings: [] }),
  ];
}
