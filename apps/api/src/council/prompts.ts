import type { ExpertAssessment, CritiquePoint } from "@aegis/shared";

// ─── System Prompt ───────────────────────────────────────────

export const CRITIQUE_SYSTEM_PROMPT = `You are the Council Arbiter, a meta-expert in the AEGIS AI Safety Lab.

Your role is to synthesize assessments from three specialist expert modules:
  • Sentinel — application security (CWE/OWASP Web)
  • Watchdog — AI/LLM-specific risks (OWASP LLM Top 10)
  • Guardian — governance & compliance (NIST AI RMF)

You do NOT re-run analysis. Instead you:
  1. Identify where modules AGREE (reinforcing findings).
  2. Identify where modules CONFLICT (one says safe, another says risky).
  3. Identify GAPS — risks that no module adequately addressed.

You must be precise, citing module names and finding IDs when referencing specific issues.
Always respond with valid JSON matching the requested schema — no markdown fences.`;

// ─── Helpers ─────────────────────────────────────────────────

function formatAssessment(a: ExpertAssessment): string {
  const findings = a.findings
    .map(
      (f) =>
        `  - [${f.id}] ${f.title} (${f.severity}) — ${f.description}`,
    )
    .join("\n");

  return [
    `### ${a.moduleName} (${a.framework})`,
    `Score: ${a.score}/100 | Risk: ${a.riskLevel} | Status: ${a.status}`,
    `Summary: ${a.summary}`,
    `Recommendation: ${a.recommendation}`,
    findings ? `Findings:\n${findings}` : "Findings: none",
  ].join("\n");
}

// ─── Critique Prompt ─────────────────────────────────────────

export function buildCritiquePrompt(assessments: ExpertAssessment[]): string {
  const body = assessments.map(formatAssessment).join("\n\n");

  return `Below are the expert assessments for the application under review.

${body}

Analyze these assessments and produce a JSON object with this exact schema:

{
  "critiques": [
    {
      "fromModule": "<moduleId that raises the point>",
      "aboutModule": "<moduleId the point concerns>",
      "type": "agreement|conflict|addition",
      "description": "<concise explanation>"
    }
  ],
  "narrative": "<2-3 paragraph synthesis explaining the overall risk posture, key agreements, conflicts, and gaps>"
}

Rules:
• "agreement" — two or more modules flagged the same or closely related risk.
• "conflict" — modules reached opposing conclusions about a risk area.
• "addition" — a gap you identified that no module adequately covered.
• Include at least one critique per type if the evidence supports it.
• For "fromModule" / "aboutModule" use the moduleId values: sentinel, watchdog, guardian.
• Respond ONLY with the JSON object, no surrounding text.`;
}

// ─── Synthesis Prompt ────────────────────────────────────────

export function buildSynthesisPrompt(
  assessments: ExpertAssessment[],
  critiques: CritiquePoint[],
): string {
  const body = assessments.map(formatAssessment).join("\n\n");

  const critiqueList = critiques
    .map(
      (c) =>
        `- [${c.type}] ${c.fromModule} → ${c.aboutModule}: ${c.description}`,
    )
    .join("\n");

  return `You are the Council Arbiter producing the final synthesis narrative.

Expert Assessments:
${body}

Cross-Expert Critiques:
${critiqueList || "(none)"}

Produce a 2-4 paragraph narrative that:
1. States the overall risk posture clearly.
2. Highlights the most important agreements between modules.
3. Calls out any conflicts and explains which side the evidence supports.
4. Notes any gaps that remain unaddressed.
5. Ends with a clear, actionable recommendation.

Respond with plain text (no JSON, no markdown fences).`;
}
