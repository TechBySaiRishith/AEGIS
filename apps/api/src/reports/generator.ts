import { nanoid } from "nanoid";
import type {
  EvaluationReport,
  ExpertAssessment,
  ExpertModuleId,
  Finding,
  ModuleReportSection,
  Severity,
  CouncilVerdict,
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
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  if (sorted.length === 0) return "no issues";

  const counts = countBySeverity(findings);
  const parts: string[] = [];

  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    if (counts[sev]) {
      parts.push(`${counts[sev]} ${sev}`);
    }
  }

  return parts.join(", ");
}

function verdictParagraph(verdict: string, appName: string): string {
  switch (verdict) {
    case "APPROVE":
      return (
        `Based on the combined analysis, ${appName} meets the safety thresholds required for deployment. ` +
        `No critical or high-severity issues were identified that would block release. ` +
        `The Council recommends approval, though any medium-severity findings should be addressed in subsequent iterations.`
      );
    case "REVIEW":
      return (
        `The evaluation identified concerns that require manual review before ${appName} can be approved for deployment. ` +
        `While no showstopper defects were found, high-severity issues and risk patterns warrant closer inspection ` +
        `by the safety team before a final determination is made.`
      );
    case "REJECT":
      return (
        `The evaluation identified critical safety concerns in ${appName} that preclude deployment in its current state. ` +
        `One or more expert modules flagged issues at the critical severity level. ` +
        `The application must undergo remediation and re-evaluation before it can be considered for approval.`
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

// ─── Build executive summary ───────────────────────────────

function buildExecutiveSummary(
  appName: string,
  appDescription: string,
  framework: string,
  verdict: string,
  assessments: ExpertAssessment[],
  council: CouncilVerdict,
): string {
  const lines: string[] = [];

  // Opening paragraph
  lines.push(
    `AEGIS evaluated ${appName}, a ${framework || "software"} application, through three independent expert modules.`,
  );
  if (appDescription) {
    lines.push(appDescription);
  }

  lines.push("");

  // Verdict paragraph
  lines.push(verdictParagraph(verdict, appName));

  lines.push("");

  // Per-module breakdown
  for (const id of ["sentinel", "watchdog", "guardian"] as ExpertModuleId[]) {
    const a = assessments.find((x) => x.moduleId === id);
    if (!a) continue;

    const label = MODULE_LABELS[id];
    if (a.status === "failed") {
      lines.push(
        `${label.name} (${label.focus}) failed to complete its analysis${a.error ? `: ${a.error}` : "."}`,
      );
    } else {
      const findingsSummary =
        a.findings.length > 0
          ? `identifying ${a.findings.length} finding(s) (${topSeverityLabel(a.findings)})`
          : "identifying no findings";
      lines.push(
        `${label.name} (${label.focus}) scored the application ${a.score}/100, ${findingsSummary}.`,
      );
    }
  }

  // Disagreements
  const conflicts = council.critiques.filter((c) => c.type === "conflict");
  if (conflicts.length > 0) {
    lines.push("");
    const details = conflicts.map((c) => c.description).join(" ");
    lines.push(`The Council noted disagreements between modules: ${details}`);
  }

  // Overall recommendation
  lines.push("");
  lines.push(`Overall recommendation: ${verdict}.`);

  return lines.join("\n");
}

// ─── Build council analysis narrative ──────────────────────

function buildCouncilAnalysis(council: CouncilVerdict): string {
  const sections: string[] = [];

  sections.push("Council Synthesis");
  sections.push("─".repeat(40));
  sections.push("");
  sections.push(`Verdict: ${council.verdict} (confidence: ${(council.confidence * 100).toFixed(0)}%)`);
  sections.push("");
  sections.push("Reasoning:");
  sections.push(council.reasoning);

  if (council.critiques.length > 0) {
    sections.push("");
    sections.push("Cross-Module Observations:");
    for (const c of council.critiques) {
      const typeLabel =
        c.type === "conflict" ? "⚠ Disagreement" : c.type === "agreement" ? "✓ Agreement" : "+ Addition";
      sections.push(`  ${typeLabel} (${c.fromModule} → ${c.aboutModule}): ${c.description}`);
    }
  }

  if (council.llmEnhanced) {
    sections.push("");
    sections.push("Note: This analysis was enhanced with LLM-powered narrative synthesis.");
  }

  return sections.join("\n");
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
  // Runtime fields that may or may not be present
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
 * The evaluation must have at least one assessment and a council verdict.
 * All data is derived from the structured assessment/verdict data — no LLM
 * calls are made during report generation.
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

  // Executive summary
  const framework = applicationProfile?.framework ?? "";
  const executiveSummary = buildExecutiveSummary(
    applicationName,
    applicationDescription ?? "",
    framework,
    council.verdict,
    assessments,
    council,
  );

  // Council analysis narrative
  const councilAnalysis = buildCouncilAnalysis(council);

  return {
    id: `rpt_${nanoid(12)}`,
    evaluationId,
    executiveSummary,
    verdict: council.verdict,
    confidence: council.confidence,
    applicationName,
    applicationDescription: applicationDescription ?? "",
    moduleSummaries,
    councilAnalysis,
    generatedAt: new Date().toISOString(),
  };
}
