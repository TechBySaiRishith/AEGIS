import { nanoid } from "nanoid";
import type {
  EvaluationReport,
  ExpertAssessment,
  ExpertModuleId,
  Finding,
  ModuleReportSection,
  Severity,
  CouncilVerdict,
  RiskSummaryEntry,
  ActionableRecommendation,
  CouncilDeliberation,
  Verdict,
} from "@aegis/shared";

// ─── Module display names ──────────────────────────────────

const MODULE_LABELS: Record<ExpertModuleId, { name: string; focus: string }> = {
  sentinel: { name: "Sentinel", focus: "Code & Security" },
  watchdog: { name: "Watchdog", focus: "LLM Safety" },
  guardian: { name: "Guardian", focus: "Governance" },
};

// ─── Severity ordering (for sorting findings) ──────────────

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ─── Helpers ───────────────────────────────────────────────

function countBySeverity(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

function topSeverityLabel(findings: Finding[]): string {
  if (findings.length === 0) return "no issues";

  const counts = countBySeverity(findings);
  const parts: string[] = [];

  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    if (counts[sev]) {
      parts.push(`${counts[sev]} ${sev}`);
    }
  }

  return parts.join(", ");
}

/** Extract application-specific details from the profile and assessments. */
function extractAppContext(
  appName: string,
  appDescription: string,
  framework: string,
  assessments: ExpertAssessment[],
): {
  techStack: string;
  aiModels: string[];
  securityGaps: string[];
  dataPatterns: string[];
} {
  const techStack = framework || "unknown framework";
  const aiModels: string[] = [];
  const securityGaps: string[] = [];
  const dataPatterns: string[] = [];

  for (const a of assessments) {
    for (const f of a.findings) {
      // Extract AI model references from findings
      const modelMatches = f.description.match(/\b(gpt-[34][a-z0-9.-]*|claude[a-z0-9.-]*|whisper[a-z0-9.-]*|dall-e[a-z0-9.-]*|gemini[a-z0-9.-]*)\b/gi);
      if (modelMatches) aiModels.push(...modelMatches);

      // Extract security-relevant patterns
      if (f.category.toLowerCase().includes("auth") || f.description.toLowerCase().includes("authentication")) {
        securityGaps.push(f.title);
      }
      if (f.category.toLowerCase().includes("upload") || f.description.toLowerCase().includes("file upload")) {
        dataPatterns.push(f.title);
      }
    }

    // Also scan summaries for technology references
    const summaryModelMatches = a.summary.match(/\b(gpt-[34][a-z0-9.-]*|claude[a-z0-9.-]*|whisper[a-z0-9.-]*|Flask|Django|Express|FastAPI|Next\.js)\b/gi);
    if (summaryModelMatches) {
      for (const m of summaryModelMatches) {
        if (!aiModels.includes(m) && !["Flask", "Django", "Express", "FastAPI", "Next.js"].includes(m)) {
          aiModels.push(m);
        }
      }
    }
  }

  return {
    techStack,
    aiModels: [...new Set(aiModels)],
    securityGaps: [...new Set(securityGaps)],
    dataPatterns: [...new Set(dataPatterns)],
  };
}

function verdictParagraph(
  verdict: string,
  appName: string,
  appContext: ReturnType<typeof extractAppContext>,
): string {
  const techDesc = appContext.techStack !== "unknown framework"
    ? `a ${appContext.techStack} application${appContext.aiModels.length > 0 ? ` integrating ${appContext.aiModels.join(", ")}` : ""}`
    : "this application";

  switch (verdict) {
    case "APPROVE":
      return (
        `Based on the combined analysis, ${appName} (${techDesc}) meets the safety thresholds ` +
        `required for deployment. No critical or high-severity issues were identified that would block release. ` +
        `The Council recommends approval, though any medium-severity findings should be addressed in subsequent iterations.`
      );
    case "REVIEW":
      return (
        `The evaluation identified concerns in ${appName} (${techDesc}) that require manual review ` +
        `before deployment can proceed. ` +
        (appContext.securityGaps.length > 0
          ? `Notable security gaps include: ${appContext.securityGaps.slice(0, 3).join(", ")}. `
          : "") +
        `The safety team should inspect high-severity findings and confirm that mitigations are in place ` +
        `before a final determination is made.`
      );
    case "REJECT":
      return (
        `The evaluation identified critical safety concerns in ${appName} (${techDesc}) ` +
        `that preclude deployment in its current state. ` +
        (appContext.securityGaps.length > 0
          ? `Key areas of concern: ${appContext.securityGaps.slice(0, 3).join(", ")}. `
          : "") +
        `The application must undergo remediation addressing the critical and high-severity findings ` +
        `documented below, then be re-evaluated before it can be considered for approval.`
      );
    default:
      return `The evaluation completed with verdict: ${verdict}.`;
  }
}

