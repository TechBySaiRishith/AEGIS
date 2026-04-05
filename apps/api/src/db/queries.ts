import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./connection.js";
import { evaluations, assessments, verdicts } from "./schema.js";
import type {
  EvaluationStatus,
  InputType,
  ExpertModuleId,
  Severity,
  Verdict as VerdictType,
  Finding,
  CritiquePoint,
} from "@aegis/shared";

// ─── Evaluation CRUD ───────────────────────────────────────

interface CreateEvaluationInput {
  inputType: InputType;
  sourceUrl?: string;
  applicationName: string;
  applicationDescription?: string;
  applicationProfile?: Record<string, unknown>;
}

export function createEvaluation(data: CreateEvaluationInput) {
  const now = new Date().toISOString();
  const id = `eval_${nanoid(12)}`;

  db.insert(evaluations)
    .values({
      id,
      status: "pending",
      inputType: data.inputType,
      sourceUrl: data.sourceUrl ?? null,
      applicationName: data.applicationName,
      applicationDescription: data.applicationDescription ?? null,
      applicationProfile: data.applicationProfile
        ? JSON.stringify(data.applicationProfile)
        : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getEvaluation(id)!;
}

export function getEvaluation(id: string) {
  const row = db.select().from(evaluations).where(eq(evaluations.id, id)).get();
  if (!row) return null;

  const evalAssessments = db
    .select()
    .from(assessments)
    .where(eq(assessments.evaluationId, id))
    .all();

  const evalVerdict = db
    .select()
    .from(verdicts)
    .where(eq(verdicts.evaluationId, id))
    .get();

  return {
    ...row,
    applicationProfile: row.applicationProfile
      ? JSON.parse(row.applicationProfile)
      : null,
    assessments: evalAssessments.map(parseAssessmentRow),
    verdict: evalVerdict ? parseVerdictRow(evalVerdict) : null,
  };
}

export function listEvaluations() {
  return db
    .select()
    .from(evaluations)
    .orderBy(desc(evaluations.createdAt))
    .all()
    .map((row) => ({
      ...row,
      applicationProfile: row.applicationProfile
        ? JSON.parse(row.applicationProfile)
        : null,
    }));
}

export function updateEvaluationStatus(
  id: string,
  status: EvaluationStatus,
  extra?: { completedAt?: string; error?: string },
) {
  db.update(evaluations)
    .set({
      status,
      updatedAt: new Date().toISOString(),
      ...(extra?.completedAt && { completedAt: extra.completedAt }),
      ...(extra?.error && { error: extra.error }),
    })
    .where(eq(evaluations.id, id))
    .run();
}

// ─── Assessment CRUD ───────────────────────────────────────

interface SaveAssessmentInput {
  evaluationId: string;
  moduleId: ExpertModuleId;
  status: "completed" | "failed" | "partial";
  score?: number;
  riskLevel?: Severity;
  findings?: Finding[];
  summary?: string;
  recommendation?: string;
  model?: string;
  completedAt?: string;
  error?: string;
}

export function saveAssessment(data: SaveAssessmentInput) {
  const id = `asmt_${data.moduleId}_${nanoid(8)}`;
  const now = new Date().toISOString();

  // Upsert: delete existing for same evaluation+module, then insert
  const existing = db
    .select()
    .from(assessments)
    .where(eq(assessments.evaluationId, data.evaluationId))
    .all()
    .find((a) => a.moduleId === data.moduleId);

  if (existing) {
    db.update(assessments)
      .set({
        status: data.status,
        score: data.score ?? null,
        riskLevel: data.riskLevel ?? null,
        findings: data.findings ? JSON.stringify(data.findings) : null,
        summary: data.summary ?? null,
        recommendation: data.recommendation ?? null,
        model: data.model ?? null,
        completedAt: data.completedAt ?? now,
        error: data.error ?? null,
      })
      .where(eq(assessments.id, existing.id))
      .run();

    return parseAssessmentRow(
      db.select().from(assessments).where(eq(assessments.id, existing.id)).get()!,
    );
  }

  db.insert(assessments)
    .values({
      id,
      evaluationId: data.evaluationId,
      moduleId: data.moduleId,
      status: data.status,
      score: data.score ?? null,
      riskLevel: data.riskLevel ?? null,
      findings: data.findings ? JSON.stringify(data.findings) : null,
      summary: data.summary ?? null,
      recommendation: data.recommendation ?? null,
      model: data.model ?? null,
      completedAt: data.completedAt ?? now,
      error: data.error ?? null,
    })
    .run();

  return parseAssessmentRow(
    db.select().from(assessments).where(eq(assessments.id, id)).get()!,
  );
}

// ─── Verdict CRUD ──────────────────────────────────────────

interface SaveVerdictInput {
  evaluationId: string;
  verdict: VerdictType;
  confidence: number;
  reasoning: string;
  critiques?: CritiquePoint[];
  perModuleSummary?: Record<ExpertModuleId, string>;
  algorithmicVerdict: VerdictType;
  llmEnhanced?: boolean;
}

export function saveVerdict(data: SaveVerdictInput) {
  const id = `vrd_${nanoid(10)}`;
  const now = new Date().toISOString();

  // One verdict per evaluation — replace if exists
  const existing = db
    .select()
    .from(verdicts)
    .where(eq(verdicts.evaluationId, data.evaluationId))
    .get();

  if (existing) {
    db.delete(verdicts).where(eq(verdicts.id, existing.id)).run();
  }

  db.insert(verdicts)
    .values({
      id,
      evaluationId: data.evaluationId,
      verdict: data.verdict,
      confidence: data.confidence,
      reasoning: data.reasoning,
      critiques: data.critiques ? JSON.stringify(data.critiques) : null,
      perModuleSummary: data.perModuleSummary
        ? JSON.stringify(data.perModuleSummary)
        : null,
      algorithmicVerdict: data.algorithmicVerdict,
      llmEnhanced: data.llmEnhanced ?? false,
      createdAt: now,
    })
    .run();

  return parseVerdictRow(
    db.select().from(verdicts).where(eq(verdicts.id, id)).get()!,
  );
}

// ─── Row Parsers (JSON text → objects) ─────────────────────

function parseAssessmentRow(row: typeof assessments.$inferSelect) {
  return {
    ...row,
    findings: row.findings ? (JSON.parse(row.findings) as Finding[]) : [],
  };
}

function parseVerdictRow(row: typeof verdicts.$inferSelect) {
  return {
    ...row,
    critiques: row.critiques
      ? (JSON.parse(row.critiques) as CritiquePoint[])
      : [],
    perModuleSummary: row.perModuleSummary
      ? (JSON.parse(row.perModuleSummary) as Record<ExpertModuleId, string>)
      : {},
  };
}
