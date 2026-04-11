import type {
  ExpertAssessment,
  Verdict,
  Severity,
  Finding,
  CouncilDeliberation,
} from "@aegis/shared";

// ─── Thresholds ──────────────────────────────────────────────

/**
 * Minimum module score to avoid an automatic REJECT verdict (Pass 1).
 *
 * A score below 30 indicates that an expert module found severe, pervasive
 * issues — typically multiple critical findings or a combination of critical
 * and high-severity concerns. The value of 30 was chosen because:
 *
 *  - Scores are 0–100 where 100 = no findings. Each critical finding
 *    deducts ~25 points and each high ~15 points (see expert `deriveScore`).
 *  - A score of 30 therefore implies at least 2 critical findings or 1
 *    critical + several high — a level of risk that should never pass
 *    through to production without remediation.
 *  - This threshold interacts with Pass 2: if a module scores between 30
 *    and 59 it escapes REJECT but still triggers a REVIEW hold.
 */
const REJECT_SCORE_THRESHOLD = 30;

/**
 * Minimum module score to avoid an automatic REVIEW hold (Pass 2).
 *
 * Scores below 60 indicate moderate-to-significant findings that warrant
 * human inspection. The 60-point boundary was calibrated so that:
 *
 *  - A single high-severity finding (~15-point deduction) is usually not
 *    enough to breach the threshold on its own — the module needs a
 *    combination of findings to signal systemic concern.
 *  - The 30-point gap between REJECT (30) and REVIEW (60) creates a
 *    clear "remediation-required" band vs. a "needs-human-check" band.
 *
 * Note: the Δ≥30 disagreement threshold in synthesizer.ts (line 30) is
 * calibrated to this same 30-point spread — it flags meaningful divergence
 * between modules without over-triggering on minor scoring differences.
 */
const REVIEW_SCORE_THRESHOLD = 60;

/**
 * Number of modules that must independently report high-severity findings
 * before the council escalates to REVIEW (Pass 2).
 *
 * When 2 or more modules flag high-severity concerns, the council treats
 * this as cross-module corroboration of material risk — even if individual
 * module scores remain above 60. A threshold of 2 (out of 3 total modules)
 * ensures that isolated high findings from a single domain don't trigger
 * unnecessary holds while genuine cross-cutting risks are caught.
 */
const HIGH_FINDING_MODULE_THRESHOLD = 2;

/**
 * Minimum number of completed modules required to issue an APPROVE
 * verdict. A single module has no independent corroboration — council
 * safety requires at least two experts agreeing before the council will
 * sign off on an application.
 */
const MIN_MODULES_FOR_APPROVE = 2;