// ─── Build per-module section ──────────────────────────────

function buildModuleSection(assessment: ExpertAssessment): ModuleReportSection {
  return {
    moduleName: assessment.moduleName,
    framework: assessment.framework,
    score: assessment.score,
    riskLevel: assessment.riskLevel,
    summary: assessment.summary,
    findings: [...assessment.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    ),
    recommendation: assessment.recommendation,
  };
}

// ─── Build risk summary table ──────────────────────────────

function buildRiskSummary(assessments: ExpertAssessment[]): RiskSummaryEntry[] {
  return assessments.map((a) => {
    const counts = countBySeverity(a.findings);
    const sortedFindings = [...a.findings].sort(
      (x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity],
    );
    return {
      module: a.moduleId,
      moduleName: a.moduleName,
      score: a.score,
      riskLevel: a.riskLevel,
      criticalCount: counts["critical"] ?? 0,
      highCount: counts["high"] ?? 0,
      mediumCount: counts["medium"] ?? 0,
      lowCount: counts["low"] ?? 0,
      infoCount: counts["info"] ?? 0,
      topFinding: sortedFindings.length > 0 ? sortedFindings[0].title : null,
    };
  });
}

// ─── Build actionable recommendations ──────────────────────

function buildRecommendations(
  assessments: ExpertAssessment[],
  appContext: ReturnType<typeof extractAppContext>,
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  for (const a of assessments) {
    const criticals = a.findings.filter((f) => f.severity === "critical");
    const highs = a.findings.filter((f) => f.severity === "high");
    const mediums = a.findings.filter((f) => f.severity === "medium");

    // Critical findings → immediate action
    for (const f of criticals) {
      recommendations.push({
        priority: "immediate",
        title: f.title,
        description: f.remediation
          ? `${f.description} Recommended fix: ${f.remediation}`
          : f.description,
        relatedFindings: [f.id],
        module: a.moduleId,
      });
    }

    // High findings → short-term action
    for (const f of highs) {
      recommendations.push({
        priority: "short-term",
        title: f.title,
        description: f.remediation
          ? `${f.description} Recommended fix: ${f.remediation}`
          : f.description,
        relatedFindings: [f.id],
        module: a.moduleId,
      });
    }

    // Group medium findings as long-term
    if (mediums.length > 0) {
      recommendations.push({
        priority: "long-term",
        title: `Address ${mediums.length} medium-severity finding(s) from ${a.moduleName}`,
        description: mediums.map((f) => `[${f.id}] ${f.title}`).join("; "),
        relatedFindings: mediums.map((f) => f.id),
        module: a.moduleId,
      });
    }
  }

  // Sort: immediate first, then short-term, then long-term
  const priorityOrder = { immediate: 0, "short-term": 1, "long-term": 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}

// ─── Build executive summary ───────────────────────────────

/**
 * Build the executive summary narrative. Exported for unit testing.
 *
 * NOTE: previously this joined `lines` directly and produced runs of empty
 * strings (doubled blank lines in the rendered output). We now collapse
 * consecutive empty strings before joining.
 */
export function buildExecutiveSummary(
  appName: string,
  appDescription: string,
  framework: string,
  verdict: Verdict,
  assessments: ExpertAssessment[],
  council: CouncilVerdict,
): string {
  const appContext = extractAppContext(appName, appDescription, framework, assessments);
  const lines: string[] = [];

  // Opening paragraph — vary by verdict to avoid template feel
  const techDesc = appContext.techStack !== "unknown framework"
    ? `a ${appContext.techStack} application`
    : "a software application";
  const aiDesc = appContext.aiModels.length > 0
    ? ` integrating ${appContext.aiModels.join(", ")}`
    : "";

  if (verdict === "REJECT") {
    lines.push(
      `AEGIS has identified critical concerns in "${appName}"${aiDesc ? `, ${techDesc}${aiDesc}` : ""}. ` +
      `The three-module expert council — Sentinel (code security), Watchdog (LLM safety), ` +
      `and Guardian (governance) — converged on a REJECT recommendation after independent analysis.`,
    );
  } else if (verdict === "REVIEW") {
    lines.push(
      `"${appName}"${aiDesc ? `, ${techDesc}${aiDesc},` : ""} requires further review before deployment. ` +
      `AEGIS's expert council identified areas of concern that do not rise to automatic rejection ` +
      `but warrant human evaluation before proceeding.`,
    );
  } else {
    lines.push(
      `AEGIS analysis of "${appName}"${aiDesc ? `, ${techDesc}${aiDesc},` : ""} found no blocking concerns ` +
      `across security, LLM safety, and governance dimensions. The expert council recommends approval ` +
      `with the noted observations.`,
    );
  }
  if (appDescription) {
    lines.push(appDescription);
  }

  lines.push("");

  // Verdict paragraph — application-specific
  lines.push(verdictParagraph(verdict, appName, appContext));

  lines.push("");

  // Per-module breakdown with finding citations
  for (const id of ["sentinel", "watchdog", "guardian"] as ExpertModuleId[]) {
    const a = assessments.find((x) => x.moduleId === id);
    if (!a) continue;

    const label = MODULE_LABELS[id];
    if (a.status === "failed") {
      lines.push(
        `• ${label.name} (${label.focus}) failed to complete its analysis${a.error ? `: ${a.error}` : "."}`,
      );
    } else {
      const findingsSummary =
        a.findings.length > 0
          ? `identifying ${a.findings.length} finding(s) (${topSeverityLabel(a.findings)})`
          : "identifying no findings";
      const topFinding = a.findings.length > 0
        ? `. Top concern: "${a.findings.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity])[0].title}"`
        : "";

      // Vary language by module score to avoid mechanical repetition
      let riskPhrase: string;
      if (a.score < 30) {
        riskPhrase = `flagged critical deficiencies, scoring ${a.score}/100 and`;
      } else if (a.score < 60) {
        riskPhrase = `identified material risks, scoring ${a.score}/100 and`;
      } else if (a.score <= 85) {
        riskPhrase = `noted areas for improvement, scoring ${a.score}/100 and`;
      } else {
        riskPhrase = `found the application largely compliant, scoring ${a.score}/100 and`;
      }

      lines.push(
        `• ${label.name} (${label.focus}) ${riskPhrase} ${findingsSummary}${topFinding}.`,
      );
    }
  }

  // Disagreements
  const conflicts = council.critiques.filter((c) => c.type === "conflict");
  if (conflicts.length > 0) {
    lines.push("");
    const details = conflicts.map((c) => c.description).join(" ");
    lines.push(`The Council noted ${conflicts.length} disagreement(s) between modules: ${details}`);
  }

  // Corroborations
  const agreements = council.critiques.filter((c) => c.type === "agreement");
  if (agreements.length > 0) {
    lines.push("");
    lines.push(
      `${agreements.length} area(s) of agreement were identified across modules, ` +
      `strengthening confidence in the assessment.`,
    );
  }

  // Technology-specific insight
  if (appContext.aiModels.length > 0 || appContext.techStack !== "unknown framework") {
    lines.push("");
    const techInsight = appContext.aiModels.length > 0
      ? `Given the application's use of ${appContext.aiModels.join(" and ")}, particular attention was paid to model integration boundaries and data flow integrity.`
      : `The ${appContext.techStack} architecture was evaluated for framework-specific vulnerabilities and configuration risks.`;
    lines.push(techInsight);
  }

  // Derive primary concern from lowest-scoring completed module
  const completedAssessments = assessments.filter((a) => a.status === "completed");
  const lowestModule = completedAssessments.length > 0
    ? completedAssessments.reduce((min, a) => a.score < min.score ? a : min)
    : null;
  const topFindingObj = lowestModule && lowestModule.findings.length > 0
    ? lowestModule.findings.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity])[0]
    : null;
  const primaryConcern = topFindingObj
    ? `${topFindingObj.title} (${topFindingObj.category})`
    : "the identified risk areas";

  // Overall recommendation
  lines.push("");
  const verdictDetail = verdict === "REJECT"
    ? `driven primarily by ${primaryConcern}`
    : verdict === "REVIEW"
      ? `recommending focused review of ${primaryConcern}`
      : "acknowledging minor improvements needed";
  lines.push(
    `The council reached a ${verdict} determination with ${(council.confidence * 100).toFixed(0)}% confidence, ${verdictDetail}.`,
  );

  // Collapse any runs of empty strings so we never emit doubled blank lines.
  // Uses an imperative reduce to stay O(n) — do NOT replace with spread.
  const deduped = lines.reduce<string[]>((acc, line) => {
    if (line === "" && acc[acc.length - 1] === "") return acc;
    acc.push(line);
    return acc;
  }, []);
  return deduped.join("\n").trim();
}

