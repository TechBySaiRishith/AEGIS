import type {
  ExpertAssessment,
  Verdict,
  Severity,
  Finding,
  CouncilDeliberation,
} from "@aegis/shared";

// ─── Thresholds ──────────────────────────────────────────────
const REJECT_SCORE_THRESHOLD = 30;
const REVIEW_SCORE_THRESHOLD = 60;
const HIGH_FINDING_MODULE_THRESHOLD = 2;

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

function countBySeverity(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

/**
 * Detect cross-module corroborations: findings that appear in 2+ modules
 * for the same category or overlapping keywords.
 */
function detectCorroborations(assessments: ExpertAssessment[]): string[] {
  const corroborations: string[] = [];
  const categoryMap = new Map<string, { module: string; finding: Finding }[]>();

  for (const a of assessments) {
    for (const f of a.findings) {
      const key = f.category.toLowerCase().trim();
      if (!categoryMap.has(key)) categoryMap.set(key, []);
      categoryMap.get(key)!.push({ module: a.moduleName, finding: f });
    }
  }

  for (const [category, entries] of categoryMap) {
    const modules = [...new Set(entries.map((e) => e.module))];
    if (modules.length >= 2) {
      const findingRefs = entries.map((e) => `${e.module}/${e.finding.id}`).join(", ");
      const maxSev = entries.reduce(
        (max, e) => (sevWeight(e.finding.severity) > sevWeight(max) ? e.finding.severity : max),
        "info" as Severity,
      );
      corroborations.push(
        `"${category}" flagged by ${modules.join(" and ")} (${findingRefs}) — ` +
        `corroborated at ${maxSev} severity, strengthening confidence in this risk area`,
      );
    }
  }

  return corroborations;
}

function sevWeight(sev: Severity): number {
  const w: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  return w[sev] ?? 0;
}

/**
 * Detect explicit disagreements: modules where risk conclusions diverge.
 * E.g., one says low risk while another says high/critical on overlapping areas.
 */
function detectDisagreements(assessments: ExpertAssessment[]): string[] {
  const disagreements: string[] = [];

  for (let i = 0; i < assessments.length; i++) {
    for (let j = i + 1; j < assessments.length; j++) {
      const a = assessments[i];
      const b = assessments[j];
      const scoreDiff = Math.abs(a.score - b.score);

      if (scoreDiff >= 30) {
        const higher = a.score >= b.score ? a : b;
        const lower = a.score >= b.score ? b : a;
        disagreements.push(
          `${higher.moduleName} scored ${higher.score}/100 (${higher.riskLevel} risk) ` +
          `while ${lower.moduleName} scored ${lower.score}/100 (${lower.riskLevel} risk) — ` +
          `Δ${scoreDiff} point divergence. Arbitration defers to the stricter assessment ` +
          `from ${lower.moduleName} to maintain safety margins.`,
        );
      }

      // Check risk level disagreements even when scores are close
      const riskA = sevWeight(a.riskLevel);
      const riskB = sevWeight(b.riskLevel);
      if (Math.abs(riskA - riskB) >= 2 && scoreDiff < 30) {
        const stricter = riskA > riskB ? a : b;
        const lenient = riskA > riskB ? b : a;
        disagreements.push(
          `Risk-level conflict: ${stricter.moduleName} rates ${stricter.riskLevel} risk ` +
          `while ${lenient.moduleName} rates ${lenient.riskLevel} risk on the same application. ` +
          `Council defers to ${stricter.moduleName}'s stricter assessment.`,
        );
      }
    }
  }

  return disagreements;
}

// ─── Algorithmic Verdict ─────────────────────────────────────

export interface AlgorithmicResult {
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  deliberation: CouncilDeliberation;
}

/**
 * Compute a deterministic verdict from expert assessments through an
 * explicit multi-pass arbitration process — NO LLM required.
 *
 * Arbitration passes:
 *  Pass 1 — REJECT triggers: any module score < 30 OR any critical finding
 *  Pass 2 — REVIEW triggers: any score < 60 OR high findings in 2+ modules
 *  Pass 3 — Cross-reference: corroborate findings across modules
 *  Pass 4 — Disagreement resolution: defer to stricter assessments
 *  Pass 5 — Confidence calibration: adjust based on agreement/coverage
 */
export function computeAlgorithmicVerdict(
  assessments: ExpertAssessment[],
): AlgorithmicResult {
  if (assessments.length === 0) {
    return {
      verdict: "REJECT",
      confidence: 0,
      reasoning: "No expert assessments provided — cannot approve.",
      deliberation: {
        arbitrationProcess: "Aborted: no assessments to evaluate.",
        crossReferences: [],
        disagreements: [],
        corroborations: [],
        confidenceFactors: ["No modules completed — zero confidence."],
      },
    };
  }

  const reasons: string[] = [];
  const confidenceFactors: string[] = [];
  let verdict: Verdict = "APPROVE";

  // ── Pass 1: REJECT triggers ────────────────────────────────
  const rejectModules: string[] = [];
  const criticalModules: { name: string; findings: string[] }[] = [];

  for (const a of assessments) {
    if (a.score < REJECT_SCORE_THRESHOLD) {
      rejectModules.push(`${a.moduleName} (${a.score}/100)`);
    }
    const criticals = a.findings.filter((f) => f.severity === "critical");
    if (criticals.length > 0) {
      criticalModules.push({
        name: a.moduleName,
        findings: criticals.map((f) => `[${f.id}] ${f.title}`),
      });
    }
  }

  if (rejectModules.length > 0 || criticalModules.length > 0) {
    verdict = "REJECT";
    if (rejectModules.length > 0) {
      reasons.push(
        `REJECT trigger — score below ${REJECT_SCORE_THRESHOLD}: ${rejectModules.join(", ")}`,
      );
    }
    for (const cm of criticalModules) {
      reasons.push(
        `REJECT trigger — critical findings in ${cm.name}: ${cm.findings.join("; ")}`,
      );
    }
  }

  // ── Pass 2: REVIEW triggers (only if not already REJECT) ───
  if (verdict !== "REJECT") {
    const reviewScoreModules: string[] = [];
    let modulesWithHighFindings = 0;
    const highDetails: string[] = [];

    for (const a of assessments) {
      if (a.score < REVIEW_SCORE_THRESHOLD) {
        reviewScoreModules.push(`${a.moduleName} (${a.score}/100)`);
      }
      const highs = a.findings.filter((f) => f.severity === "high");
      if (highs.length > 0) {
        modulesWithHighFindings++;
        highDetails.push(
          `${a.moduleName}: ${highs.map((f) => `[${f.id}] ${f.title}`).join(", ")}`,
        );
      }
    }

    if (
      reviewScoreModules.length > 0 ||
      modulesWithHighFindings >= HIGH_FINDING_MODULE_THRESHOLD
    ) {
      verdict = "REVIEW";
      if (reviewScoreModules.length > 0) {
        reasons.push(
          `REVIEW trigger — score below ${REVIEW_SCORE_THRESHOLD}: ${reviewScoreModules.join(", ")}`,
        );
      }
      if (modulesWithHighFindings >= HIGH_FINDING_MODULE_THRESHOLD) {
        reasons.push(
          `REVIEW trigger — high-severity findings across ${modulesWithHighFindings} modules: ${highDetails.join("; ")}`,
        );
      }
    }
  }

  if (verdict === "APPROVE") {
    reasons.push("All modules passed with acceptable scores and no critical/high-risk concerns across the board");
  }

  // ── Pass 3: Cross-reference findings ───────────────────────
  const corroborations = detectCorroborations(assessments);
  const crossReferences: string[] = [];

  // Build cross-reference citations from all findings
  const allFindings = assessments.flatMap((a) =>
    a.findings.map((f) => ({ module: a.moduleName, finding: f })),
  );
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const { finding } of allFindings) {
    sevCounts[finding.severity]++;
  }

  crossReferences.push(
    `Cross-module finding totals: ${sevCounts.critical} critical, ${sevCounts.high} high, ` +
    `${sevCounts.medium} medium, ${sevCounts.low} low, ${sevCounts.info} informational ` +
    `across ${assessments.length} expert modules`,
  );

  if (corroborations.length > 0) {
    crossReferences.push(
      `${corroborations.length} risk area(s) independently confirmed by multiple modules — ` +
      `corroboration strengthens the verdict`,
    );
  }

  // ── Pass 4: Disagreement resolution ────────────────────────
  const disagreements = detectDisagreements(assessments);

  // ── Pass 5: Confidence calibration ─────────────────────────
  const completedModules = assessments.filter((a) => a.status === "completed");
  const failedModules = assessments.filter((a) => a.status === "failed");

  const avgScore =
    completedModules.length > 0
      ? completedModules.reduce((sum, a) => sum + a.score, 0) / completedModules.length
      : 0;

  let confidence = Math.round((avgScore / 100) * 100) / 100;

  // Boost confidence when modules agree
  const scoreStdDev = Math.sqrt(
    completedModules.reduce((sum, a) => sum + (a.score - avgScore) ** 2, 0) /
      Math.max(completedModules.length, 1),
  );

  if (scoreStdDev < 10 && completedModules.length >= 3) {
    confidence = Math.min(1, confidence + 0.05);
    confidenceFactors.push(
      `+5% confidence: all ${completedModules.length} modules agree (σ=${scoreStdDev.toFixed(1)})`,
    );
  }

  // Boost for corroboration
  if (corroborations.length >= 2) {
    confidence = Math.min(1, confidence + 0.05);
    confidenceFactors.push(
      `+5% confidence: ${corroborations.length} corroborated findings across modules`,
    );
  }

  // Penalize for disagreements
  if (disagreements.length > 0) {
    confidence = Math.max(0.1, confidence - 0.1 * disagreements.length);
    confidenceFactors.push(
      `-${10 * disagreements.length}% confidence: ${disagreements.length} disagreement(s) between modules`,
    );
  }

  // Penalize for failed modules
  if (failedModules.length > 0) {
    confidence = Math.max(0.1, confidence - 0.15 * failedModules.length);
    confidenceFactors.push(
      `-${15 * failedModules.length}% confidence: ${failedModules.length} module(s) failed to complete`,
    );
  }

  // Ensure confidence is in valid range
  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;

  confidenceFactors.push(
    `Base score: ${avgScore.toFixed(0)}/100 average across ${completedModules.length} module(s)`,
  );

  // ── Build structured reasoning ─────────────────────────────
  const scoreBreakdown = assessments
    .map((a) => {
      const counts = countBySeverity(a.findings);
      const findingSummary = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${s}`)
        .join(", ") || "no findings";
      return `  ${a.moduleName} (${a.framework}): ${a.score}/100 [${severityLabel(a.riskLevel)} risk] — ${findingSummary}`;
    })
    .join("\n");

  const arbitrationProcess = [
    `AEGIS Council Arbitration — 5-pass deterministic process`,
    ``,
    `Pass 1 — REJECT scan: ${criticalModules.length > 0 || rejectModules.length > 0 ? "TRIGGERED" : "clear"} ` +
    `(checked for scores <${REJECT_SCORE_THRESHOLD} and critical findings)`,
    `Pass 2 — REVIEW scan: ${verdict === "REVIEW" ? "TRIGGERED" : verdict === "REJECT" ? "superseded by REJECT" : "clear"} ` +
    `(checked for scores <${REVIEW_SCORE_THRESHOLD} and high findings in ≥${HIGH_FINDING_MODULE_THRESHOLD} modules)`,
    `Pass 3 — Cross-reference: ${corroborations.length} corroborated finding(s), ` +
    `${allFindings.length} total finding(s) across ${assessments.length} modules`,
    `Pass 4 — Disagreement resolution: ${disagreements.length} disagreement(s) detected`,
    `Pass 5 — Confidence calibration: ${(confidence * 100).toFixed(0)}% ` +
    `(base ${avgScore.toFixed(0)}% ± adjustments)`,
    ``,
    `Final verdict: ${verdict} at ${(confidence * 100).toFixed(0)}% confidence`,
  ].join("\n");

  const reasoning = [
    `Verdict: ${verdict} (${(confidence * 100).toFixed(0)}% confidence)`,
    ``,
    `Module Scores:`,
    scoreBreakdown,
    ``,
    `Arbitration Triggers:`,
    ...reasons.map((r) => `  • ${r}`),
    ...(corroborations.length > 0
      ? [``, `Cross-Module Corroboration:`, ...corroborations.map((c) => `  ✓ ${c}`)]
      : []),
    ...(disagreements.length > 0
      ? [``, `Disagreement Resolution:`, ...disagreements.map((d) => `  ⚠ ${d}`)]
      : []),
    ``,
    `Confidence Factors:`,
    ...confidenceFactors.map((f) => `  • ${f}`),
  ].join("\n");

  return {
    verdict,
    confidence,
    reasoning,
    deliberation: {
      arbitrationProcess,
      crossReferences,
      disagreements,
      corroborations,
      confidenceFactors,
    },
  };
}