/** Confidence ceiling applied when coverage is below the floor. */
const COVERAGE_FLOOR_CONFIDENCE_CAP = 0.5;

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
      if (a.status === "failed" || b.status === "failed") continue;

      const scoreDelta = Math.abs(a.score - b.score);

      if (scoreDelta >= 30) {
        // Extract dominant concern from each module for context
        const aConcern = a.findings.length > 0
          ? a.findings.sort((x, y) => sevWeight(y.severity) - sevWeight(x.severity))[0].category
          : "overall risk";
        const bConcern = b.findings.length > 0
          ? b.findings.sort((x, y) => sevWeight(y.severity) - sevWeight(x.severity))[0].category
          : "overall risk";

        const stricter = a.score < b.score ? a : b;
        const lenient = a.score < b.score ? b : a;
        const stricterConcern = a.moduleName === stricter.moduleName ? aConcern : bConcern;
        const lenientConcern = a.moduleName === lenient.moduleName ? aConcern : bConcern;

        disagreements.push(
          `${stricter.moduleName} (score ${stricter.score}, top concern: ${stricterConcern}) ` +
          `assessed significantly higher risk than ${lenient.moduleName} (score ${lenient.score}, focused on ${lenientConcern}) — ` +
          `Δ${scoreDelta} points. Arbitration defers to the stricter assessment from ${stricter.moduleName} to maintain safety margins.`,
        );
      }

      // Check risk level disagreements even when scores are close
      const aRisk = sevWeight(a.riskLevel);
      const bRisk = sevWeight(b.riskLevel);
      if (Math.abs(aRisk - bRisk) >= 2 && scoreDelta < 30) {
        disagreements.push(
          `Risk-level conflict: ${a.moduleName} rated risk as "${a.riskLevel}" while ${b.moduleName} rated "${b.riskLevel}" — ` +
          `a qualitative divergence despite similar scores (${a.score} vs ${b.score}), ` +
          `indicating different threat model priorities.`,
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
 * The 5-pass arbitration pipeline runs in strict order. Each pass can only
 * escalate the verdict (APPROVE → REVIEW → REJECT), never de-escalate.
 * This guarantees a conservative, safety-first outcome.
 *
 * ### Pass 1 — REJECT scan
 * Checks every completed module for: (a) score below `REJECT_SCORE_THRESHOLD`
 * (30), or (b) any finding with severity "critical". Either condition forces
 * an immediate REJECT because the risk is too severe for human review alone.
 *
 * ### Pass 2 — REVIEW scan (skipped if already REJECT)
 * Checks for: (a) any module score below `REVIEW_SCORE_THRESHOLD` (60), or
 * (b) high-severity findings reported by ≥ `HIGH_FINDING_MODULE_THRESHOLD`
 * (2) modules. This pass also enforces a coverage floor — if fewer than
 * `MIN_MODULES_FOR_APPROVE` modules completed, APPROVE downgrades to REVIEW
 * because the council lacks independent corroboration.
 *
 * ### Pass 3 — Cross-reference
 * Detects findings that appear in the same risk category across 2+ modules.
 * Corroborated findings strengthen conviction in the verdict without
 * changing the verdict tier itself.
 *
 * ### Pass 4 — Disagreement resolution
 * Identifies module pairs whose scores diverge by ≥ 30 points (the same
 * Δ≥30 threshold documented in `synthesizer.ts` line 30). When modules
 * disagree, arbitration defers to the stricter assessment to maintain
 * safety margins. Three-way divergence triggers maximum caution.
 *
 * ### Pass 5 — Confidence calibration
 * Computes a 0.10–0.98 confidence score reflecting how much the council
 * trusts its own verdict. Factors: unanimity among modules, score standard
 * deviation, number of corroborations, disagreements, and failed modules.
 * Confidence measures conviction in the *verdict*, not application quality.
 *
 * @param assessments — One `ExpertAssessment` per module (sentinel, watchdog, guardian).
 * @returns `AlgorithmicResult` with verdict, confidence, human-readable reasoning,
 *          and a structured `CouncilDeliberation` record for audit trails.
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

  // Only completed modules feed the verdict scan — failed modules carry
  // a placeholder score of 0 from `failedAssessment()`, and letting them
  // trip Pass 1 would mean a single crashed expert drags the whole
  // council to REJECT regardless of the other experts' real findings.
  // Coverage loss from failed modules is accounted for separately in
  // Pass 5 (confidence penalty) and in the all-failed guard below.
  const completedAssessments = assessments.filter((a) => a.status === "completed");

  // No coverage at all — every module failed. Force REJECT because we
  // cannot approve an app we did not actually evaluate.
  if (completedAssessments.length === 0) {
    return {
      verdict: "REJECT",
      confidence: 0.1,
      reasoning:
        `Verdict: REJECT (10% confidence)\n\n` +
        `Arbitration aborted — no completed modules. All ${assessments.length} expert module(s) ` +
        `failed to produce an assessment, so the council has zero coverage and cannot approve ` +
        `the application.`,
      deliberation: {
        arbitrationProcess:
          `AEGIS Council Arbitration — aborted\n\n` +
          `No completed modules (${assessments.length} failed). Council defaults to REJECT ` +
          `because an un-evaluated application cannot be approved.`,
        crossReferences: [],
        disagreements: [],
        corroborations: [],
        confidenceFactors: [
          `No completed modules — zero coverage, verdict defaulted to REJECT.`,
        ],
      },
    };
  }

  // ── Pass 1: REJECT triggers ────────────────────────────────
  const rejectModules: string[] = [];
  const criticalModules: { name: string; findings: string[] }[] = [];

  for (const a of completedAssessments) {
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

    for (const a of completedAssessments) {
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

  // ── Coverage floor: APPROVE requires at least MIN_MODULES_FOR_APPROVE
  //    completed modules. A single surviving module has no independent
  //    corroboration, so we downgrade APPROVE → REVIEW. REJECT is *not*
  //    downgraded — the council always defers to the stricter assessment.
  const coverageFloorTriggered =
    verdict === "APPROVE" &&
    completedAssessments.length < MIN_MODULES_FOR_APPROVE;

  if (coverageFloorTriggered) {
    verdict = "REVIEW";
    reasons.push(
      `Coverage floor — only ${completedAssessments.length} of ${assessments.length} ` +
      `module(s) completed; APPROVE requires ≥${MIN_MODULES_FOR_APPROVE} for independent ` +
      `corroboration. Downgraded to REVIEW pending a rerun of the failed module(s).`,
    );
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

  // Three-way divergence: when all pairwise comparisons produce
  // disagreements, the threat landscape is genuinely uncertain.
  const arbitrationExtras: string[] = [];
  if (disagreements.length >= 3) {
    arbitrationExtras.push(
      `Pass 4 — Three-way divergence detected: all modules assessed risk differently, ` +
      `reflecting genuine uncertainty in the threat landscape. The council applies maximum ` +
      `caution by deferring to the strictest module assessment.`,
    );
  }

  // ── Pass 5: Confidence calibration ─────────────────────────
  // Confidence measures conviction in the VERDICT, not app quality.
  // A unanimous REJECT from all three modules is high-confidence REJECT;
  // a split decision (one REJECT vs two APPROVE) is low-confidence in
  // whatever verdict arbitration lands on.
  const completedModules = assessments.filter((a) => a.status === "completed");
  const failedModules = assessments.filter((a) => a.status === "failed");

  const avgScore =
    completedModules.length > 0
      ? completedModules.reduce((sum, a) => sum + a.score, 0) / completedModules.length
      : 0;

  // How many completed modules independently "vote" for the same verdict
  // the arbitration process landed on?
  const modulesAgreeingWithVerdict = completedModules.filter((a) => {
    if (verdict === "REJECT") {
      return a.score < REJECT_SCORE_THRESHOLD || hasCriticalFinding(a);
    }
    if (verdict === "REVIEW") {
      return a.score < REVIEW_SCORE_THRESHOLD || hasHighFindings(a);
    }
    // APPROVE: module must clear both thresholds AND have no critical/high
    return (
      a.score >= REVIEW_SCORE_THRESHOLD && !hasCriticalFinding(a) && !hasHighFindings(a)
    );
  }).length;

  // Base confidence from verdict unanimity — scaled so 3/3 → 0.90
  let confidence =
    completedModules.length > 0
      ? (modulesAgreeingWithVerdict / completedModules.length) * 0.9
      : 0;

  confidenceFactors.push(
    `Base: ${modulesAgreeingWithVerdict}/${completedModules.length} module(s) independently support ${verdict} — ` +
      `${Math.round(confidence * 100)}% baseline conviction`,
  );

  // Tight score agreement (low dispersion) boosts conviction
  const scoreStdDev = Math.sqrt(
    completedModules.reduce((sum, a) => sum + (a.score - avgScore) ** 2, 0) /
      Math.max(completedModules.length, 1),
  );

  if (scoreStdDev < 10 && completedModules.length >= 3 && modulesAgreeingWithVerdict >= 2) {
    confidence = Math.min(0.98, confidence + 0.05);
    confidenceFactors.push(
      `+5% confidence: modules converge tightly (σ=${scoreStdDev.toFixed(1)}) on ${verdict}`,
    );
  }

  // Corroborated findings across modules strengthen the verdict
  if (corroborations.length >= 1) {
    const boost = Math.min(0.05, 0.02 * corroborations.length);
    confidence = Math.min(0.98, confidence + boost);
    confidenceFactors.push(
      `+${Math.round(boost * 100)}% confidence: ${corroborations.length} finding(s) independently corroborated across modules`,
    );
  }

  // Material score disagreements (Δ≥30) lower conviction
  if (disagreements.length > 0) {
    const penalty = 0.1 * disagreements.length;
    confidence = Math.max(0.1, confidence - penalty);
    confidenceFactors.push(
      `-${Math.round(penalty * 100)}% confidence: ${disagreements.length} disagreement(s) between modules`,
    );
  }

  // Failed modules reduce coverage, so reduce confidence in whatever
  // verdict survives.
  if (failedModules.length > 0) {
    const penalty = 0.15 * failedModules.length;
    confidence = Math.max(0.1, confidence - penalty);
    confidenceFactors.push(
      `-${Math.round(penalty * 100)}% confidence: ${failedModules.length} module(s) failed to complete — reduced coverage`,
    );
  }

  // Coverage-floor cap: when the council had to downgrade APPROVE → REVIEW
  // due to insufficient coverage, cap conviction at the coverage-floor
  // ceiling regardless of how convinced the single surviving module was.
  // Always emit the coverage factor when the floor triggers so the
  // arbitration log explains the cap even if numeric confidence already
  // sits below the ceiling (e.g., the sole completed module no longer
  // "agrees" with the post-downgrade REVIEW verdict).
  if (coverageFloorTriggered) {
    if (confidence > COVERAGE_FLOOR_CONFIDENCE_CAP) {
      confidence = COVERAGE_FLOOR_CONFIDENCE_CAP;
    }
    confidenceFactors.push(
      `Capped at ${Math.round(COVERAGE_FLOOR_CONFIDENCE_CAP * 100)}%: insufficient coverage — ` +
      `${completedAssessments.length}/${assessments.length} module(s) completed, below the ` +
      `${MIN_MODULES_FOR_APPROVE}-module minimum for high-confidence verdicts`,
    );
  }

  confidence = Math.round(Math.max(0.1, Math.min(0.98, confidence)) * 100) / 100;

  confidenceFactors.push(
    `Average module score across ${completedModules.length} completed module(s): ${avgScore.toFixed(0)}/100 ` +
      `(reported for context — not directly used in confidence calibration)`,
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
    ...arbitrationExtras,
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