// ─── Build plain-language stakeholder summary ──────────────

/**
 * Build a jargon-free "what this means" summary aimed at non-technical
 * stakeholders. Avoids references to CWE / OWASP / NIST frameworks and
 * instead explains the verdict in everyday language plus a concrete next
 * step. Exported for unit testing.
 */
export function buildPlainLanguageSummary(
  applicationName: string,
  verdict: Verdict,
  assessments: ExpertAssessment[],
): string {
  const headline =
    verdict === "APPROVE"
      ? `${applicationName} passed all three independent safety reviews.`
      : verdict === "REVIEW"
        ? `${applicationName} has safety concerns that need review before deployment.`
        : `${applicationName} has serious safety problems and should not be deployed as-is.`;

  const criticalCount = assessments.reduce(
    (acc, a) => acc + a.findings.filter((f) => f.severity === "critical").length,
    0,
  );

  const whatItMeans =
    verdict === "APPROVE"
      ? "Our three expert reviewers — one for security, one for AI-specific risks, and one for governance — each examined the application independently and all agreed it meets baseline standards. This does not guarantee the system is perfectly safe, but no show-stopping issues were found."
      : verdict === "REVIEW"
        ? "Our three expert reviewers found issues that need human judgment before this application is used in production. These are not necessarily show-stoppers, but a qualified engineer should look at them."
        : `Our three expert reviewers found ${criticalCount} critical problem${criticalCount === 1 ? "" : "s"}. These are the kind of issues that could lead to data leaks, users being harmed, or legal exposure. The application should be fixed before any real-world use.`;

  const nextStep =
    verdict === "APPROVE"
      ? "Next step: proceed with normal deployment processes."
      : verdict === "REVIEW"
        ? "Next step: have a qualified engineer review the flagged items and decide whether each one blocks deployment."
        : "Next step: fix the critical findings, then re-run AEGIS. Do not deploy in the meantime.";

  return [headline, "", whatItMeans, "", nextStep].join("\n");
}

