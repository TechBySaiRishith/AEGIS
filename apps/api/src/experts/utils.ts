import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative, basename } from "node:path";
import { existsSync } from "node:fs";
import type { ApplicationProfile, FileNode } from "@aegis/shared";

// ═══════════════════════════════════════════════════════════════
// Shared JSON extraction — used by all expert analyzers
// ═══════════════════════════════════════════════════════════════

/**
 * Robustly extract a JSON object from an LLM response.
 *
 * Handles all common LLM output quirks:
 *  1. Markdown code fences (```json ... ```)
 *  2. Preamble / postamble text surrounding the JSON
 *  3. Multiple code fence blocks (picks the first with valid JSON)
 *  4. Trailing commas in arrays/objects
 *  5. Control characters embedded in string values
 *  6. Single-line ``` fences and variations
 */
export function extractJSON(raw: string): string {
  // 1. Try all markdown code fence blocks (greedy — pick first valid one)
  const fencePattern = /```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fencePattern.exec(raw)) !== null) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith("{") || candidate.startsWith("[")) {
      const cleaned = sanitiseJSONString(candidate);
      if (isValidJSON(cleaned)) return cleaned;
    }
  }

  // 2. No valid fenced block — find the outermost { … } pair via brace matching
  const braceJSON = extractBraceBalanced(raw);
  if (braceJSON) {
    const cleaned = sanitiseJSONString(braceJSON);
    if (isValidJSON(cleaned)) return cleaned;
  }

  // 3. Fallback: naive slice between first { and last }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const slice = raw.slice(first, last + 1);
    const cleaned = sanitiseJSONString(slice);
    if (isValidJSON(cleaned)) return cleaned;
    // Even if invalid, return it so the caller sees a parse error with context
    return cleaned;
  }

  // 4. Nothing found — return trimmed raw (caller will get a parse error)
  return raw.trim();
}

/** Use brace-depth tracking to extract the first top-level JSON object */
function extractBraceBalanced(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** Strip trailing commas before } or ] — common LLM mistake */
function sanitiseJSONString(json: string): string {
  // Remove control characters (except newlines/tabs inside strings handled by JSON)
  let cleaned = json.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  return cleaned;
}

function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_MAX_TOTAL_CHARS = 50_000;
const DEFAULT_MAX_FILE_CHARS = 15_000;
const DEFAULT_MAX_FILES = 60;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "__pycache__", ".venv",
  "venv", "dist", "build", ".cache", "coverage", ".tox",
  ".mypy_cache", ".pytest_cache", "vendor", ".turbo",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".java", ".kt", ".scala",
  ".go", ".rs", ".rb", ".cs",
  ".yaml", ".yml", ".json", ".toml",
  ".env", ".cfg", ".ini", ".conf",
  ".sql", ".graphql", ".gql",
  ".vue", ".svelte", ".astro",
  ".md", ".txt", ".rst",
]);

// ─── Types ───────────────────────────────────────────────────

/**
 * A scoring function that assigns a relevance score to a file path.
 * Higher scores = read first. Files scoring 0 are skipped unless they
 * match content-level heuristics.
 */
export type RelevanceScorer = (filePath: string, app: ApplicationProfile) => number;

export interface ReadKeyFilesOptions {
  /** Maximum total characters across all returned files (default: 50 000) */
  maxTotalChars?: number;
  /** Maximum characters per individual file (default: 15 000) */
  maxFileChars?: number;
  /** Maximum number of files to return (default: 60) */
  maxFiles?: number;
  /** Custom relevance scorer — higher values are read first */
  scorer?: RelevanceScorer;
  /** Minimum score for a file to be included (default: 0 — include everything) */
  minScore?: number;
}

// ─── Default scorer ──────────────────────────────────────────

/** Baseline scorer that gives every code file equal weight */
function defaultScorer(_filePath: string, _app: ApplicationProfile): number {
  return 1;
}

// ─── Directory walker ────────────────────────────────────────

async function walkDir(
  dir: string,
  maxDepth = 6,
  depth = 0,
): Promise<string[]> {
  if (depth > maxDepth) return [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walkDir(fullPath, maxDepth, depth + 1)));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Read key source files from a cloned repository, prioritising files
 * according to the caller-supplied relevance scorer.
 *
 * @param repoDir  Absolute path to the cloned repo root
 * @param app      The application profile produced by intake
 * @param options  Budgets and scoring configuration
 * @returns        Map of relative-path → file-content
 */
export async function readKeyFiles(
  repoDir: string,
  app: ApplicationProfile,
  options: ReadKeyFilesOptions = {},
): Promise<Record<string, string>> {
  const {
    maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
    maxFileChars = DEFAULT_MAX_FILE_CHARS,
    maxFiles = DEFAULT_MAX_FILES,
    scorer = defaultScorer,
    minScore = 0,
  } = options;

  if (!existsSync(repoDir)) return {};

  // Collect file paths from the repo tree
  const allFiles = await walkDir(repoDir);
  if (allFiles.length === 0) return {};

  // Score every file
  const scored: Array<{ absPath: string; relPath: string; score: number }> = [];
  for (const absPath of allFiles) {
    const relPath = relative(repoDir, absPath);
    const score = scorer(relPath, app);
    scored.push({ absPath, relPath, score });
  }

  // Also incorporate files from the ApplicationProfile that are already known
  const profileFiles = new Set(
    app.fileStructure
      .filter((f: FileNode) => f.type === "file")
      .map((f: FileNode) => f.path),
  );

  // Boost profile-listed files that were scored low
  for (const item of scored) {
    if (profileFiles.has(item.relPath) && item.score < 5) {
      item.score += 5;
    }
  }

  // Boost files from known AI integrations
  const aiFiles = new Set(app.aiIntegrations.flatMap((ai) => ai.files));
  for (const item of scored) {
    if (aiFiles.has(item.relPath)) item.score += 15;
  }

  // Sort by score descending, then alphabetically for determinism
  scored.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  // Read files within budget
  const result: Record<string, string> = {};
  let totalChars = 0;
  let fileCount = 0;

  for (const { absPath, relPath, score } of scored) {
    if (totalChars >= maxTotalChars || fileCount >= maxFiles) break;
    if (score < minScore) continue;

    try {
      const fileStat = await stat(absPath);
      if (fileStat.size > maxFileChars * 2) continue;

      const content = await readFile(absPath, "utf-8");
      const truncated =
        content.length > maxFileChars
          ? content.slice(0, maxFileChars) + "\n// ... truncated ..."
          : content;

      result[relPath] = truncated;
      totalChars += truncated.length;
      fileCount++;
    } catch {
      // File unreadable — skip
    }
  }

  return result;
}
