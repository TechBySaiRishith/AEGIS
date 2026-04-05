import type {
  ExpertAssessment,
  Verdict,
  Severity,
} from "@aegis/shared";

// ─── Thresholds ──────────────────────────────────────────────
const REJECT_SCORE_THRESHOLD = 30;
const REVIEW_SCORE_THRESHOLD = 60;
const HIGH_FINDING_MODULE_THRESHOLD = 2; // high findings across N+ modules → REVIEW

// ─── Helpers ─────────────────────────────────────────────────

function hasCriticalFinding(assessment: ExpertAssessment): boolean {
  return assessment.findings.some((f) => f.severity === "critical");
}

function hasHighFindings(assessment: ExpertAssessment): boolean {
  return assessment.findings.some((f) => f.severity === "high");
}

function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

// ─── Algorithmic Verdict ─────────────────────────────────────

export interface AlgorithmicResult {
  verdict: Verdict;
  confidence: number;
  reasoning: string;
}

/**
 * Compute a deterministic verdict from expert assessments — NO LLM required.
 *
 * Rules:
 *  1. REJECT  — any module score < 30 OR any critical finding
 *  2. REVIEW  — any module score < 60 OR high findings across 2+ modules
 *  3. APPROVE — otherwise
 *
 * Confidence = mean(module scores) / 100
 */
export function computeAlgorithmicVerdict(
  assessments: ExpertAssessment[],
): AlgorithmicResult {
  if (assessments.length === 0) {
    return {
      verdict: "REJECT",
      confidence: 0,
      reasoning: "No expert assessments provided — cannot approve.",
    };
  }

  const reasons: string[] = [];
  let verdict: Verdict = "APPROVE";

  // ── Pass 1: check for REJECT triggers ──────────────────────
  const rejectModules: string[] = [];
  const criticalModules: string[] = [];

  for (const a of assessments) {
    if (a.score < REJECT_SCORE_THRESHOLD) {
      rejectModules.push(a.moduleName);
    }
    if (hasCriticalFinding(a)) {
      criticalModules.push(a.moduleName);
    }
  }

  if (rejectModules.length > 0 || criticalModules.length > 0) {
    verdict = "REJECT";
    if (rejectModules.length > 0) {
      reasons.push(
        `Score below ${REJECT_SCORE_THRESHOLD}: ${rejectModules.join(", ")}`,
      );
    }
    if (criticalModules.length > 0) {
      reasons.push(
        `Critical findings detected in: ${criticalModules.join(", ")}`,
      );
    }
  }

  // ── Pass 2: check for REVIEW triggers (only if not already REJECT) ──
  if (verdict !== "REJECT") {
    const reviewScoreModules: string[] = [];
    let modulesWithHighFindings = 0;

    for (const a of assessments) {
      if (a.score < REVIEW_SCORE_THRESHOLD) {
        reviewScoreModules.push(a.moduleName);
      }
      if (hasHighFindings(a)) {
        modulesWithHighFindings++;
      }
    }

    if (
      reviewScoreModules.length > 0 ||
      modulesWithHighFindings >= HIGH_FINDING_MODULE_THRESHOLD
    ) {
      verdict = "REVIEW";
      if (reviewScoreModules.length > 0) {
        reasons.push(
          `Score below ${REVIEW_SCORE_THRESHOLD}: ${reviewScoreModules.join(", ")}`,
        );
      }
      if (modulesWithHighFindings >= HIGH_FINDING_MODULE_THRESHOLD) {
        reasons.push(
          `High-severity findings present in ${modulesWithHighFindings} modules`,
        );
      }
    }
  }

  // ── Build reasoning ────────────────────────────────────────
  if (verdict === "APPROVE") {
    reasons.push("All modules passed with acceptable scores and no critical/high-risk concerns");
  }

  const scoreBreakdown = assessments
    .map((a) => `${a.moduleName} (${a.framework}): ${a.score}/100 [${severityLabel(a.riskLevel)}]`)
    .join("; ");

  const reasoning = [
    `Verdict: ${verdict}`,
    `Module scores — ${scoreBreakdown}`,
    ...reasons.map((r) => `• ${r}`),
  ].join("\n");

  // ── Confidence ─────────────────────────────────────────────
  const avgScore =
    assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length;
  const confidence = Math.round((avgScore / 100) * 100) / 100; // two decimal places

  return { verdict, confidence, reasoning };
}
