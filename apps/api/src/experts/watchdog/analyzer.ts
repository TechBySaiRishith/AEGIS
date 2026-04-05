import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
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
import { getLLMRegistry } from "../../llm/registry.js";
import { config } from "../../config.js";
import {
  WATCHDOG_SYSTEM_PROMPT,
  buildWatchdogUserPrompt,
} from "./prompts.js";

// ─── Constants ───────────────────────────────────────────────

const MODULE_ID = "watchdog" as const;
const META = EXPERT_MODULES[MODULE_ID];

/** Max characters per file to avoid blowing the context window */
const MAX_FILE_CHARS = 15_000;

/** Max total characters across all files sent to the LLM */
const MAX_TOTAL_CHARS = 100_000;

/** File extensions we care about */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".java", ".kt", ".scala",
  ".go",
  ".rs",
  ".rb",
  ".cs",
  ".yaml", ".yml",
  ".json",
  ".toml",
  ".env",
  ".cfg", ".ini", ".conf",
]);

/**
 * Patterns that indicate a file likely contains AI/LLM integration code.
 * Checked against both file paths and file content.
 */
const AI_PATH_PATTERNS = [
  /ai[/\\]/i,
  /llm[/\\]/i,
  /openai/i,
  /anthropic/i,
  /langchain/i,
  /llama[-_]?index/i,
  /hugging[-_]?face/i,
  /prompt/i,
  /agent/i,
  /chain/i,
  /embed/i,
  /rag/i,
  /vector/i,
  /chat/i,
  /complet/i,
  /model/i,
  /tool[-_]?call/i,
  /function[-_]?call/i,
];

