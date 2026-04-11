import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileNode } from "@aegis/shared";

// ─── Language / Extension Maps ───────────────────────────────

export const LANG_MAP: Record<string, string> = {
  ".py": "Python",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".java": "Java",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".cs": "C#",
  ".php": "PHP",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".sh": "Shell",
};

export const COUNTABLE_EXTS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".toml",
  ".html", ".css", ".scss", ".xml", ".sql", ".sh",
  ".env", ".cfg", ".ini", ".conf",
]);

export const SOURCE_EXTS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".java", ".rb", ".go", ".rs",
  ".html", ".htm", ".sh",
]);

export const TEMPLATE_EXTS = new Set([
  ".html", ".htm", ".jinja", ".jinja2", ".j2", ".ejs", ".hbs",
]);

// ─── Skip / Exists / Count Helpers ───────────────────────────

const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  ".next", "dist", "build", ".cache", ".tox",
  ".mypy_cache", ".pytest_cache", "coverage",
  ".idea", ".vscode",
]);

export function shouldSkip(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// ─── File Scanners ───────────────────────────────────────────

export async function scanSourceFiles(
  rootDir: string,
  currentDir: string,
  callback: (relPath: string, content: string) => void | Promise<void>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await scanSourceFiles(rootDir, full, callback);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTS.has(ext)) {
        try {
          const content = await readFile(full, "utf-8");
          await callback(path.relative(rootDir, full), content);
        } catch { /* binary / permission error — skip */ }
      }
    }
  }
}

export async function scanTemplateFiles(
  rootDir: string,
  callback: (relPath: string, content: string) => void | Promise<void>,
): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEMPLATE_EXTS.has(ext)) {
          try {
            const content = await readFile(full, "utf-8");
            await callback(path.relative(rootDir, full), content);
          } catch { /* skip */ }
        }
      }
    }
  }

  await walk(rootDir);
}

export async function scanAllFiles(
  rootDir: string,
  currentDir: string,
  callback: (relPath: string, fullPath: string) => void | Promise<void>,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await scanAllFiles(rootDir, full, callback);
    } else {
      await callback(path.relative(rootDir, full), full);
    }
  }
}

// ─── File Tree ───────────────────────────────────────────────

const MAX_TREE_DEPTH = 4;

export async function buildFileTree(
  rootDir: string,
  currentDir: string,
  depth: number,
): Promise<FileNode[]> {
  if (depth > MAX_TREE_DEPTH) return [];

  const entries = await readdir(currentDir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;

    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      nodes.push({ path: relPath, type: "directory" });
      if (depth < MAX_TREE_DEPTH) {
        const children = await buildFileTree(rootDir, fullPath, depth + 1);
        nodes.push(...children);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const lang = LANG_MAP[ext];
      const lines = lang ? await countLines(fullPath) : undefined;
      nodes.push({
        path: relPath,
        type: "file",
        ...(lang ? { language: lang } : {}),
        ...(lines !== undefined ? { lines } : {}),
      });
    }
  }

  return nodes;
}

// ─── File / Line Counting ────────────────────────────────────

export async function countFilesAndLines(
  dir: string,
): Promise<{ totalFiles: number; totalLines: number }> {
  let totalFiles = 0;
  let totalLines = 0;

  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        totalFiles++;
        const ext = path.extname(entry.name).toLowerCase();
        if (LANG_MAP[ext] || COUNTABLE_EXTS.has(ext)) {
          totalLines += await countLines(full);
        }
      }
    }
  }

  await walk(dir);
  return { totalFiles, totalLines };
}

/**
 * Pure helper: aggregate file and line counts from an in-memory list of
 * {name, content} entries (e.g. a simulated repo). Mirrors the behaviour of
 * {@link countFilesAndLines} without touching the filesystem.
 */
export function aggregateFileCounts(
  entries: Array<{ name: string; content: string }>,
): { totalFiles: number; totalLines: number } {
  let totalFiles = 0;
  let totalLines = 0;
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    totalFiles++;
    const ext = path.extname(entry.name).toLowerCase();
    if (LANG_MAP[ext] || COUNTABLE_EXTS.has(ext)) {
      totalLines += entry.content.split("\n").length;
    }
  }
  return { totalFiles, totalLines };
}

// ─── Code Excerpt Extraction (for large files) ───────────────

const LARGE_FILE_THRESHOLD = 20_000; // chars
const MAX_EXCERPT_SIZE = 12_000; // chars per file (reduced to fit LLM context)
const MAX_TOTAL_EXCERPTS = 30_000; // total chars across all files

/**
 * For source files that exceed the normal read limit (>20KB), extract
 * the most security- and AI-relevant sections so experts can still
 * analyze them even when the full file is too large.
 */