// ─── Build council analysis narrative ──────────────────────

function buildCouncilAnalysis(council: CouncilVerdict): string {
  const sections: string[] = [];

  sections.push("Council Synthesis — Arbitration Report");
  sections.push("═".repeat(50));
  sections.push("");
  sections.push(`Final Verdict: ${council.verdict}`);
  sections.push(`Confidence: ${(council.confidence * 100).toFixed(0)}%`);
  sections.push(`Algorithmic Verdict: ${council.algorithmicVerdict}`);
  sections.push(`LLM Enhanced: ${council.llmEnhanced ? "Yes" : "No"}`);
  sections.push("");

  // Arbitration process
  if (council.deliberation?.arbitrationProcess) {
    sections.push("─── Arbitration Process ───");
    sections.push(council.deliberation.arbitrationProcess);
    sections.push("");
  }

  // Reasoning
  sections.push("─── Detailed Reasoning ───");
  sections.push(council.reasoning);

  // Cross-module observations
  if (council.critiques.length > 0) {
    sections.push("");
    sections.push("─── Cross-Module Observations ───");
    for (const c of council.critiques) {
      const typeLabel =
        c.type === "conflict"
          ? "⚠ DISAGREEMENT"
          : c.type === "agreement"
            ? "✓ CORROBORATION"
            : "+ GAP IDENTIFIED";
      sections.push(`  ${typeLabel} (${c.fromModule} ↔ ${c.aboutModule}):`);
      sections.push(`    ${c.description}`);
    }
  }

  // Confidence factors
  if (council.deliberation?.confidenceFactors && council.deliberation.confidenceFactors.length > 0) {
    sections.push("");
    sections.push("─── Confidence Calibration ───");
    for (const f of council.deliberation.confidenceFactors) {
      sections.push(`  • ${f}`);
    }
  }

  // Corroborations detail
  if (council.deliberation?.corroborations && council.deliberation.corroborations.length > 0) {
    sections.push("");
    sections.push("─── Cross-Module Corroborations ───");
    for (const c of council.deliberation.corroborations) {
      sections.push(`  ✓ ${c}`);
    }
  }

  // Disagreements detail
  if (council.deliberation?.disagreements && council.deliberation.disagreements.length > 0) {
    sections.push("");
    sections.push("─── Disagreement Resolution ───");
    for (const d of council.deliberation.disagreements) {
      sections.push(`  ⚠ ${d}`);
    }
  }

  if (council.llmEnhanced) {
    sections.push("");
    sections.push("Note: This analysis was enhanced with LLM-powered narrative synthesis.");
  }

  return sections.join("\n");
}

