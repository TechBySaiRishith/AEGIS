import { describe, it, expect } from "vitest";
import type {
  CouncilVerdict,
  ExpertAssessment,
  Finding,
  Severity,
} from "@aegis/shared";
import {
  buildExecutiveSummary,
  buildPlainLanguageSummary,
  generateReport,
  type EvaluationData,
} from "./generator";

// ─── Fixture builders ──────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    title: "Missing authentication on /admin",
    severity: "high",
    category: "Authentication",
    description: "The /admin endpoint does not require authentication.",
    evidence: [
      {
        filePath: "app.py",
        lineNumber: 42,
        description: "Route defined without decorator.",
      },
    ],
    remediation: "Add a login_required decorator.",
    ...overrides,
  };
}

function makeAssessment(
  moduleId: "sentinel" | "watchdog" | "guardian",
  overrides: Partial<ExpertAssessment> = {},
): ExpertAssessment {
  const defaults: Record<string, { name: string; framework: string }> = {
    sentinel: { name: "Sentinel", framework: "CWE/OWASP Web" },
    watchdog: { name: "Watchdog", framework: "OWASP LLM Top 10" },
    guardian: { name: "Guardian", framework: "NIST AI RMF" },
  };
  return {
    moduleId,
    moduleName: defaults[moduleId].name,
    framework: defaults[moduleId].framework,
    status: "completed",
    score: 85,
    riskLevel: "medium" as Severity,
    findings: [],
    summary: `${defaults[moduleId].name} completed its review.`,
    recommendation: "Looks acceptable.",
    completedAt: "2026-04-11T00:00:00.000Z",
    model: "test-model",
    ...overrides,
  };
}

function makeCouncil(
  verdict: "APPROVE" | "REVIEW" | "REJECT",
  overrides: Partial<CouncilVerdict> = {},
): CouncilVerdict {
  return {
    verdict,
    confidence: 0.87,
    reasoning: "Three modules reached a consistent conclusion.",
    critiques: [],
    perModuleSummary: {
      sentinel: "ok",
      watchdog: "ok",
      guardian: "ok",
    },
    algorithmicVerdict: verdict,
    llmEnhanced: false,
    ...overrides,
  };
}

// ─── buildExecutiveSummary ─────────────────────────────────

describe("buildExecutiveSummary", () => {
  const assessments = [
    makeAssessment("sentinel", { findings: [makeFinding()] }),
    makeAssessment("watchdog"),
    makeAssessment("guardian"),
  ];

  it("includes the verdict and application name", () => {
    const summary = buildExecutiveSummary(
      "TestApp",
      "A toy app for testing.",
      "Flask",
      "APPROVE",
      assessments,
      makeCouncil("APPROVE"),
    );
    expect(summary).toContain("TestApp");
    expect(summary).toContain("APPROVE");
  });

  it("never contains two consecutive blank lines", () => {
    const council = makeCouncil("REVIEW", {
      critiques: [
        {
          fromModule: "sentinel",
          aboutModule: "watchdog",
          type: "conflict",
          description: "Sentinel flagged auth; Watchdog did not.",
        },
        {
          fromModule: "watchdog",
          aboutModule: "guardian",
          type: "agreement",
          description: "Both agree governance is acceptable.",
        },
      ],
    });
    const summary = buildExecutiveSummary(
      "TestApp",
      "A toy app.",
      "Flask",
      "REVIEW",
      assessments,
      council,
    );
    expect(summary).not.toMatch(/\n\n\n/);
    // And double-check that no line-separator run of >1 empty lines exists
    const lines = summary.split("\n");
    for (let i = 1; i < lines.length; i++) {
      expect(
        lines[i] === "" && lines[i - 1] === "",
        `found consecutive blank lines at index ${i}: ${JSON.stringify(lines)}`,
      ).toBe(false);
    }
  });

  it("strips leading and trailing whitespace", () => {
    const summary = buildExecutiveSummary(
      "TestApp",
      "",
      "Flask",
      "APPROVE",
      assessments,
      makeCouncil("APPROVE"),
    );
    expect(summary).toBe(summary.trim());
    expect(summary.startsWith("\n")).toBe(false);
    expect(summary.endsWith("\n")).toBe(false);
  });
});

// ─── buildPlainLanguageSummary ─────────────────────────────

