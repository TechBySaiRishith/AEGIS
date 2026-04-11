import { describe, it, expect } from "vitest";
import type { ApplicationProfile } from "@aegis/shared";
import type { LLMFinding } from "./analyzer.js";
import {
  parseFindings,
  computeScore,
  deriveRiskLevel,
  buildPriorityList,
} from "./analyzer.js";

// ─── Helpers ─────────────────────────────────────────────────

/** Minimal ApplicationProfile with only the fields buildPriorityList reads */
function stubApp(
  overrides: Partial<ApplicationProfile> = {},
): ApplicationProfile {
  return {
    id: "test-app",
    inputType: "github_url",
    name: "Test App",
    description: "A test application",
    framework: "express",
    language: "typescript",
    entryPoints: [],
    dependencies: [],
    aiIntegrations: [],
    fileStructure: [],
    totalFiles: 0,
    totalLines: 0,
    ...overrides,
  };
}

/** Build a typed Finding for score / risk-level tests */
function finding(severity: "critical" | "high" | "medium" | "low" | "info") {
  return {
    id: `test-${severity}`,
    title: `${severity} finding`,
    severity,
    category: "General",
    description: "",
    evidence: [],
  };
}

// ─── parseFindings ───────────────────────────────────────────

describe("sentinel parseFindings", () => {
  it("converts a fully-populated raw finding into a typed Finding", () => {
    const raw: LLMFinding[] = [
      {
        title: "SQL Injection",
        severity: "critical",
        category: "injection",
        description: "User input concatenated into SQL query.",
        filePath: "src/db.ts",
        lineNumber: 42,
        snippet: "db.query(`SELECT * FROM users WHERE id = ${id}`)",
        remediation: "Use parameterised queries.",
        framework: "CWE-89",
      },
    ];

    const findings = parseFindings(raw);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toBe("SQL Injection");
    expect(f.severity).toBe("critical");
    expect(f.category).toBe("injection");
    expect(f.description).toBe("User input concatenated into SQL query.");
    expect(f.remediation).toBe("Use parameterised queries.");
    expect(f.framework).toBe("CWE-89");
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0]?.filePath).toBe("src/db.ts");
    expect(f.evidence[0]?.lineNumber).toBe(42);
    expect(f.evidence[0]?.snippet).toBe(
      "db.query(`SELECT * FROM users WHERE id = ${id}`)",
    );
  });

  it("handles missing optional fields gracefully", () => {
    const raw: LLMFinding[] = [
      {
        title: "Minimal finding",
        severity: "low",
        filePath: "src/app.ts",
        // no lineNumber, no snippet, no remediation, no framework
      },
    ];

    const findings = parseFindings(raw);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.severity).toBe("low");
    expect(f.category).toBe("General");
    expect(f.description).toBe("");
    expect(f.remediation).toBeUndefined();
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0]?.lineNumber).toBeUndefined();
    expect(f.evidence[0]?.snippet).toBeUndefined();
  });

  it("defaults invalid severity to 'medium'", () => {
    const raw: LLMFinding[] = [
      { title: "Bad severity", severity: "EXTREME", filePath: "x.ts" },
    ];

    const findings = parseFindings(raw);
    expect(findings[0]?.severity).toBe("medium");
  });

  it("returns empty array for empty input", () => {
    expect(parseFindings([])).toEqual([]);
  });

  it("produces empty evidence when filePath is missing", () => {
    const raw: LLMFinding[] = [
      { title: "No file", severity: "info", description: "General advice" },
    ];

    const findings = parseFindings(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual([]);
  });

  it("assigns sequential ids with 'sentinel-' prefix", () => {
    const raw: LLMFinding[] = [
      { title: "A", filePath: "a.ts" },
      { title: "B", filePath: "b.ts" },
    ];

    const findings = parseFindings(raw);
    expect(findings[0]?.id).toMatch(/^sentinel-1-/);
    expect(findings[1]?.id).toMatch(/^sentinel-2-/);
  });
});

// ─── computeScore ────────────────────────────────────────────

