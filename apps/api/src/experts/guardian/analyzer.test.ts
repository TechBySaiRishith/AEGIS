import { describe, it, expect } from "vitest";
import { toFindings } from "./analyzer.js";

// Minimal shape of the parsed LLM response that `toFindings` consumes.
// We construct it inline rather than pulling from a fixture file because
// the structure is small and co-locating it with the test aids readability.
function buildRawResponse() {
  return {
    findings: [
      {
        title: "Populated snippet is kept",
        severity: "high",
        category: "governance",
        description: "Real code was returned by the LLM.",
        filePath: "src/real.ts",
        lineNumber: 12,
        snippet: "const apiKey = process.env.API_KEY;",
      },
      {
        title: "Empty snippet is dropped",
        severity: "medium",
        category: "governance",
        description: "The LLM emitted an empty snippet.",
        filePath: "src/empty.ts",
        lineNumber: 1,
        snippet: "",
      },
      {
        title: "Whitespace-only snippet is dropped",
        severity: "low",
        category: "governance",
        description: "The LLM emitted whitespace for a snippet.",
        filePath: "src/whitespace.ts",
        lineNumber: 3,
        snippet: "   \n\t  ",
      },
    ],
    summary: "test summary",
    recommendation: "test recommendation",
    score: 50,
    riskLevel: "medium",
  };
}

describe("guardian toFindings", () => {
  it("strips Evidence entries with empty or whitespace-only snippets", () => {
    const findings = toFindings(buildRawResponse());

    expect(findings).toHaveLength(3);

    const [populated, empty, whitespace] = findings;

    // Populated snippet survives as a single Evidence entry.
    expect(populated.evidence).toHaveLength(1);
    expect(populated.evidence?.[0]?.snippet).toBe(
      "const apiKey = process.env.API_KEY;",
    );

    // Empty and whitespace-only snippets get filtered out, leaving the
    // Finding present but with an empty evidence array (matching the
    // existing convention in this file).
    expect(empty.evidence).toEqual([]);
    expect(whitespace.evidence).toEqual([]);
  });

  it("preserves findings even when all evidence is stripped", () => {
    const findings = toFindings({
      findings: [
        {
          title: "No usable evidence",
          severity: "info",
          category: "governance",
          description: "desc",
          filePath: "src/foo.ts",
          snippet: "",
        },
      ],
      summary: "",
      recommendation: "",
      score: 90,
      riskLevel: "low",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual([]);
    expect(findings[0]?.title).toBe("No usable evidence");
  });
});
