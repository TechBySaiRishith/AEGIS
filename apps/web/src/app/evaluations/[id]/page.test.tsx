import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Evaluation, ExpertAssessment, ExpertModuleId } from "@aegis/shared";
import EvaluationDetailPage from "./page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: "eval-1" }),
}));

vi.mock("@/lib/api", () => ({
  getEvaluation: vi.fn(),
  getEvaluationReportHtmlUrl: vi.fn(() => "/report"),
  subscribeToEvents: vi.fn(() => vi.fn()),
}));

import { getEvaluation } from "@/lib/api";

function makeAssessment(
  moduleId: ExpertModuleId,
  overrides: Partial<ExpertAssessment> = {},
): ExpertAssessment {
  return {
    moduleId,
    moduleName: moduleId,
    framework: "Test framework",
    status: "completed",
    score: 72,
    riskLevel: "medium",
    findings: [],
    summary: `${moduleId} summary`,
    recommendation: `${moduleId} recommendation`,
    completedAt: "2025-01-01T00:00:00.000Z",
    model: "test-model",
    ...overrides,
  };
}

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: "eval-1",
    status: "completed",
    application: {
      id: "app-1",
      inputType: "github_url",
      sourceUrl: "https://github.com/example/repo",
      name: "Example app",
      description: "Example evaluation",
      framework: "Next.js",
      language: "TypeScript",
      entryPoints: ["app/page.tsx"],
      dependencies: [],
      aiIntegrations: [],
      fileStructure: [],
      totalFiles: 12,
      totalLines: 500,
    },
    assessments: {
      sentinel: makeAssessment("sentinel"),
      watchdog: makeAssessment("watchdog"),
      guardian: makeAssessment("guardian"),
    },
    council: {
      verdict: "REVIEW",
      confidence: 0.45,
      reasoning: "Coverage floor triggered after one module failed.",
      critiques: [
        {
          fromModule: "sentinel",
          aboutModule: "watchdog",
          type: "addition",
          description: "Extra context for the final review.",
        },
      ],
      perModuleSummary: {
        sentinel: "Sentinel summary",
        watchdog: "Watchdog summary",
        guardian: "Guardian summary",
      },
      algorithmicVerdict: "REVIEW",
      llmEnhanced: false,
      deliberation: {
        arbitrationProcess: "algorithmic",
        crossReferences: [],
        disagreements: [],
        corroborations: [],
        confidenceFactors: [
          "-15% confidence: 1 module(s) failed to complete — reduced coverage",
          "Capped at 50%: insufficient coverage — 2/3 module(s) completed, below the 2-module minimum for high-confidence verdicts",
        ],
      },
    },
    report: {
      id: "report-1",
      evaluationId: "eval-1",
      executiveSummary: "Detailed explanation for stakeholders.",
      verdict: "REVIEW",
      confidence: 0.45,
      applicationName: "Example app",
      applicationDescription: "Example evaluation",
      moduleSummaries: {
        sentinel: {
          moduleName: "Sentinel",
          framework: "Framework",
          score: 72,
          riskLevel: "medium",
          summary: "Sentinel module report",
          findings: [],
          recommendation: "Sentinel recommendation",
        },
        watchdog: {
          moduleName: "Watchdog",
          framework: "Framework",
          score: 72,
          riskLevel: "medium",
          summary: "Watchdog module report",
          findings: [],
          recommendation: "Watchdog recommendation",
        },
        guardian: {
          moduleName: "Guardian",
          framework: "Framework",
          score: 72,
          riskLevel: "medium",
          summary: "Guardian module report",
          findings: [],
          recommendation: "Guardian recommendation",
        },
      },
      councilAnalysis: "Detailed explanation for stakeholders.",
      recommendations: [],
      riskSummary: [],
      councilDeliberation: {
        arbitrationProcess: "algorithmic",
        crossReferences: [],
        disagreements: [],
        corroborations: [],
        confidenceFactors: [],
      },
      generatedAt: "2025-01-01T00:00:00.000Z",
    },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EvaluationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a plain-language explanation when confidence is reduced by incomplete module coverage", async () => {
    vi.mocked(getEvaluation).mockResolvedValue(
      makeEvaluation({
        assessments: {
          sentinel: makeAssessment("sentinel"),
          watchdog: makeAssessment("watchdog", { status: "failed", score: 0, summary: "Watchdog failed", findings: [] }),
          guardian: makeAssessment("guardian"),
        },
      }),
    );

    render(<EvaluationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Confidence is reduced because fewer than 3 expert modules completed successfully.")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /AEGIS held this result at review because only 2 of 3 expert modules completed successfully\./i,
      ),
    ).toBeInTheDocument();
  });

  it("uses plain-language section labels in the completed results view", async () => {
    vi.mocked(getEvaluation).mockResolvedValue(makeEvaluation());

    render(<EvaluationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Detailed analysis summary")).toBeInTheDocument();
    });

    expect(screen.getByText("Detailed analysis")).toBeInTheDocument();
    expect(screen.getByText("Expert notes")).toBeInTheDocument();
  });
});