describe("sentinel computeScore", () => {
  it("returns 100 for empty findings", () => {
    expect(computeScore([])).toBe(100);
  });

  it("deducts 20 for a single critical finding", () => {
    expect(computeScore([finding("critical")])).toBe(80);
  });

  it("deducts 12 for high, 5 for medium, 2 for low", () => {
    expect(computeScore([finding("high")])).toBe(88);
    expect(computeScore([finding("medium")])).toBe(95);
    expect(computeScore([finding("low")])).toBe(98);
  });

  it("does not deduct for info findings", () => {
    expect(computeScore([finding("info"), finding("info")])).toBe(100);
  });

  it("combines multiple severities correctly", () => {
    // 100 - 20 - 12 - 5 - 2 = 61
    const findings = [
      finding("critical"),
      finding("high"),
      finding("medium"),
      finding("low"),
    ];
    expect(computeScore(findings)).toBe(61);
  });

  it("clamps to 0 when deductions exceed 100", () => {
    // 6 criticals = 100 - 120 → clamped to 0
    const findings = Array.from({ length: 6 }, () => finding("critical"));
    expect(computeScore(findings)).toBe(0);
  });
});

// ─── deriveRiskLevel ─────────────────────────────────────────

describe("sentinel deriveRiskLevel", () => {
  it("returns 'info' for empty findings", () => {
    expect(deriveRiskLevel([])).toBe("info");
  });

  it("returns 'low' when only low findings exist", () => {
    expect(deriveRiskLevel([finding("low")])).toBe("low");
  });

  it("returns the highest severity present", () => {
    expect(deriveRiskLevel([finding("medium"), finding("critical")])).toBe(
      "critical",
    );
  });

  it("returns 'high' when high is the maximum", () => {
    expect(deriveRiskLevel([finding("low"), finding("high")])).toBe("high");
  });

  it("returns 'medium' when medium is the maximum", () => {
    expect(
      deriveRiskLevel([finding("low"), finding("info"), finding("medium")]),
    ).toBe("medium");
  });
});

// ─── buildPriorityList ───────────────────────────────────────

describe("sentinel buildPriorityList", () => {
  it("puts entry points first", () => {
    const app = stubApp({ entryPoints: ["src/index.ts", "src/main.ts"] });
    const list = buildPriorityList(app);

    expect(list[0]).toBe("src/index.ts");
    expect(list[1]).toBe("src/main.ts");
  });

  it("includes AI integration files after entry points", () => {
    const app = stubApp({
      entryPoints: ["src/index.ts"],
      aiIntegrations: [
        { type: "openai", description: "GPT", files: ["src/llm.ts"] },
      ],
    });

    const list = buildPriorityList(app);
    expect(list.indexOf("src/index.ts")).toBeLessThan(
      list.indexOf("src/llm.ts"),
    );
  });

  it("detects config files by name pattern", () => {
    const app = stubApp({
      fileStructure: [
        { path: "package.json", type: "file" },
        { path: "Dockerfile", type: "file" },
        { path: "src/utils.ts", type: "file", lines: 50 },
      ],
    });

    const list = buildPriorityList(app);
    expect(list).toContain("package.json");
    expect(list).toContain("Dockerfile");
  });

  it("sorts source files by line count ascending", () => {
    const app = stubApp({
      fileStructure: [
        { path: "src/big.ts", type: "file", lines: 500 },
        { path: "src/small.ts", type: "file", lines: 10 },
        { path: "src/mid.ts", type: "file", lines: 100 },
      ],
    });

    const list = buildPriorityList(app);
    const bigIdx = list.indexOf("src/big.ts");
    const smallIdx = list.indexOf("src/small.ts");
    const midIdx = list.indexOf("src/mid.ts");

    expect(smallIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(bigIdx);
  });

  it("skips directory nodes", () => {
    const app = stubApp({
      fileStructure: [
        { path: "src", type: "directory" },
        { path: "src/app.ts", type: "file", lines: 20 },
      ],
    });

    const list = buildPriorityList(app);
    expect(list).not.toContain("src");
    expect(list).toContain("src/app.ts");
  });

  it("returns empty list for empty profile", () => {
    const app = stubApp();
    expect(buildPriorityList(app)).toEqual([]);
  });
});
