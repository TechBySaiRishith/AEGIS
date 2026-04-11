import { describe, expect, it } from "vitest";
import type {
  ApplicationProfile,
  LLMResponse,
  LLMProvider as LLMProviderType,
} from "@aegis/shared";
import {
  SentinelAnalyzer,
  WatchdogAnalyzer,
  GuardianAnalyzer,
} from "./experts/index.js";
import type { LLMProvider, CompletionOptions } from "./llm/provider.js";
import { computeAlgorithmicVerdict } from "./council/algorithmic.js";
import { generateReport, type EvaluationData } from "./reports/generator.js";

/**
 * End-to-end pipeline integration test.
 *
 * Wires a fake in-memory LLMProvider through all three expert analyzers,
 * then pushes the resulting assessments through the algorithmic council
 * and the report generator. Exercises real parse → arbitrate → report
 * flow without touching the filesystem or a real LLM API.
 *
 * The repo directory referenced by `config.dataDir` does not exist in
 * the test environment, so each expert's `readKeyFiles()` returns an
 * empty snippet map — the analyzers still send a valid prompt and parse
 * the fake LLM response, which is what we want to cover here.
 */

class FakeLLMProvider implements LLMProvider {
  readonly id: LLMProviderType = "custom";
  readonly displayName = "Fake";
  readonly model = "fake-model-v1";

  public callCount = 0;
  public lastSystemPrompt: string | undefined;
  public lastUserPrompt: string | undefined;

  constructor(private readonly response: string) {}

  isAvailable(): boolean {
    return true;
  }

  async complete(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    this.callCount++;
    this.lastSystemPrompt = options?.systemPrompt;
    this.lastUserPrompt = prompt;
    return {
      content: this.response,
      model: this.model,
      provider: this.id,
    };
  }
}

function fakeResponse(opts: {
  score: number;
  riskLevel: "critical" | "high" | "medium" | "low" | "info";
  findings: Array<{
    id: string;
    title: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    category: string;
    filePath?: string;
    lineNumber?: number;
    snippet?: string;
  }>;
  summary: string;
}): string {
  return JSON.stringify({
    findings: opts.findings.map((f) => ({
      title: f.title,
      severity: f.severity,
      category: f.category,
      description: `${f.title} — details`,
      filePath: f.filePath ?? "app/server.ts",
      lineNumber: f.lineNumber ?? 1,
      snippet: f.snippet ?? "function handler() { /* real code */ }",
      remediation: `Fix ${f.title}`,
    })),
    summary: opts.summary,
    recommendation: "Address findings before deployment.",
    score: opts.score,
    riskLevel: opts.riskLevel,
  });
}

function makeProfile(): ApplicationProfile {
  return {
    id: "pipeline-test-app",
    inputType: "github_url",
    sourceUrl: "https://github.com/example/test-app",
    name: "TestApp",
    description: "Synthetic pipeline integration test subject.",
    framework: "Flask",
    language: "python",
    entryPoints: ["app/server.py"],
    dependencies: ["flask==2.3", "openai==1.0"],
    aiIntegrations: [
      { type: "openai", description: "Chat completions", files: ["app/ai.py"] },
    ],
    fileStructure: [
      { path: "app", type: "directory" },
      { path: "app/server.py", type: "file", language: "python", lines: 120 },
      { path: "app/ai.py", type: "file", language: "python", lines: 60 },
    ],
    totalFiles: 2,
    totalLines: 180,
  };
}

