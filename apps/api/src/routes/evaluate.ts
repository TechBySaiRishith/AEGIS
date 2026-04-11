import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  EvaluateRequest,
  EvaluateResponse,
  EvaluationStatus,
  ExpertModuleId,
  ExpertAssessment,
} from "@aegis/shared";
import {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  updateEvaluationStatus,
  saveAssessment,
  saveVerdict,
} from "../db/queries.js";
import { getLLMRegistry } from "../llm/registry.js";
import { handleIntake } from "../intake/handler.js";
import { SentinelAnalyzer, WatchdogAnalyzer, GuardianAnalyzer } from "../experts/index.js";
import { parseModelSpec } from "../llm/provider.js";
import type { LLMProvider } from "../llm/provider.js";
import { synthesize } from "../council/index.js";
import { generateReport, renderHTMLReport } from "../reports/index.js";
import type { EvaluationData } from "../reports/index.js";

const evaluate = new Hono();

// ─── In-memory SSE event log per evaluation ────────────────

interface EvalEvent {
  type: string;
  evaluationId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const eventLogs = new Map<string, EvalEvent[]>();
const eventListeners = new Map<string, Set<(event: EvalEvent) => void>>();

function pushEvent(evaluationId: string, type: string, data: Record<string, unknown>): void {
  const event: EvalEvent = {
    type,
    evaluationId,
    timestamp: new Date().toISOString(),
    data,
  };

  // Append to log
  let log = eventLogs.get(evaluationId);
  if (!log) {
    log = [];
    eventLogs.set(evaluationId, log);
  }
  log.push(event);

  // Notify live listeners
  const listeners = eventListeners.get(evaluationId);
  if (listeners) {
    for (const cb of listeners) {
      cb(event);
    }
  }
}

// ─── Background evaluation pipeline ────────────────────────

async function runEvaluation(evaluationId: string, request: EvaluateRequest): Promise<void> {
  try {
    // 1. Cloning / intake
    updateEvaluationStatus(evaluationId, "cloning");
    pushEvent(evaluationId, "status", { status: "cloning", message: "Cloning repository and profiling application…" });

    const profile = await handleIntake(request);

    updateEvaluationStatus(evaluationId, "analyzing", {
      applicationProfile: profile as unknown as Record<string, unknown>,
      applicationName: profile.name,
      applicationDescription: profile.description,
    });
    pushEvent(evaluationId, "status", { status: "analyzing", message: "Application profiled. Starting expert analysis…" });

    // 2. Run experts in parallel
    const registry = getLLMRegistry();

    // Helper: resolve per-request model override → LLMProvider instance
    const resolveProvider = (moduleId: ExpertModuleId) => {
      const modelOverrides = request.models;
      if (modelOverrides?.[moduleId]) {
        const spec = modelOverrides[moduleId];
        const parsed = parseModelSpec(spec);
        if (parsed) {
          const base = registry.get(parsed.provider);
          if (base) {
            // Use the registry's createWithModel via getProviderForModule fallback
            // or construct directly through the public API
            return base.model === parsed.model
              ? base
              : registry.createProviderWithModel(parsed.provider, parsed.model);
          }
        }
        console.warn(`[evaluate] Model override "${spec}" for ${moduleId} could not be resolved — using default`);
      }
      return registry.getProviderForModule(moduleId);
    };

    const sentinel = new SentinelAnalyzer();
    const watchdog = new WatchdogAnalyzer();
    const guardian = new GuardianAnalyzer();

    const experts: Array<{ id: ExpertModuleId; statusKey: EvaluationStatus; runner: () => Promise<ExpertAssessment> }> = [
      {
        id: "sentinel",
        statusKey: "sentinel_running",
        runner: () => sentinel.analyze(profile, resolveProvider("sentinel")),
      },
      {
        id: "watchdog",
        statusKey: "watchdog_running",
        runner: () => watchdog.analyze(profile, resolveProvider("watchdog")),
      },
      {
        id: "guardian",
        statusKey: "guardian_running",
        runner: () => guardian.analyze(profile, resolveProvider("guardian")),
      },
    ];

    // Announce each expert starting & set initial expert status in DB
    updateEvaluationStatus(evaluationId, "sentinel_running");
    for (const expert of experts) {
      pushEvent(evaluationId, "status", {
        status: expert.statusKey,
        message: `${expert.id} analysis starting…`,
      });
    }

    // Track completion count so the DB status advances as experts finish
    let expertsCompleted = 0;
    const expertStatusStages: EvaluationStatus[] = ["sentinel_running", "watchdog_running", "guardian_running"];

    const results = await Promise.allSettled(
      experts.map(async (expert) => {
        const assessment = await expert.runner();

        // Persist to DB
        saveAssessment({
          evaluationId,
          moduleId: expert.id,
          status: assessment.status,
          score: assessment.score,
          riskLevel: assessment.riskLevel,
          findings: assessment.findings,
          summary: assessment.summary,
          recommendation: assessment.recommendation,
          model: assessment.model,
          completedAt: assessment.completedAt,
          error: assessment.error,
        });

        // Advance DB status as each expert completes (drives polling-based progress)
        const stageStatus = expertStatusStages[Math.min(expertsCompleted, expertStatusStages.length - 1)];
        expertsCompleted++;
        updateEvaluationStatus(evaluationId, stageStatus);

        pushEvent(evaluationId, "progress", {
          module: expert.id,
          status: assessment.status,
          score: assessment.score,
          findingsCount: assessment.findings.length,
        });

        return assessment;
      }),
    );

    // Collect assessments
    const assessments: ExpertAssessment[] = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;

      // Promise rejected entirely — build a failed assessment shell
      const errorMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const failedAssessment: ExpertAssessment = {
        moduleId: experts[i].id,
        moduleName: experts[i].id,
        framework: "unknown",
        status: "failed",
        score: 0,
        riskLevel: "critical",
        findings: [],
        summary: "",
        recommendation: "",
        completedAt: new Date().toISOString(),
        model: "unknown",
        error: errorMsg,
      };

      saveAssessment({
        evaluationId,
        moduleId: experts[i].id,
        status: "failed",
        error: errorMsg,
      });

      return failedAssessment;
    });

