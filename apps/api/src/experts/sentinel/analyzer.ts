import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import type {
  ApplicationProfile,
  ExpertAssessment,
  Finding,
  Evidence,
  Severity,
} from "@aegis/shared";
import { EXPERT_MODULES } from "@aegis/shared";

import type { LLMProvider } from "../../llm/provider.js";
import type { ExpertModule } from "../base.js";
import { config } from "../../config.js";
import { extractJSON, truncateProfile, capPromptSize } from "../utils.js";
import { SENTINEL_SYSTEM_PROMPT, buildSentinelUserPrompt } from "./prompts.js";

// ─── Constants ───────────────────────────────────────────────

const MODULE_META = EXPERT_MODULES.sentinel;
const MAX_CODE_BYTES = 30 * 1024; // 30 KB — leaves room for profile data + excerpts
const MAX_INDIVIDUAL_FILE = 15_000; // 15 KB per file

/** Extensions we consider analysable source code */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".php", ".cs", ".c", ".cpp", ".h", ".hpp",
  ".vue", ".svelte", ".astro",
  ".sql", ".graphql", ".gql",
  ".html", ".htm", ".sh",
]);

/** Config / manifest files worth reading regardless of extension */
const CONFIG_PATTERNS = [
  "package.json", "pyproject.toml", "requirements.txt", "Pipfile",
  "Gemfile", "go.mod", "Cargo.toml", "pom.xml", "build.gradle",
  ".env.example", ".env.sample",
  "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
  "next.config.js", "next.config.mjs", "next.config.ts",
  "vite.config.ts", "vite.config.js",
  "tsconfig.json", "webpack.config.js",
  "nginx.conf", "settings.py", "config.py", "config.ts", "config.js",
];

// ─── File-reading helpers ────────────────────────────────────

/**
 * Read key source files from a cloned repo, returning a map of
 * relative-path → file-content.  Stays within MAX_CODE_BYTES total.
 */
async function readKeyFiles(
  app: ApplicationProfile,
  repoDir: string,
): Promise<Record<string, string>> {
  const snippets: Record<string, string> = {};
  let totalBytes = 0;

  if (!existsSync(repoDir)) {
    return snippets;
  }

  // Build a prioritised list of files to read
  const prioritised = buildPriorityList(app);

  // Also discover files from the repo tree up to 5 levels deep
  const discovered = await discoverFiles(repoDir, 5);

  // Merge: prioritised first, then discovered (de-duped)
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const f of [...prioritised, ...discovered]) {
    if (!seen.has(f)) {
      seen.add(f);
      ordered.push(f);
    }
  }

  for (const relPath of ordered) {
    if (totalBytes >= MAX_CODE_BYTES) break;

    const absPath = join(repoDir, relPath);
    try {
      const info = await stat(absPath);
      if (!info.isFile()) continue;
      // Skip extremely large files (> 40 KB) — code excerpts handle these
      if (info.size > MAX_INDIVIDUAL_FILE) continue;

      const content = await readFile(absPath, "utf-8");
      const trimmed = content.slice(0, MAX_CODE_BYTES - totalBytes);
      snippets[relPath] = trimmed;
      totalBytes += trimmed.length;
    } catch {
      // File not accessible — skip silently
    }
  }

  return snippets;
}

/** Build a priority-ordered list of files from the ApplicationProfile */
function buildPriorityList(app: ApplicationProfile): string[] {
  const files: string[] = [];

  // 1. Entry points (highest priority)
  files.push(...app.entryPoints);

  // 2. Files containing AI integrations
  for (const ai of app.aiIntegrations) {
    files.push(...ai.files);
  }

  // 3. Config files from the file structure
  for (const node of app.fileStructure) {
    if (node.type !== "file") continue;
    const basename = node.path.split("/").pop() ?? "";
    if (CONFIG_PATTERNS.includes(basename)) {
      files.push(node.path);
    }
  }

  // 4. Source files from file structure (prefer smaller files first)
  const sourceFiles = app.fileStructure
    .filter(
      (n) =>
        n.type === "file" &&
        SOURCE_EXTENSIONS.has(extname(n.path)) &&
        !files.includes(n.path),
    )
    .sort((a, b) => (a.lines ?? Infinity) - (b.lines ?? Infinity));

  files.push(...sourceFiles.map((n) => n.path));

  return files;
}

/** Walk a directory tree up to `depth` levels and return relative paths */
async function discoverFiles(
  root: string,
  depth: number,
  prefix = "",
): Promise<string[]> {
  if (depth < 0) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(join(root, prefix));
  } catch {
    return results;
  }

  for (const entry of entries) {
    // Skip hidden dirs, node_modules, __pycache__, .git, dist, build
    if (
      entry.startsWith(".") ||
      entry === "node_modules" ||
      entry === "__pycache__" ||
      entry === "dist" ||
      entry === "build" ||
      entry === ".git" ||
      entry === "venv" ||
      entry === ".venv"
    ) {
      continue;
    }

    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const absPath = join(root, relPath);

    try {
      const info = await stat(absPath);
      if (info.isDirectory()) {
        const children = await discoverFiles(root, depth - 1, relPath);
        results.push(...children);
      } else if (info.isFile()) {
        const ext = extname(entry);
        const basename = entry;
        if (SOURCE_EXTENSIONS.has(ext) || CONFIG_PATTERNS.includes(basename)) {
          results.push(relPath);
        }
      }
    } catch {
      // Skip inaccessible entries
    }
  }

  return results;
}

