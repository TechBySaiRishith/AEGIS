// ─── Enums & Type Unions ───────────────────────────────────

export type Tier = "critical" | "high" | "medium";

export type RiskDomain =
  | "data_sovereignty"
  | "agent_autonomy"
  | "content_safety"
  | "operational_integrity"
  | "supply_chain_trust";

export type Verdict = "APPROVE" | "REVIEW" | "REJECT";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type EvaluationStatus =
  | "pending"
  | "cloning"
  | "analyzing"
  | "sentinel_running"
  | "watchdog_running"
  | "guardian_running"
  | "synthesizing"
  | "completed"
  | "failed";

export type ExpertModuleId = "sentinel" | "watchdog" | "guardian";

export type LLMProvider = "anthropic" | "openai" | "copilot" | "github" | "custom";

// ─── LLM Configuration ────────────────────────────────────

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Application Intake ────────────────────────────────────

export type InputType = "github_url" | "conversation_json" | "api_endpoint";

export interface ApplicationProfile {
  id: string;
  inputType: InputType;
  sourceUrl?: string;
  name: string;
  description: string;
  framework: string;
  language: string;
  entryPoints: string[];
  dependencies: string[];
  aiIntegrations: AIIntegration[];
  fileStructure: FileNode[];
  totalFiles: number;
  totalLines: number;
  clonedAt?: string;
}

export interface AIIntegration {
  type: string; // "openai", "anthropic", "huggingface", etc.
  description: string;
  files: string[];
  systemPrompts?: string[];
}

export interface FileNode {
  path: string;
  type: "file" | "directory";
  language?: string;
  lines?: number;
}

// ─── Expert Module Types ───────────────────────────────────

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  description: string;
  evidence: Evidence[];
  remediation?: string;
  framework?: string; // CWE-79, OWASP-LLM01, NIST-MAP-1.1, etc.
}

export interface Evidence {
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  description: string;
}

export interface ExpertAssessment {
  moduleId: ExpertModuleId;
  moduleName: string;
  framework: string; // "CWE/OWASP Web", "OWASP LLM Top 10", "NIST AI RMF"
  status: "completed" | "failed" | "partial";
  score: number; // 0-100
  riskLevel: Severity;
  findings: Finding[];
  summary: string;
  recommendation: string;
  completedAt: string;
  model: string;
  error?: string;
}

// ─── Council Synthesis ─────────────────────────────────────

export interface CritiquePoint {
  fromModule: ExpertModuleId;
  aboutModule: ExpertModuleId;
  type: "agreement" | "conflict" | "addition";
  description: string;
}

export interface CouncilVerdict {
  verdict: Verdict;
  confidence: number; // 0-1
  reasoning: string;
  critiques: CritiquePoint[];
  perModuleSummary: Record<ExpertModuleId, string>;
  algorithmicVerdict: Verdict; // always computed, no LLM needed
  llmEnhanced: boolean; // whether LLM was used to enhance narrative
}

// ─── Evaluation (Full Run) ─────────────────────────────────

export interface Evaluation {
  id: string;
  status: EvaluationStatus;
  application: ApplicationProfile;
  assessments: Partial<Record<ExpertModuleId, ExpertAssessment>>;
  council?: CouncilVerdict;
  report?: EvaluationReport;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

// ─── Reports ───────────────────────────────────────────────

export interface EvaluationReport {
  id: string;
  evaluationId: string;
  executiveSummary: string;
  verdict: Verdict;
  confidence: number;
  applicationName: string;
  applicationDescription: string;
  moduleSummaries: Record<ExpertModuleId, ModuleReportSection>;
  councilAnalysis: string;
  generatedAt: string;
}

export interface ModuleReportSection {
  moduleName: string;
  framework: string;
  score: number;
  riskLevel: Severity;
  summary: string;
  findings: Finding[];
  recommendation: string;
}

// ─── SSE Events ────────────────────────────────────────────

export interface SSEEvent {
  type: "status" | "progress" | "finding" | "verdict" | "error" | "complete";
  evaluationId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── API Request/Response ──────────────────────────────────

export interface EvaluateRequest {
  inputType: InputType;
  source: string; // URL, file path, or endpoint
  description?: string;
  /** Per-request model overrides for ablation studies (e.g. { sentinel: "copilot/gpt-5.4" }) */
  models?: Partial<Record<ExpertModuleId | "synthesizer", string>>;
}

export interface EvaluateResponse {
  evaluationId: string;
  status: EvaluationStatus;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  providers: Record<LLMProvider, { available: boolean; model?: string }>;
  modules: Record<ExpertModuleId, { ready: boolean }>;
}
