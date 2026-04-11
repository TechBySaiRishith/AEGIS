import type { ExpertAssessment, Finding, Evidence } from "@aegis/shared";

/** Maximum line distance to consider two findings as referring to the same issue. */
const LINE_PROXIMITY = 5;

/** Keywords used for fuzzy category matching across modules. */
const CATEGORY_KEYWORDS = [
  "key",
  "secret",
  "credential",
  "hardcod",
  "token",
  "password",
  "auth",
  "injection",
  "prompt",
  "expos",
  "leak",
  "sensitive",
  "permission",
  "access",
];

/**
 * Check whether two category/title strings share a common security keyword.
 * Both strings are lowercased and checked for substring matches against
 * the keyword list.
 */
function categoriesOverlap(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return CATEGORY_KEYWORDS.some((kw) => la.includes(kw) && lb.includes(kw));
}

/**
 * Check whether two findings have at least one evidence entry that shares
 * the same file path with line numbers within ±LINE_PROXIMITY.
 */
function evidenceOverlaps(aEvidence: Evidence[], bEvidence: Evidence[]): boolean {
  for (const ea of aEvidence) {
    for (const eb of bEvidence) {
      if (ea.filePath !== eb.filePath) continue;
      if (ea.lineNumber == null || eb.lineNumber == null) continue;
      if (Math.abs(ea.lineNumber - eb.lineNumber) <= LINE_PROXIMITY) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cross-module finding deduplication.
 *
 * Detects when multiple modules flag the same issue (same file, nearby line,
 * similar category) and links them via `corroboratedBy` so the report layer
 * can surface corroboration instead of showing duplicates.
 *
 * Returns new assessment objects — inputs are never mutated.
 */
export function deduplicateFindings(
  assessments: ExpertAssessment[],
): ExpertAssessment[] {
  // Deep-clone so we never mutate the caller's data
  const cloned: ExpertAssessment[] = structuredClone(assessments);

  // Build a flat index: (assessmentIdx, findingIdx) for quick cross-referencing
  const pairs: Array<{ ai: number; fi: number; moduleId: string; finding: Finding }> = [];
  for (let ai = 0; ai < cloned.length; ai++) {
    for (let fi = 0; fi < cloned[ai].findings.length; fi++) {
      pairs.push({
        ai,
        fi,
        moduleId: cloned[ai].moduleId,
        finding: cloned[ai].findings[fi],
      });
    }
  }

  // Compare every pair across different modules
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i];
      const b = pairs[j];

      // Only cross-module matches
      if (a.moduleId === b.moduleId) continue;

      const catMatch =
        categoriesOverlap(a.finding.category, b.finding.category) ||
        categoriesOverlap(a.finding.title, b.finding.title);

      if (!catMatch) continue;
      if (!evidenceOverlaps(a.finding.evidence, b.finding.evidence)) continue;

      // Link a → b
      if (!a.finding.corroboratedBy) a.finding.corroboratedBy = [];
      if (!a.finding.corroboratedBy.some((c) => c.findingId === b.finding.id)) {
        a.finding.corroboratedBy.push({
          moduleId: b.moduleId,
          findingId: b.finding.id,
        });
      }

      // Link b → a
      if (!b.finding.corroboratedBy) b.finding.corroboratedBy = [];
      if (!b.finding.corroboratedBy.some((c) => c.findingId === a.finding.id)) {
        b.finding.corroboratedBy.push({
          moduleId: a.moduleId,
          findingId: a.finding.id,
        });
      }
    }
  }

  return cloned;
}
