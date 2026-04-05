import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ApplicationProfile,
  ExpertAssessment,
  Finding,
  Evidence,
  Severity,
} from "@aegis/shared";
import { EXPERT_MODULES } from "@aegis/shared";
import type { ExpertModule } from "../base.js";
import type { LLMProvider } from "../../llm/provider.js";
import { config } from "../../config.js";
import {
  GUARDIAN_SYSTEM_PROMPT,
  buildGuardianUserPrompt,
} from "./prompts.js";

// ─── File selection strategy ────────────────────────────────
// Guardian reads governance-relevant files — NOT the same set as
// Sentinel (security code) or Watchdog (AI integration code).

/** Documentation & governance files (exact names, case-insensitive match) */
const GOVERNANCE_FILES = new Set([
  "readme.md",
  "readme",
  "readme.txt",
  "readme.rst",
  "contributing.md",
  "contributing",
  "code_of_conduct.md",
  "license",
  "license.md",
  "licence",
  "licence.md",
  "security.md",
  "security",
  "privacy.md",
  "privacy",
  "privacy_policy.md",
  "data_protection.md",
  "changelog.md",
  "changelog",
  "changes.md",
  "model_card.md",
  "model-card.md",
  "modelcard.md",
  "datasheet.md",
  "ethics.md",
  "responsible_ai.md",
  "responsible-ai.md",
  "governance.md",
  "compliance.md",
  "audit.md",
]);

/** Dependency / supply-chain manifests */
const MANIFEST_FILES = new Set([
  "package.json",
  "package-lock.json",
  "requirements.txt",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "pipfile",
  "pipfile.lock",
  "poetry.lock",
  "go.mod",
  "cargo.toml",
  "gemfile",
  "gemfile.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

/** Config files that reveal data handling, storage, and environment setup */
const CONFIG_PATTERNS = [
  /\.env(\.example|\.sample|\.template)?$/i,
  /docker-compose\.ya?ml$/i,
  /dockerfile$/i,
  /\.docker(ignore)?$/i,
  /alembic\.ini$/i,
  /knexfile\./i,
  /drizzle\.config\./i,
  /prisma\/schema\.prisma$/i,
  /tsconfig.*\.json$/i,
];

/** Path fragments that indicate AI/model code (for provenance review) */
const AI_PATH_PATTERNS = [
  /model/i,
  /train/i,
  /inference/i,
  /predict/i,
  /pipeline/i,
  /llm/i,
  /openai/i,
  /anthropic/i,
  /hugging/i,
  /transformers/i,
  /embedding/i,
  /vector/i,
  /rag/i,
  /agent/i,
  /prompt/i,
];

/** Path fragments that indicate data handling (for privacy review) */
const DATA_PATH_PATTERNS = [
  /data/i,
  /database/i,
  /db\//i,
  /migration/i,
  /schema/i,
  /storage/i,
  /upload/i,
  /user/i,
  /auth/i,
  /pii/i,
  /gdpr/i,
  /consent/i,
  /anonymi/i,
  /privacy/i,
  /retention/i,
];

const MAX_FILE_SIZE = 50_000; // chars — Guardian reads docs which can be long
const MAX_TOTAL_CHARS = 120_000;
const MAX_FILES = 40;

// ─── Helpers ────────────────────────────────────────────────

function isGovernanceFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return GOVERNANCE_FILES.has(base);
}

function isManifestFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return MANIFEST_FILES.has(base);
}

function matchesConfigPattern(filePath: string): boolean {
  const rel = filePath.replace(/\\/g, "/");
  return CONFIG_PATTERNS.some((re) => re.test(rel));
}

function matchesAIPattern(filePath: string): boolean {
  return AI_PATH_PATTERNS.some((re) => re.test(filePath));
}

function matchesDataPattern(filePath: string): boolean {
  return DATA_PATH_PATTERNS.some((re) => re.test(filePath));
}

/** Score a file for governance relevance (higher = more relevant) */
function governanceRelevance(filePath: string): number {
  if (isGovernanceFile(filePath)) return 100;
  if (isManifestFile(filePath)) return 80;
  if (matchesConfigPattern(filePath)) return 60;
  if (matchesAIPattern(filePath)) return 40;
  if (matchesDataPattern(filePath)) return 30;
  return 0;
}

// ─── LLM response parsing ───────────────────────────────────

interface GuardianLLMResponse {
  findings: Array<{
    title: string;
    severity: string;
    category: string;
    description: string;
    filePath?: string;
    lineNumber?: number;
    snippet?: string;
    remediation?: string;
    framework?: string;
  }>;
  summary: string;
  recommendation: string;
  score: number;
  riskLevel: string;
}