// ─── Build council deliberation ────────────────────────────

function buildDeliberation(council: CouncilVerdict): CouncilDeliberation {
  if (council.deliberation) return council.deliberation;

  // Fallback for legacy verdicts without deliberation
  return {
    arbitrationProcess: "Legacy verdict — no structured arbitration trace available.",
    crossReferences: [],
    disagreements: council.critiques
      .filter((c) => c.type === "conflict")
      .map((c) => `${c.fromModule} ↔ ${c.aboutModule}: ${c.description}`),
    corroborations: council.critiques
      .filter((c) => c.type === "agreement")
      .map((c) => `${c.fromModule} ↔ ${c.aboutModule}: ${c.description}`),
    confidenceFactors: [`Confidence: ${(council.confidence * 100).toFixed(0)}%`],
  };
}

// ─── Main entry point ──────────────────────────────────────

/** DB-compatible assessment row (may lack runtime-only fields). */
export interface AssessmentRow {
  moduleId: string;
  status: string;
  score: number | null;
  riskLevel: string | null;
  findings: Finding[];
  summary: string | null;
  recommendation: string | null;
  model: string | null;
  completedAt: string | null;
  error: string | null;
  moduleName?: string;
  framework?: string;
}

/** DB-compatible verdict row. */
export interface VerdictRow {
  verdict: string;
  confidence: number;
  reasoning: string;
  critiques: Array<{ fromModule: string; aboutModule: string; type: string; description: string }>;
  perModuleSummary: Record<string, string>;
  algorithmicVerdict: string;
  llmEnhanced: boolean;
}

export interface EvaluationData {
  id: string;
  applicationName: string;
  applicationDescription: string | null;
  applicationProfile: { framework?: string } | null;
  assessments: AssessmentRow[];
  verdict: VerdictRow | null;
  completedAt: string | null;
}

/** Map module IDs to default framework labels when the DB row doesn't carry them. */
const MODULE_DEFAULTS: Record<string, { name: string; framework: string }> = {
  sentinel: { name: "Sentinel", framework: "CWE/OWASP Web" },
  watchdog: { name: "Watchdog", framework: "OWASP LLM Top 10" },
  guardian: { name: "Guardian", framework: "NIST AI RMF" },
};