    // 3. Council synthesis — full arbitration pipeline
    updateEvaluationStatus(evaluationId, "synthesizing");
    pushEvent(evaluationId, "status", { status: "synthesizing", message: "Council arbitrating verdict across all expert assessments…" });

    // Resolve synthesizer LLM (optional — council falls back to algorithmic-only)
    // Resolution order:
    //   1. request.models.synthesizer (per-request override)
    //   2. SYNTHESIZER_MODEL env var
    //   3. AEGIS_DEFAULT_MODEL env var (via registry.getDefault())
    let synthesizerLLM: LLMProvider | undefined;
    try {
      const synthModelSpec =
        request.models?.synthesizer ?? process.env.SYNTHESIZER_MODEL;
      if (synthModelSpec) {
        const parsed = parseModelSpec(synthModelSpec);
        if (parsed) {
          const base = registry.get(parsed.provider);
          if (base) {
            synthesizerLLM = base.model === parsed.model
              ? base
              : registry.createProviderWithModel(parsed.provider, parsed.model);
          }
        }
      }
      if (!synthesizerLLM) {
        synthesizerLLM = registry.getDefault();
      }
    } catch {
      // No LLM available — council will use algorithmic-only path
    }

    const council = await synthesize(assessments, synthesizerLLM);

    saveVerdict({
      evaluationId,
      verdict: council.verdict,
      confidence: council.confidence,
      reasoning: council.reasoning,
      critiques: council.critiques,
      perModuleSummary: council.perModuleSummary,
      algorithmicVerdict: council.algorithmicVerdict,
      llmEnhanced: council.llmEnhanced,
    });

    // 4. Done
    updateEvaluationStatus(evaluationId, "completed", {
      completedAt: new Date().toISOString(),
    });