function normaliseSeverity(raw: string): Severity {
  const lower = raw?.toLowerCase().trim();
  if (lower === "critical") return "critical";
  if (lower === "high") return "high";
  if (lower === "medium") return "medium";
  if (lower === "low") return "low";
  return "info";
}

function normaliseRiskLevel(raw: string): Severity {
  return normaliseSeverity(raw);
}

function parseLLMResponse(raw: string): GuardianLLMResponse {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned) as GuardianLLMResponse;

  if (!Array.isArray(parsed.findings)) {
    throw new Error("LLM response missing findings array");
  }

  return parsed;
}

function toFindings(raw: GuardianLLMResponse): Finding[] {
  return raw.findings.map((f, idx) => {
    const evidence: Evidence[] = [];
    if (f.filePath) {
      evidence.push({
        filePath: f.filePath,
        lineNumber: f.lineNumber ?? undefined,
        snippet: f.snippet ?? undefined,
        description: f.description,
      });
    }

    return {
      id: `guardian-${idx + 1}`,
      title: f.title,
      severity: normaliseSeverity(f.severity),
      category: f.category || "governance",
      description: f.description,
      evidence,
      remediation: f.remediation,
      framework: f.framework,
    };
  });
}

// ─── Guardian Module ────────────────────────────────────────

export class GuardianAnalyzer implements ExpertModule {
  readonly id = "guardian" as const;
  readonly name = EXPERT_MODULES.guardian.name;
  private readonly meta = EXPERT_MODULES.guardian;

  async analyze(
    app: ApplicationProfile,
    llm: LLMProvider,
  ): Promise<ExpertAssessment> {
    const startTime = Date.now();

    try {
      // 1. Collect governance-relevant files from the cloned repo
      const repoRoot = path.join(config.dataDir, "repos", app.id);
      const codeSnippets = await this.collectGovernanceFiles(repoRoot, app);

      // 2. Build the prompt
      const userPrompt = buildGuardianUserPrompt(app, codeSnippets);

      // 3. Call the LLM
      const llmResponse = await llm.complete(userPrompt, {
        systemPrompt: GUARDIAN_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 8_000,
      });

      // 4. Parse and convert to findings
      const parsed = parseLLMResponse(llmResponse.content);
      const findings = toFindings(parsed);

      return {
        moduleId: "guardian",
        moduleName: this.meta.name,
        framework: this.meta.framework,
        status: "completed",
        score: Math.max(0, Math.min(100, parsed.score)),
        riskLevel: normaliseRiskLevel(parsed.riskLevel),
        findings,
        summary: parsed.summary,
        recommendation: parsed.recommendation,
        completedAt: new Date().toISOString(),
        model: llmResponse.model,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`[guardian] Analysis failed: ${message}`);

      return {
        moduleId: "guardian",
        moduleName: this.meta.name,
        framework: this.meta.framework,
        status: "failed",
        score: 0,
        riskLevel: "critical",
        findings: [],
        summary: "",
        recommendation: "",
        completedAt: new Date().toISOString(),
        model: "unknown",
        error: message,
      };
    }
  }

  // ─── File collection ────────────────────────────────────

  private async collectGovernanceFiles(
    repoRoot: string,
    app: ApplicationProfile,
  ): Promise<Record<string, string>> {
    const snippets: Record<string, string> = {};
    let totalChars = 0;

    // Build a ranked list of files from the application profile
    const candidates = app.fileStructure
      .filter((f) => f.type === "file")
      .map((f) => ({
        path: f.path,
        relevance: governanceRelevance(f.path),
      }))
      .filter((f) => f.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_FILES);

    for (const candidate of candidates) {
      if (totalChars >= MAX_TOTAL_CHARS) break;

      try {
        const absPath = path.join(repoRoot, candidate.path);
        const stat = await fs.stat(absPath);

        // Skip very large files and non-text
        if (stat.size > MAX_FILE_SIZE * 2) continue;

        const content = await fs.readFile(absPath, "utf-8");
        const truncated =
          content.length > MAX_FILE_SIZE
            ? content.slice(0, MAX_FILE_SIZE) + "\n... [truncated]"
            : content;

        snippets[candidate.path] = truncated;
        totalChars += truncated.length;
      } catch {
        // File unreadable — skip silently
      }
    }

    // If we found very few governance files, note that in a synthetic entry
    if (Object.keys(snippets).length === 0) {
      snippets["__guardian_note__"] =
        "No governance-relevant files (README, docs, config, model code) were found in the repository. " +
        "This itself is a significant governance finding.";
    }

    return snippets;
  }
}
