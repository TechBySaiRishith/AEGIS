import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Evaluations ───────────────────────────────────────────

export const evaluations = sqliteTable("evaluations", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  inputType: text("input_type").notNull(),
  sourceUrl: text("source_url"),
  applicationName: text("application_name").notNull(),
  applicationDescription: text("application_description"),
  applicationProfile: text("application_profile"), // JSON text
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error"),
});

// ─── Expert Assessments ────────────────────────────────────

export const assessments = sqliteTable("assessments", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id")
    .notNull()
    .references(() => evaluations.id, { onDelete: "cascade" }),
  moduleId: text("module_id").notNull(), // sentinel | watchdog | guardian
  status: text("status").notNull().default("pending"),
  score: real("score"),
  riskLevel: text("risk_level"),
  findings: text("findings"), // JSON text
  summary: text("summary"),
  recommendation: text("recommendation"),
  model: text("model"),
  completedAt: text("completed_at"),
  error: text("error"),
});

// ─── Council Verdicts ──────────────────────────────────────

export const verdicts = sqliteTable("verdicts", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id")
    .notNull()
    .references(() => evaluations.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(), // APPROVE | REVIEW | REJECT
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  critiques: text("critiques"), // JSON text
  perModuleSummary: text("per_module_summary"), // JSON text
  algorithmicVerdict: text("algorithmic_verdict").notNull(),
  llmEnhanced: integer("llm_enhanced", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

// ─── Chat ──────────────────────────────────────────────────

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  attachments: text("attachments").notNull().default("[]"), // JSON
  tokenUsage: text("token_usage"), // JSON
  status: text("status").notNull().default("complete"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
});

export const chatUploads = sqliteTable("chat_uploads", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: integer("created_at").notNull(),
});