    pushEvent(evaluationId, "verdict", {
      verdict: council.verdict,
      confidence: council.confidence,
      reasoning: council.reasoning,
      arbitrationProcess: council.deliberation?.arbitrationProcess ?? "algorithmic",
    });
    pushEvent(evaluationId, "complete", { message: "Evaluation finished." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evaluate] Pipeline failed for ${evaluationId}: ${message}`);

    updateEvaluationStatus(evaluationId, "failed", { error: message });
    pushEvent(evaluationId, "error", { error: message });
  }
}

// ─── POST /api/evaluate — start a new evaluation ───────────

evaluate.post("/", async (c) => {
  const body = await c.req.json<EvaluateRequest>();

  if (!body.source || !body.inputType) {
    return c.json({ error: "Missing required fields: inputType, source" }, 400);
  }

  const record = createEvaluation({
    inputType: body.inputType,
    sourceUrl: body.source,
    applicationName: body.source,
    applicationDescription: body.description,
  });

  // Fire-and-forget — the pipeline runs in the background
  runEvaluation(record.id, body).catch((err) => {
    console.error(`[evaluate] Unhandled error in background pipeline: ${err}`);
  });

  const response: EvaluateResponse = {
    evaluationId: record.id,
    status: "pending",
  };

  return c.json(response, 201);
});

// ─── GET /api/evaluations — list all evaluations ───────────

evaluate.get("/", (c) => {
  const list = listEvaluations();
  return c.json(list);
});

// ─── GET /api/evaluations/:id — single evaluation ──────────

evaluate.get("/:id", (c) => {
  const entry = getEvaluation(c.req.param("id"));
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);
  return c.json(entry);
});

// ─── GET /api/evaluations/:id/events — SSE stream ──────────

evaluate.get("/:id/events", (c) => {
  const id = c.req.param("id");
  const entry = getEvaluation(id);
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);

  return streamSSE(c, async (stream) => {
    // Replay any events that already occurred
    const pastEvents = eventLogs.get(id) ?? [];
    for (const event of pastEvents) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    }

    // If the evaluation is already terminal, close immediately
    if (entry.status === "completed" || entry.status === "failed") {
      return;
    }

    // Subscribe to live events
    let done = false;
    const onEvent = async (event: EvalEvent) => {
      if (done) return;
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
        if (event.type === "complete" || event.type === "error") {
          done = true;
        }
      } catch {
        done = true;
      }
    };

    let listeners = eventListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      eventListeners.set(id, listeners);
    }
    listeners.add(onEvent);

    // Keep the stream alive until the evaluation finishes or client disconnects
    try {
      while (!done) {
        await stream.sleep(1000);
      }
    } finally {
      listeners.delete(onEvent);
      if (listeners.size === 0) eventListeners.delete(id);
    }
  });
});

// ─── GET /api/evaluations/:id/report — JSON report ─────────

evaluate.get("/:id/report", (c) => {
  const entry = getEvaluation(c.req.param("id"));
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);

  if (entry.status !== "completed") {
    return c.json(
      { error: `Evaluation is not completed (status: ${entry.status}). Report generation requires a completed evaluation.` },
      400,
    );
  }

  try {
    const evalData: EvaluationData = {
      id: entry.id,
      applicationName: entry.applicationName ?? entry.sourceUrl ?? "Unknown application",
      applicationDescription: entry.applicationDescription ?? null,
      applicationProfile: entry.applicationProfile as { framework?: string } | null,
      assessments: entry.assessments,
      verdict: entry.verdict,
      completedAt: entry.completedAt ?? null,
    };

    const report = generateReport(evalData);
    return c.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Report generation failed: ${message}` }, 500);
  }
});

// ─── GET /api/evaluations/:id/report/html — HTML report ────

evaluate.get("/:id/report/html", (c) => {
  const entry = getEvaluation(c.req.param("id"));
  if (!entry) return c.json({ error: "Evaluation not found" }, 404);

  if (entry.status !== "completed") {
    return c.json(
      { error: `Evaluation is not completed (status: ${entry.status}). Report generation requires a completed evaluation.` },
      400,
    );
  }

  try {
    const evalData: EvaluationData = {
      id: entry.id,
      applicationName: entry.applicationName ?? entry.sourceUrl ?? "Unknown application",
      applicationDescription: entry.applicationDescription ?? null,
      applicationProfile: entry.applicationProfile as { framework?: string } | null,
      assessments: entry.assessments,
      verdict: entry.verdict,
      completedAt: entry.completedAt ?? null,
    };

    const report = generateReport(evalData);
    const html = renderHTMLReport(report, {
      autoPrint: c.req.query("print") === "1",
    });
    return c.html(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Report generation failed: ${message}` }, 500);
  }
});

export { evaluate };