const AI_CONTENT_PATTERNS = [
  /openai/i,
  /anthropic/i,
  /ChatCompletion/i,
  /createCompletion/i,
  /system_prompt|systemPrompt|system_message|SystemMessage/,
  /\.chat\.completions/,
  /langchain/i,
  /LLMChain|ChatOpenAI|ChatAnthropic/,
  /HumanMessage|AIMessage|SystemMessage/,
  /PromptTemplate/,
  /tool_choice|function_call|tools\s*:/,
  /embeddings?\.(create|embed)/i,
  /vectorStore|vector_store|pinecone|chroma|weaviate|qdrant/i,
  /\.invoke\(|\.stream\(/,
  /AI_SDK|@ai-sdk/i,
  /generateText|streamText/,
  /ANTHROPIC_API_KEY|OPENAI_API_KEY/,
];

// ─── File Reading Helpers ────────────────────────────────────

/**
 * Recursively collect file paths from a directory, skipping common
 * non-source directories.
 */
async function walkDir(
  dir: string,
  maxDepth = 6,
  depth = 0,
): Promise<string[]> {
  if (depth > maxDepth) return [];

  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "__pycache__", ".venv",
    "venv", "dist", "build", ".cache", "coverage", ".tox",
    ".mypy_cache", ".pytest_cache", "vendor",
  ]);

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walkDir(fullPath, maxDepth, depth + 1)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

/** Score how likely a file path is to contain AI-relevant code (0–10). */
function pathRelevanceScore(filePath: string): number {
  let score = 0;
  for (const pattern of AI_PATH_PATTERNS) {
    if (pattern.test(filePath)) score += 2;
  }
  return Math.min(score, 10);
}

/** Score file content for AI-relevant patterns (0–20). */
function contentRelevanceScore(content: string): number {
  let score = 0;
  for (const pattern of AI_CONTENT_PATTERNS) {
    if (pattern.test(content)) score += 2;
  }
  return Math.min(score, 20);
}

/**
 * Read key source files from a cloned repository, prioritising files
 * that are most likely to contain AI/LLM integration code.
 */
export async function readKeyFiles(
  repoDir: string,
  app: ApplicationProfile,
): Promise<Record<string, string>> {
  const allFiles = await walkDir(repoDir);
  if (allFiles.length === 0) return {};

  // Score every file by path relevance first
  const scored: Array<{ absPath: string; relPath: string; score: number }> = [];
  for (const absPath of allFiles) {
    const relPath = path.relative(repoDir, absPath);
    scored.push({ absPath, relPath, score: pathRelevanceScore(relPath) });
  }

  // Also boost files explicitly listed in aiIntegrations
  const aiFiles = new Set(app.aiIntegrations.flatMap((ai) => ai.files));
  for (const item of scored) {
    if (aiFiles.has(item.relPath)) item.score += 15;
  }

  // Sort by score descending, then alphabetically
  scored.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  // Read top candidates until we hit the total character budget
  const result: Record<string, string> = {};
  let totalChars = 0;

  for (const { absPath, relPath, score } of scored) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    let content: string;
    try {
      const fileStat = await stat(absPath);
      if (fileStat.size > MAX_FILE_CHARS * 2) continue; // skip very large files
      content = await readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    // For files with no path-level signal, check content relevance
    if (score < 2) {
      const cScore = contentRelevanceScore(content);
      if (cScore < 4) continue; // not interesting enough
    }

    // Truncate if necessary
    const truncated =
      content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + "\n// ... truncated ..."
        : content;

    result[relPath] = truncated;
    totalChars += truncated.length;
  }

  return result;
}

// ─── Response Parsing ────────────────────────────────────────

interface RawFinding {
  title?: string;
  severity?: string;
  category?: string;
  description?: string;
  filePath?: string;
  lineNumber?: number;
  snippet?: string;
  remediation?: string;
  framework?: string;
}

interface LLMAnalysisResponse {
  findings?: RawFinding[];
  summary?: string;
  recommendation?: string;
  score?: number;
  riskLevel?: string;
}

function parseSeverity(raw: string | undefined): Severity {
  const valid: Severity[] = ["critical", "high", "medium", "low", "info"];
  const normalised = (raw ?? "medium").toLowerCase() as Severity;
  return valid.includes(normalised) ? normalised : "medium";
}

function parseRiskLevel(raw: string | undefined): Severity {
  return parseSeverity(raw);
}

function parseFindings(raw: RawFinding[]): Finding[] {
  return raw.map((f, idx) => {
    const evidence: Evidence[] = [];
    if (f.filePath) {
      evidence.push({
        filePath: f.filePath,
        lineNumber: f.lineNumber ?? undefined,
        snippet: f.snippet ?? undefined,
        description: f.description ?? "See referenced code",
      });
    }

    return {
      id: `watchdog-${idx + 1}`,
      title: f.title ?? `Finding ${idx + 1}`,
      severity: parseSeverity(f.severity),
      category: f.category ?? "Uncategorised",
      description: f.description ?? "",
      evidence,
      remediation: f.remediation,
      framework: f.framework,
    };
  });
}

function extractJSON(raw: string): string {
  // Try to find JSON object in the response (handle markdown fences)
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try raw JSON
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return raw;
}

// ─── Watchdog Analyzer ──────────────────────────────────────

export class WatchdogAnalyzer implements ExpertModule {
  readonly id = MODULE_ID;
  readonly name = META.name;
  readonly framework = META.framework;

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? getLLMRegistry().getProviderForModule(MODULE_ID);
  }

  async analyse(app: ApplicationProfile): Promise<ExpertAssessment> {
    const startTime = Date.now();

    try {
      // 1. Read source files from the cloned repository
      const repoDir = path.join(config.dataDir, "repos", app.id);
      const codeSnippets = await readKeyFiles(repoDir, app);

      // 2. Build the analysis prompt
      const userPrompt = buildWatchdogUserPrompt(app, codeSnippets);

      // 3. Send to LLM
      const response = await this.provider.complete(userPrompt, {
        systemPrompt: WATCHDOG_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 8192,
      });

      // 4. Parse the LLM response
      const jsonStr = extractJSON(response.content);
      let parsed: LLMAnalysisResponse;
      try {
        parsed = JSON.parse(jsonStr) as LLMAnalysisResponse;
      } catch {
        console.error(
          `[watchdog] Failed to parse LLM JSON response. Raw content:\n${response.content.slice(0, 500)}`,
        );
        return this.failedAssessment(
          "LLM returned unparseable response",
          response.model,
        );
      }

      // 5. Transform into ExpertAssessment
      const findings = parseFindings(parsed.findings ?? []);
      const score = typeof parsed.score === "number"
        ? Math.max(0, Math.min(100, parsed.score))
        : this.deriveScore(findings);

      return {
        moduleId: MODULE_ID,
        moduleName: this.name,
        framework: this.framework,
        status: "completed",
        score,
        riskLevel: parsed.riskLevel
          ? parseRiskLevel(parsed.riskLevel)
          : this.deriveRiskLevel(score),
        findings,
        summary: parsed.summary ?? "Watchdog analysis complete.",
        recommendation: parsed.recommendation ?? "Review findings and remediate.",
        completedAt: new Date().toISOString(),
        model: response.model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[watchdog] Analysis failed: ${message}`);
      return this.failedAssessment(message, this.provider.model);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private deriveScore(findings: Finding[]): number {
    let score = 100;
    for (const f of findings) {
      switch (f.severity) {
        case "critical": score -= 25; break;
        case "high":     score -= 15; break;
        case "medium":   score -= 8;  break;
        case "low":      score -= 3;  break;
        case "info":     score -= 1;  break;
      }
    }
    return Math.max(0, Math.min(100, score));
  }

  private deriveRiskLevel(score: number): Severity {
    if (score <= 30) return "critical";
    if (score <= 50) return "high";
    if (score <= 70) return "medium";
    if (score <= 85) return "low";
    return "info";
  }

  private failedAssessment(error: string, model: string): ExpertAssessment {
    return {
      moduleId: MODULE_ID,
      moduleName: this.name,
      framework: this.framework,
      status: "failed",
      score: 0,
      riskLevel: "critical",
      findings: [],
      summary: "Watchdog analysis failed.",
      recommendation: "Retry the analysis or check provider configuration.",
      completedAt: new Date().toISOString(),
      model,
      error,
    };
  }
}