export async function extractCodeExcerpts(repoDir: string): Promise<Record<string, string>> {
  const excerpts: Record<string, string> = {};
  let totalChars = 0;

  await scanAllFiles(repoDir, repoDir, async (relPath, fullPath) => {
    if (totalChars >= MAX_TOTAL_EXCERPTS) return;

    const ext = path.extname(relPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) return;

    try {
      const fileStat = await stat(fullPath);
      if (fileStat.size < LARGE_FILE_THRESHOLD) return; // Small files are read normally by experts
      if (fileStat.size > 500_000) return; // Skip extremely large files

      const content = await readFile(fullPath, "utf-8");
      const sections: string[] = [];

      // Extract file header (imports, config — first 60 lines)
      const lines = content.split("\n");
      const headerEnd = Math.min(60, lines.length);
      sections.push(`# === FILE HEADER (lines 1-${headerEnd}) ===\n${lines.slice(0, headerEnd).join("\n")}`);

      // Extract route/endpoint definitions with their function bodies
      const routeSections = extractFunctionBodies(content, [
        /@app\.route\(/,
        /@\w+\.route\(/,
        /@app\.(get|post|put|delete)\(/,
      ]);
      if (routeSections.length > 0) {
        sections.push(`\n# === ROUTE HANDLERS ===\n${routeSections.join("\n\n---\n\n")}`);
      }

      // Extract AI/LLM call sections
      const aiSections = extractContextAround(content, [
        /openai/i,
        /client\.chat\.completions/i,
        /client\.audio\.transcriptions/i,
        /ChatCompletion/i,
        /system_prompt|system_message/i,
        /\.create\(/,
        /model\s*=\s*["']/,
        /\.completions\.create/,
      ], 8);
      if (aiSections.length > 0) {
        sections.push(`\n# === AI/LLM INTEGRATION CODE ===\n${aiSections.join("\n\n")}`);
      }

      // Extract security-relevant sections
      const secSections = extractContextAround(content, [
        /secret_key|SECRET_KEY/i,
        /request\.files/i,
        /file\.save\(/i,
        /secure_filename/i,
        /session\[/i,
        /app\.config/i,
        /ALLOWED_EXTENSIONS/i,
        /allowed_file/i,
        /UPLOAD_FOLDER/i,
        /debug\s*=\s*True/i,
        /os\.getenv|os\.environ/i,
      ], 5);
      if (secSections.length > 0) {
        sections.push(`\n# === SECURITY-RELEVANT CODE ===\n${secSections.join("\n\n")}`);
      }

      // Extract data handling sections
      const dataSections = extractContextAround(content, [
        /tempfile|NamedTemporaryFile/i,
        /os\.makedirs/i,
        /subprocess/i,
        /MoviePy|AudioSegment|VideoFileClip/i,
        /reportlab|PyPDF2|python-docx/i,
        /wordcloud/i,
      ], 5);
      if (dataSections.length > 0) {
        sections.push(`\n# === DATA HANDLING CODE ===\n${dataSections.join("\n\n")}`);
      }

      const excerpt = sections.join("\n\n").slice(0, MAX_EXCERPT_SIZE);
      if (excerpt.length > 200) {
        excerpts[relPath] = excerpt;
        totalChars += excerpt.length;
      }
    } catch { /* ignore read errors */ }
  });

  return excerpts;
}

/** Extract function bodies that follow lines matching trigger patterns */
function extractFunctionBodies(content: string, triggers: RegExp[]): string[] {
  const lines = content.split("\n");
  const sections: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isDecorator = triggers.some((t) => t.test(line));

    if (isDecorator) {
      // Collect decorator + function definition + body
      const start = i;
      // Skip any stacked decorators
      while (i < lines.length && lines[i].trimStart().startsWith("@")) i++;
      // Expect a function definition next
      if (i < lines.length && /^\s*(?:def|async\s+def|function|async\s+function)\s/.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        i++;
        // Capture the function body (lines with greater indent or blank)
        while (i < lines.length) {
          const currentIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
          const isBlank = lines[i].trim() === "";
          if (!isBlank && currentIndent <= indent) break;
          i++;
          // Cap individual function extracts at 60 lines
          if (i - start > 60) break;
        }
      }
      sections.push(lines.slice(start, i).join("\n"));
    } else {
      i++;
    }

    // Limit total extracted functions
    if (sections.length >= 20) break;
  }

  return sections;
}

/** Extract lines around pattern matches for context */
function extractContextAround(
  content: string,
  patterns: RegExp[],
  contextLines: number,
): string[] {
  const lines = content.split("\n");
  const matchedRanges = new Set<number>();

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        for (let j = start; j < end; j++) matchedRanges.add(j);
      }
    }
  }

  if (matchedRanges.size === 0) return [];

  // Group consecutive line numbers into ranges
  const sorted = [...matchedRanges].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= rangeEnd + 2) {
      rangeEnd = sorted[i];
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  return ranges.slice(0, 15).map(([s, e]) =>
    `# Lines ${s + 1}-${e + 1}:\n${lines.slice(s, e + 1).join("\n")}`
  );
}