// ─── LLM response parsing ────────────────────────────────────

interface LLMFinding {
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

interface LLMAnalysisResult {
  findings?: LLMFinding[];
  summary?: string;
  recommendation?: string;
  score?: number;
  riskLevel?: string;
}

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

function parseSeverity(raw: unknown): Severity {
  if (typeof raw === "string" && VALID_SEVERITIES.includes(raw as Severity)) {
    return raw as Severity;
  }
  return "medium";
}

function parseRiskLevel(raw: unknown): Severity {
  return parseSeverity(raw);
}

/** Convert the raw LLM JSON into typed Finding[] */
function parseFindings(raw: LLMFinding[]): Finding[] {
  return raw.map((f, i) => {
    const evidence: Evidence[] = [];

    if (f.filePath) {
      evidence.push({
        filePath: f.filePath,
        lineNumber: typeof f.lineNumber === "number" ? f.lineNumber : undefined,
        snippet: f.snippet ?? undefined,
        description: f.description ?? "See referenced code",
      });
    }

    return {
      id: `sentinel-${i + 1}-${randomUUID().slice(0, 8)}`,
      title: f.title ?? `Finding ${i + 1}`,
      severity: parseSeverity(f.severity),
      category: f.category ?? "General",
      description: f.description ?? "",
      evidence,
      remediation: f.remediation,
      framework: f.framework,
    };
  });
}

/** Compute a score from findings — matches Sentinel's security-domain rubric */
function computeScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    switch (f.severity) {
      case "critical": score -= 20; break;
      case "high":     score -= 12; break;
      case "medium":   score -= 5;  break;
      case "low":      score -= 2;  break;
      // info: no deduction
    }
  }
  return Math.max(0, Math.min(100, score));
}

/** Determine risk level from findings */
function deriveRiskLevel(findings: Finding[]): Severity {
  const severities = new Set(findings.map((f) => f.severity));
  if (severities.has("critical")) return "critical";
  if (severities.has("high")) return "high";
  if (severities.has("medium")) return "medium";
  if (severities.has("low")) return "low";
  return "info";
}

// ─── Sentinel Analyzer ───────────────────────────────────────

export class SentinelAnalyzer implements ExpertModule {
  readonly id = "sentinel" as const;
  readonly name = MODULE_META.name;

  async analyze(
    app: ApplicationProfile,
    llm: LLMProvider,
  ): Promise<ExpertAssessment> {
    const startedAt = Date.now();

    try {
      // 1. Read source files from the cloned repo
      const repoDir = join(config.dataDir, "repos", app.id);
      const codeSnippets = await readKeyFiles(app, repoDir);

      // 2. Truncate profile to prevent payload overflow
      const safeApp = truncateProfile(app);

      // 3. Build prompt (capped to safe size)
      const rawPrompt = buildSentinelUserPrompt(safeApp, codeSnippets);
      const userPrompt = capPromptSize(rawPrompt);

      // 4. Call LLM
      const response = await llm.complete(userPrompt, {
        systemPrompt: SENTINEL_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 4096,
      });

      // 5. Parse response
      const jsonStr = extractJSON(response.content);
      let parsed: LLMAnalysisResult;
      try {
        parsed = JSON.parse(jsonStr) as LLMAnalysisResult;
      } catch {
        // LLM returned non-JSON — wrap in a single finding
        return this.buildErrorAssessment(
          llm.model,
          `LLM returned unparseable response. Raw output (truncated): ${response.content.slice(0, 300)}`,
        );
      }

      // 6. Convert to typed structures
      const findings = parseFindings(parsed.findings ?? []);
      const score =
        typeof parsed.score === "number"
          ? Math.max(0, Math.min(100, parsed.score))
          : computeScore(findings);
      const riskLevel = parsed.riskLevel
        ? parseRiskLevel(parsed.riskLevel)
        : deriveRiskLevel(findings);

      return {
        moduleId: "sentinel",
        moduleName: this.name,
        framework: MODULE_META.framework,
        status: "completed",
        score,
        riskLevel,
        findings,
        summary: parsed.summary ?? "Security analysis completed.",
        recommendation:
          parsed.recommendation ?? "Review findings and apply recommended remediations.",
        completedAt: new Date().toISOString(),
        model: llm.model,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return this.buildErrorAssessment(llm.model, message);
    }
  }

  private buildErrorAssessment(
    model: string,
    errorMessage: string,
  ): ExpertAssessment {
    return {
      moduleId: "sentinel",
      moduleName: this.name,
      framework: MODULE_META.framework,
      status: "failed",
      score: 0,
      riskLevel: "info",
      findings: [],
      summary: "Sentinel analysis failed.",
      recommendation: "Retry the analysis or check LLM provider configuration.",
      completedAt: new Date().toISOString(),
      model,
      error: errorMessage,
    };
  }
}