/** Normalise a DB assessment row into a full ExpertAssessment. */
function normaliseAssessment(row: AssessmentRow): ExpertAssessment {
  const defaults = MODULE_DEFAULTS[row.moduleId] ?? { name: row.moduleId, framework: "Unknown" };
  return {
    moduleId: row.moduleId as ExpertModuleId,
    moduleName: row.moduleName ?? defaults.name,
    framework: row.framework ?? defaults.framework,
    status: row.status as ExpertAssessment["status"],
    score: row.score ?? 0,
    riskLevel: (row.riskLevel ?? "info") as Severity,
    findings: row.findings ?? [],
    summary: row.summary ?? "",
    recommendation: row.recommendation ?? "",
    completedAt: row.completedAt ?? new Date().toISOString(),
    model: row.model ?? "unknown",
    error: row.error ?? undefined,
  };
}

/** Normalise a DB verdict row into a full CouncilVerdict. */
function normaliseVerdict(row: VerdictRow): CouncilVerdict {
  return {
    verdict: row.verdict as CouncilVerdict["verdict"],
    confidence: row.confidence,
    reasoning: row.reasoning,
    critiques: row.critiques.map((c) => ({
      fromModule: c.fromModule as ExpertModuleId,
      aboutModule: c.aboutModule as ExpertModuleId,
      type: c.type as "agreement" | "conflict" | "addition",
      description: c.description,
    })),
    perModuleSummary: row.perModuleSummary as Record<ExpertModuleId, string>,
    algorithmicVerdict: row.algorithmicVerdict as CouncilVerdict["algorithmicVerdict"],
    llmEnhanced: row.llmEnhanced,
  };
}

/**
 * Generate a structured report from a completed evaluation.
 *
 * The report includes:
 *  - Executive summary (application-specific, not boilerplate)
 *  - Risk summary table per module
 *  - Per-module findings sorted by severity
 *  - Council deliberation with full arbitration trace
 *  - Prioritized actionable recommendations
 */
export function generateReport(evaluation: EvaluationData): EvaluationReport {
  const {
    id: evaluationId,
    applicationName,
    applicationDescription,
    applicationProfile,
    assessments: rawAssessments,
    verdict: rawVerdict,
  } = evaluation;

  if (!rawVerdict) {
    throw new Error("Cannot generate report: evaluation has no council verdict.");
  }

  const assessments = rawAssessments.map(normaliseAssessment);
  const council = normaliseVerdict(rawVerdict);

  // Build module summaries
  const moduleSummaries = {} as Record<ExpertModuleId, ModuleReportSection>;
  for (const a of assessments) {
    moduleSummaries[a.moduleId] = buildModuleSection(a);
  }

  const framework = applicationProfile?.framework ?? "";
  const appContext = extractAppContext(
    applicationName,
    applicationDescription ?? "",
    framework,
    assessments,
  );

  // Executive summary
  const executiveSummary = buildExecutiveSummary(
    applicationName,
    applicationDescription ?? "",
    framework,
    council.verdict,
    assessments,
    council,
  );

  // Plain-language stakeholder summary (jargon-free "what this means" block)
  const plainLanguageSummary = buildPlainLanguageSummary(
    applicationName,
    council.verdict,
    assessments,
  );

  // Council analysis narrative
  const councilAnalysis = buildCouncilAnalysis(council);

  // Risk summary table
  const riskSummary = buildRiskSummary(assessments);

  // Actionable recommendations
  const recommendations = buildRecommendations(assessments, appContext);

  // Council deliberation
  const councilDeliberation = buildDeliberation(council);

  return {
    id: `rpt_${nanoid(12)}`,
    evaluationId,
    executiveSummary,
    plainLanguageSummary,
    verdict: council.verdict,
    confidence: council.confidence,
    applicationName,
    applicationDescription: applicationDescription ?? "",
    moduleSummaries,
    councilAnalysis,
    riskSummary,
    recommendations,
    councilDeliberation,
    generatedAt: new Date().toISOString(),
  };
}
