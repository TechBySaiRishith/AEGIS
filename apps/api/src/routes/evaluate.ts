import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  EvaluateRequest,
  EvaluateResponse,
  EvaluationStatus,
  ExpertModuleId,
  ExpertAssessment,
  Verdict,
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

// ─── Algorithmic verdict (no LLM required) ─────────────────

function computeAlgorithmicVerdict(
  assessments: ExpertAssessment[],
): { verdict: Verdict; confidence: number; reasoning: string } {
  const completed = assessments.filter((a) => a.status === "completed");
  if (completed.length === 0) {
    return { verdict: "REJECT", confidence: 0.3, reasoning: "No expert modules completed successfully." };
  }

  const avgScore = completed.reduce((sum, a) => sum + a.score, 0) / completed.length;
  const hasCritical = completed.some((a) => a.riskLevel === "critical");
  const hasHigh = completed.some((a) => a.riskLevel === "high");
  const failedModules = assessments.filter((a) => a.status === "failed").length;

  let verdict: Verdict;
  let confidence: number;
  let reasoning: string;

  if (hasCritical || avgScore < 30) {
    verdict = "REJECT";
    confidence = Math.min(0.95, 0.7 + (completed.length / 3) * 0.25);
    reasoning = hasCritical
      ? "Critical risk level detected by one or more expert modules."
      : `Average safety score (${avgScore.toFixed(0)}) is below the minimum threshold.`;
  } else if (hasHigh || avgScore < 60) {
    verdict = "REVIEW";
    confidence = Math.min(0.9, 0.6 + (completed.length / 3) * 0.2);
    reasoning = hasHigh
      ? "High risk level detected — manual review recommended before deployment."
      : `Average safety score (${avgScore.toFixed(0)}) indicates significant concerns requiring review.`;
  } else {
    verdict = "APPROVE";
    confidence = Math.min(0.9, 0.5 + (completed.length / 3) * 0.3);
    reasoning = `Average safety score (${avgScore.toFixed(0)}) is within acceptable range across ${completed.length} module(s).`;
  }

  if (failedModules > 0) {
    confidence = Math.max(0.2, confidence - 0.15 * failedModules);
    reasoning += ` Note: ${failedModules} module(s) failed to complete.`;
  }

  return { verdict, confidence, reasoning };
}

// ─── Background evaluation pipeline ────────────────────────

async function runEvaluation(evaluationId: string, request: EvaluateRequest): Promise<void> {
  try {
    // 1. Cloning / intake
    updateEvaluationStatus(evaluationId, "cloning");
    pushEvent(evaluationId, "status", { status: "cloning", message: "Cloning repository and profiling application…" });

    const profile = await handleIntake(request);

    updateEvaluationStatus(evaluationId, "analyzing");
    pushEvent(evaluationId, "status", { status: "analyzing", message: "Application profiled. Starting expert analysis…" });

    // 2. Run experts in parallel
    const registry = getLLMRegistry();

    const sentinel = new SentinelAnalyzer();
    const watchdog = new WatchdogAnalyzer();
    const guardian = new GuardianAnalyzer();

    const experts: Array<{ id: ExpertModuleId; statusKey: EvaluationStatus; runner: () => Promise<ExpertAssessment> }> = [
      {
        id: "sentinel",
        statusKey: "sentinel_running",
        runner: () => sentinel.analyze(profile, registry.getProviderForModule("sentinel")),
      },
      {
        id: "watchdog",
        statusKey: "watchdog_running",
        runner: () => watchdog.analyze(profile, registry.getProviderForModule("watchdog")),
      },
      {
        id: "guardian",
        statusKey: "guardian_running",
        runner: () => guardian.analyze(profile, registry.getProviderForModule("guardian")),
      },
    ];

    // Announce each expert starting
    for (const expert of experts) {
      pushEvent(evaluationId, "status", {
        status: expert.statusKey,
        message: `${expert.id} analysis starting…`,
      });
    }

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

    // 3. Synthesise verdict (algorithmic for now — Council module will enhance later)
    updateEvaluationStatus(evaluationId, "synthesizing");
    pushEvent(evaluationId, "status", { status: "synthesizing", message: "Computing verdict…" });

    const { verdict, confidence, reasoning } = computeAlgorithmicVerdict(assessments);

    const perModuleSummary: Record<string, string> = {};
    for (const a of assessments) {
      perModuleSummary[a.moduleId] = a.summary || `${a.moduleId}: ${a.status}`;
    }

    saveVerdict({
      evaluationId,
      verdict,
      confidence,
      reasoning,
      critiques: [],
      perModuleSummary: perModuleSummary as Record<ExpertModuleId, string>,
      algorithmicVerdict: verdict,
      llmEnhanced: false,
    });

    // 4. Done
    updateEvaluationStatus(evaluationId, "completed", {
      completedAt: new Date().toISOString(),
    });

    pushEvent(evaluationId, "verdict", { verdict, confidence, reasoning });
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

export { evaluate };