describe("buildPlainLanguageSummary", () => {
  const emptyAssessments = [
    makeAssessment("sentinel"),
    makeAssessment("watchdog"),
    makeAssessment("guardian"),
  ];

  it("APPROVE headline contains 'passed'", () => {
    const out = buildPlainLanguageSummary("MyApp", "APPROVE", emptyAssessments);
    const headline = out.split("\n")[0];
    expect(headline).toMatch(/passed/);
    expect(headline).toContain("MyApp");
  });

  it("REJECT headline says the app should not be deployed", () => {
    const withCritical = [
      makeAssessment("sentinel", {
        findings: [makeFinding({ severity: "critical" })],
      }),
      makeAssessment("watchdog"),
      makeAssessment("guardian"),
    ];
    const out = buildPlainLanguageSummary("MyApp", "REJECT", withCritical);
    const headline = out.split("\n")[0];
    expect(headline).toMatch(/should not be deployed|serious safety problems/);
  });

  it("REVIEW summary is actionable and non-alarming", () => {
    const out = buildPlainLanguageSummary("MyApp", "REVIEW", emptyAssessments);
    expect(out).toMatch(/review/i);
    expect(out).toMatch(/Next step/);
  });

  it("never mentions jargon like CWE, OWASP, or NIST", () => {
    for (const verdict of ["APPROVE", "REVIEW", "REJECT"] as const) {
      const out = buildPlainLanguageSummary("MyApp", verdict, emptyAssessments);
      expect(out).not.toMatch(/CWE/);
      expect(out).not.toMatch(/OWASP/);
      expect(out).not.toMatch(/NIST/);
    }
  });

  it("follows headline → explanation → next step structure", () => {
    const out = buildPlainLanguageSummary("MyApp", "APPROVE", emptyAssessments);
    const parts = out.split("\n\n");
    // Three blocks separated by a blank line: headline, explanation, next step
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("MyApp");
    expect(parts[2]).toMatch(/^Next step/);
  });

  it("pluralises critical problem count correctly on REJECT", () => {
    const oneCritical = [
      makeAssessment("sentinel", {
        findings: [makeFinding({ id: "F-C1", severity: "critical" })],
      }),
      makeAssessment("watchdog"),
      makeAssessment("guardian"),
    ];
    const manyCritical = [
      makeAssessment("sentinel", {
        findings: [
          makeFinding({ id: "F-C1", severity: "critical" }),
          makeFinding({ id: "F-C2", severity: "critical" }),
          makeFinding({ id: "F-C3", severity: "critical" }),
        ],
      }),
      makeAssessment("watchdog"),
      makeAssessment("guardian"),
    ];

    const one = buildPlainLanguageSummary("MyApp", "REJECT", oneCritical);
    const many = buildPlainLanguageSummary("MyApp", "REJECT", manyCritical);

    expect(one).toMatch(/1 critical problem\b/);
    expect(many).toMatch(/3 critical problems\b/);
  });
});

// ─── generateReport integration ────────────────────────────

describe("generateReport", () => {
  function makeEvaluationData(): EvaluationData {
    return {
      id: "eval_test_1",
      applicationName: "TestApp",
      applicationDescription: "A toy app for testing.",
      applicationProfile: { framework: "Flask" },
      assessments: [
        {
          moduleId: "sentinel",
          status: "completed",
          score: 90,
          riskLevel: "low",
          findings: [makeFinding()],
          summary: "Sentinel completed its review.",
          recommendation: "Looks fine.",
          model: "test-model",
          completedAt: "2026-04-11T00:00:00.000Z",
          error: null,
        },
        {
          moduleId: "watchdog",
          status: "completed",
          score: 88,
          riskLevel: "low",
          findings: [],
          summary: "Watchdog completed its review.",
          recommendation: "Looks fine.",
          model: "test-model",
          completedAt: "2026-04-11T00:00:00.000Z",
          error: null,
        },
        {
          moduleId: "guardian",
          status: "completed",
          score: 92,
          riskLevel: "low",
          findings: [],
          summary: "Guardian completed its review.",
          recommendation: "Looks fine.",
          model: "test-model",
          completedAt: "2026-04-11T00:00:00.000Z",
          error: null,
        },
      ],
      verdict: {
        verdict: "APPROVE",
        confidence: 0.9,
        reasoning: "Consistent across modules.",
        critiques: [],
        perModuleSummary: { sentinel: "ok", watchdog: "ok", guardian: "ok" },
        algorithmicVerdict: "APPROVE",
        llmEnhanced: false,
      },
      completedAt: "2026-04-11T00:00:00.000Z",
    };
  }

  it("populates plainLanguageSummary on the returned report", () => {
    const report = generateReport(makeEvaluationData());
    expect(report.plainLanguageSummary).toBeTruthy();
    expect(report.plainLanguageSummary).toContain("TestApp");
    expect(report.plainLanguageSummary).toMatch(/passed/);
  });

  it("produces an executiveSummary with no double blank lines", () => {
    const report = generateReport(makeEvaluationData());
    expect(report.executiveSummary).not.toMatch(/\n\n\n/);
  });
});
