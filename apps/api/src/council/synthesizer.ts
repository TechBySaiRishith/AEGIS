import type {
  ExpertAssessment,
  ExpertModuleId,
  CouncilVerdict,
  CritiquePoint,
  CouncilDeliberation,
} from "@aegis/shared";
import type { LLMProvider } from "../llm/provider.js";
import { computeAlgorithmicVerdict } from "./algorithmic.js";
import { runCritiqueRound } from "./critique.js";
import { log } from "../logger.js";
import { buildSynthesisPrompt, CRITIQUE_SYSTEM_PROMPT } from "./prompts.js";

// ─── Helpers ─────────────────────────────────────────────────

/** Extract the summary field from each module's assessment. */
function buildPerModuleSummary(
  assessments: ExpertAssessment[],
): Record<ExpertModuleId, string> {
  const result = {} as Record<ExpertModuleId, string>;
  for (const a of assessments) {
    result[a.moduleId] = a.summary;
  }
  return result;
}

/**
 * Detect score disagreements between modules.
 * A disagreement is flagged when two modules' scores differ by ≥ 30 points.
 */
const DISAGREEMENT_THRESHOLD = 30;

function detectDisagreements(
  assessments: ExpertAssessment[],
): CritiquePoint[] {
  const disagreements: CritiquePoint[] = [];

  for (let i = 0; i < assessments.length; i++) {
    for (let j = i + 1; j < assessments.length; j++) {
      const a = assessments[i];
      const b = assessments[j];
      const diff = Math.abs(a.score - b.score);

      if (diff >= DISAGREEMENT_THRESHOLD) {
        const higher = a.score >= b.score ? a : b;
        const lower = a.score >= b.score ? b : a;

        disagreements.push({
          fromModule: higher.moduleId,
          aboutModule: lower.moduleId,
          type: "conflict",
          description:
            `Score disagreement: ${higher.moduleName} scored ${higher.score}/100 ` +
            `while ${lower.moduleName} scored ${lower.score}/100 ` +
            `(Δ${diff}). The Council defers to the stricter assessment ` +
            `from ${lower.moduleName} to uphold safety margins.`,
        });
      }
    }
  }

  return disagreements;
}

// ─── Synthesis Pipeline ──────────────────────────────────────

/**
 * Main Council synthesis pipeline.
 *
 * 1. Always computes an algorithmic verdict via the 5-pass arbitration process.
 * 2. If an LLM is available, runs a critique round and enhances reasoning.
 * 3. If the LLM fails, gracefully falls back to the algorithmic-only result.
 *
 * The algorithmic verdict is NEVER overridden by the LLM — the LLM only
 * enriches the narrative and surfaces cross-expert insights.
 */
export async function synthesize(
  assessments: ExpertAssessment[],
  llm?: LLMProvider,
): Promise<CouncilVerdict> {
  // ── Step 1: Algorithmic verdict with full arbitration ──────
  const algorithmic = computeAlgorithmicVerdict(assessments);

  // ── Step 2: Per-module summary ─────────────────────────────
  const perModuleSummary = buildPerModuleSummary(assessments);

  // ── Step 3: Detect score disagreements ─────────────────────
  const scoreDisagreements = detectDisagreements(assessments);

  // ── Step 4: Attempt LLM enhancement ────────────────────────
  let critiques: CritiquePoint[] = [...scoreDisagreements];
  let reasoning = algorithmic.reasoning;
  let llmEnhanced = false;
  let deliberation: CouncilDeliberation = algorithmic.deliberation;

  if (llm) {
    try {
      // Run critique round
      const critiqueResult = await runCritiqueRound(assessments, llm);

      // Merge LLM critiques with score-based disagreements (deduplicate conflicts)
      const llmCritiques = critiqueResult.critiques.filter(
        (c) =>
          !scoreDisagreements.some(
            (d) =>
              d.fromModule === c.fromModule &&
              d.aboutModule === c.aboutModule &&
              d.type === c.type,
          ),
      );
      critiques = [...scoreDisagreements, ...llmCritiques];

      // Enhance reasoning with LLM narrative
      if (critiqueResult.narrative) {
        reasoning = `${algorithmic.reasoning}\n\n--- LLM-Enhanced Council Narrative ---\n${critiqueResult.narrative}`;
        llmEnhanced = true;
      } else {
        try {
          const synthesisResponse = await llm.complete(
            buildSynthesisPrompt(assessments, critiques),
            {
              systemPrompt: CRITIQUE_SYSTEM_PROMPT,
              temperature: 0.4,
              maxTokens: 1024,
            },
          );
          reasoning = `${algorithmic.reasoning}\n\n--- LLM-Enhanced Council Narrative ---\n${synthesisResponse.content}`;
          llmEnhanced = true;
        } catch {
          // Synthesis prompt failed — keep algorithmic reasoning only
        }
      }

      // Merge LLM-discovered corroborations/disagreements into deliberation
      const llmAgreements = critiques.filter((c) => c.type === "agreement");
      const llmConflicts = critiques.filter((c) => c.type === "conflict");
      const llmAdditions = critiques.filter((c) => c.type === "addition");

      deliberation = {
        ...deliberation,
        corroborations: [
          ...deliberation.corroborations,
          ...llmAgreements.map(
            (c) => `[LLM] ${c.fromModule} ↔ ${c.aboutModule}: ${c.description}`,
          ),
        ],
        disagreements: [
          ...deliberation.disagreements,
          ...llmConflicts
            .filter(
              (c) =>
                !scoreDisagreements.some(
                  (d) => d.fromModule === c.fromModule && d.aboutModule === c.aboutModule,
                ),
            )
            .map((c) => `[LLM] ${c.fromModule} ↔ ${c.aboutModule}: ${c.description}`),
        ],
        crossReferences: [
          ...deliberation.crossReferences,
          ...llmAdditions.map(
            (c) => `[LLM gap] ${c.fromModule} → ${c.aboutModule}: ${c.description}`,
          ),
        ],
      };
    } catch (error) {
      log.warn("council", "LLM critique round failed, using algorithmic verdict only", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    verdict: algorithmic.verdict,
    confidence: algorithmic.confidence,
    reasoning,
    critiques,
    perModuleSummary,
    algorithmicVerdict: algorithmic.verdict,
    llmEnhanced,
    deliberation,
  };
}
