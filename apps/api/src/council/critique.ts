import type { ExpertAssessment, CritiquePoint, ExpertModuleId } from "@aegis/shared";
import type { LLMProvider } from "../llm/provider.js";
import { CRITIQUE_SYSTEM_PROMPT, buildCritiquePrompt } from "./prompts.js";

// ─── Response Validation ─────────────────────────────────────

const VALID_MODULE_IDS = new Set<string>(["sentinel", "watchdog", "guardian"]);
const VALID_CRITIQUE_TYPES = new Set<string>(["agreement", "conflict", "addition"]);

interface RawCritiqueResponse {
  critiques?: unknown[];
  narrative?: string;
}

function isValidModuleId(value: unknown): value is ExpertModuleId {
  return typeof value === "string" && VALID_MODULE_IDS.has(value);
}

function parseCritiqueResponse(raw: string): {
  critiques: CritiquePoint[];
  narrative: string;
} {
  // Strip markdown fences if the LLM wraps them
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed: RawCritiqueResponse = JSON.parse(cleaned);

  const critiques: CritiquePoint[] = [];

  if (Array.isArray(parsed.critiques)) {
    for (const item of parsed.critiques) {
      if (
        item &&
        typeof item === "object" &&
        "fromModule" in item &&
        "aboutModule" in item &&
        "type" in item &&
        "description" in item
      ) {
        const c = item as Record<string, unknown>;
        if (
          isValidModuleId(c.fromModule) &&
          isValidModuleId(c.aboutModule) &&
          typeof c.type === "string" &&
          VALID_CRITIQUE_TYPES.has(c.type) &&
          typeof c.description === "string"
        ) {
          critiques.push({
            fromModule: c.fromModule,
            aboutModule: c.aboutModule,
            type: c.type as CritiquePoint["type"],
            description: c.description,
          });
        }
      }
    }
  }

  return {
    critiques,
    narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
  };
}

// ─── Critique Round ──────────────────────────────────────────

/**
 * Run a cross-expert critique round using the LLM.
 *
 * The LLM receives all assessments and identifies agreements,
 * conflicts, and gaps across the three expert modules.
 *
 * @throws Never — returns an empty array on LLM/parse failure.
 */
export async function runCritiqueRound(
  assessments: ExpertAssessment[],
  llm: LLMProvider,
): Promise<{ critiques: CritiquePoint[]; narrative: string }> {
  const prompt = buildCritiquePrompt(assessments);

  const response = await llm.complete(prompt, {
    systemPrompt: CRITIQUE_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 2048,
  });

  return parseCritiqueResponse(response.content);
}