describe("pipeline integration", () => {
  it("wires fake LLM → experts → council → report end-to-end", async () => {
    const profile = makeProfile();

    const sentinelProvider = new FakeLLMProvider(
      fakeResponse({
        score: 85,
        riskLevel: "low",
        findings: [
          {
            id: "S1",
            title: "Verbose stack trace leak",
            severity: "low",
            category: "info-disclosure",
          },
        ],
        summary: "Sentinel: no critical security issues detected.",
      }),
    );

    const watchdogProvider = new FakeLLMProvider(
      fakeResponse({
        score: 80,
        riskLevel: "medium",
        findings: [
          {
            id: "W1",
            title: "Unbounded LLM output",
            severity: "medium",
            category: "output-handling",
          },
        ],
        summary: "Watchdog: one medium LLM-safety issue.",
      }),
    );

    const guardianProvider = new FakeLLMProvider(
      fakeResponse({
        score: 90,
        riskLevel: "low",
        findings: [],
        summary: "Guardian: governance posture acceptable.",
      }),
    );

    const sentinel = new SentinelAnalyzer();
    const watchdog = new WatchdogAnalyzer();
    const guardian = new GuardianAnalyzer();

    const [sResult, wResult, gResult] = await Promise.all([
      sentinel.analyze(profile, sentinelProvider),
      watchdog.analyze(profile, watchdogProvider),
      guardian.analyze(profile, guardianProvider),
    ]);

    // Each provider was called exactly once with a real system prompt
    expect(sentinelProvider.callCount).toBe(1);
    expect(watchdogProvider.callCount).toBe(1);
    expect(guardianProvider.callCount).toBe(1);
    expect(sentinelProvider.lastSystemPrompt).toBeTruthy();
    expect(watchdogProvider.lastSystemPrompt).toBeTruthy();
    expect(guardianProvider.lastSystemPrompt).toBeTruthy();

    // Assessments were parsed correctly
    expect(sResult.status).toBe("completed");
    expect(sResult.score).toBe(85);
    expect(sResult.findings).toHaveLength(1);
    expect(sResult.findings[0].title).toBe("Verbose stack trace leak");

    expect(wResult.status).toBe("completed");
    expect(wResult.findings[0].title).toBe("Unbounded LLM output");

    expect(gResult.status).toBe("completed");
    expect(gResult.findings).toHaveLength(0);

    // Feed the real assessments through the council
    const council = computeAlgorithmicVerdict([sResult, wResult, gResult]);
    expect(council.verdict).toBe("APPROVE");
    expect(council.confidence).toBeGreaterThan(0.7);

    // And through the report generator
    const evaluationData: EvaluationData = {
      id: "eval_pipeline_int",
      applicationName: profile.name,
      applicationDescription: profile.description,
      applicationProfile: { framework: profile.framework },
      assessments: [sResult, wResult, gResult].map((a) => ({
        moduleId: a.moduleId,
        status: a.status,
        score: a.score,
        riskLevel: a.riskLevel,
        findings: a.findings,
        summary: a.summary,
        recommendation: a.recommendation,
        model: a.model,
        completedAt: a.completedAt,
        error: a.error ?? null,
      })),
      verdict: {
        verdict: council.verdict,
        confidence: council.confidence,
        reasoning: council.reasoning,
        critiques: [],
        perModuleSummary: {
          sentinel: sResult.summary,
          watchdog: wResult.summary,
          guardian: gResult.summary,
        },
        algorithmicVerdict: council.verdict,
        llmEnhanced: false,
      },
      completedAt: "2026-04-11T00:00:00.000Z",
    };

    const report = generateReport(evaluationData);

    // Report shape sanity checks
    expect(report.verdict).toBe("APPROVE");
    expect(report.applicationName).toBe("TestApp");
    expect(report.moduleSummaries.sentinel.score).toBe(85);
    expect(report.moduleSummaries.watchdog.score).toBe(80);
    expect(report.moduleSummaries.guardian.score).toBe(90);
    expect(report.plainLanguageSummary).toContain("TestApp");
    expect(report.executiveSummary.length).toBeGreaterThan(0);

    // Risk summary has an entry per module
    expect(report.riskSummary).toHaveLength(3);
  });

  it("propagates an expert failure through the pipeline without crashing", async () => {
    const profile = makeProfile();

    const brokenProvider: LLMProvider = {
      id: "custom",
      displayName: "Broken",
      model: "broken",
      isAvailable: () => true,
      async complete(): Promise<LLMResponse> {
        throw new Error("simulated LLM outage");
      },
    };

    const goodSentinel = new FakeLLMProvider(
      fakeResponse({
        score: 88,
        riskLevel: "low",
        findings: [],
        summary: "Sentinel clean.",
      }),
    );
    const goodGuardian = new FakeLLMProvider(
      fakeResponse({
        score: 90,
        riskLevel: "low",
        findings: [],
        summary: "Guardian clean.",
      }),
    );

    const sentinel = new SentinelAnalyzer();
    const watchdog = new WatchdogAnalyzer();
    const guardian = new GuardianAnalyzer();

    const [sResult, wResult, gResult] = await Promise.all([
      sentinel.analyze(profile, goodSentinel),
      watchdog.analyze(profile, brokenProvider),
      guardian.analyze(profile, goodGuardian),
    ]);

    // Watchdog caught the error and returned a failed assessment rather
    // than rejecting the Promise — this is how the real pipeline survives
    // partial provider outages.
    expect(wResult.status).toBe("failed");
    expect(wResult.error).toMatch(/simulated LLM outage/);

    // Council must still produce a non-REJECT verdict because the
    // completed modules both look healthy — the failed module should
    // only reduce confidence (Pass 5), not force a Pass-1 REJECT.
    const council = computeAlgorithmicVerdict([sResult, wResult, gResult]);
    expect(council.verdict).not.toBe("REJECT");
    expect(
      council.deliberation.confidenceFactors.some((f) =>
        /failed to complete/.test(f),
      ),
    ).toBe(true);
  });
});
