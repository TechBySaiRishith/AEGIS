import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ApplicationProfile,
  AIIntegration,
  FileNode,
} from "@aegis/shared";

// ─── Public API ──────────────────────────────────────────────

/**
 * Walk a cloned repository and produce an {@link ApplicationProfile}.
 *
 * Works for any repo — detects framework, language, dependencies,
 * AI integrations, entry points, system prompts, and file structure.
 */
export async function analyzeApplication(
  repoDir: string,
): Promise<Omit<ApplicationProfile, "id" | "inputType" | "sourceUrl" | "clonedAt">> {
  const [
    fileTree,
    { totalFiles, totalLines },
    deps,
  ] = await Promise.all([
    buildFileTree(repoDir, repoDir, 0),
    countFilesAndLines(repoDir),
    parseDependencies(repoDir),
  ]);

  const language = await detectLanguage(repoDir);
  const framework = await detectFramework(repoDir);
  const entryPoints = await findEntryPoints(repoDir);
  const aiIntegrations = await detectAIIntegrations(repoDir, deps);

  const name = path.basename(repoDir);
  const description = await readDescription(repoDir);

  return {
    name,
    description,
    framework,
    language,
    entryPoints,
    dependencies: deps,
    aiIntegrations,
    fileStructure: fileTree,
    totalFiles,
    totalLines,
  };
}

// ─── Framework Detection ─────────────────────────────────────

const FRAMEWORK_SIGNALS: Array<{
  name: string;
  requires: string[];
}> = [
  { name: "Next.js", requires: ["package.json", "next.config.js"] },
  { name: "Next.js", requires: ["package.json", "next.config.ts"] },
  { name: "Next.js", requires: ["package.json", "next.config.mjs"] },
  { name: "Flask", requires: ["requirements.txt", "app.py"] },
  { name: "Django", requires: ["manage.py", "settings.py"] },
  { name: "FastAPI", requires: ["requirements.txt", "main.py"] },
  { name: "Express", requires: ["package.json", "server.js"] },
  { name: "Express", requires: ["package.json", "server.ts"] },
  { name: "Spring Boot", requires: ["pom.xml"] },
  { name: "Spring Boot", requires: ["build.gradle"] },
  { name: "Rails", requires: ["Gemfile", "config/routes.rb"] },
  { name: "Streamlit", requires: ["requirements.txt", "streamlit_app.py"] },
];

async function detectFramework(repoDir: string): Promise<string> {
  for (const { name, requires } of FRAMEWORK_SIGNALS) {
    const hits = await Promise.all(
      requires.map((f) => exists(path.join(repoDir, f))),
    );
    if (hits.every(Boolean)) return name;
  }

  // Fallback: sniff package.json dependencies
  const pkgPath = path.join(repoDir, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      if ("next" in allDeps) return "Next.js";
      if ("express" in allDeps) return "Express";
      if ("fastify" in allDeps) return "Fastify";
      if ("hono" in allDeps) return "Hono";
      if ("react" in allDeps) return "React";
      if ("vue" in allDeps) return "Vue";
      if ("angular" in allDeps) return "Angular";
    } catch { /* ignore parse errors */ }
  }

  // Check pyproject.toml for Python frameworks
  const pyprojectPath = path.join(repoDir, "pyproject.toml");
  if (await exists(pyprojectPath)) {
    const content = await readFile(pyprojectPath, "utf-8");
    if (content.includes("fastapi")) return "FastAPI";
    if (content.includes("flask")) return "Flask";
    if (content.includes("django")) return "Django";
    if (content.includes("streamlit")) return "Streamlit";
  }

  return "unknown";
}

// ─── Language Detection ──────────────────────────────────────

const LANG_MAP: Record<string, string> = {
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
};

async function detectLanguage(repoDir: string): Promise<string> {
  const counts = new Map<string, number>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = LANG_MAP[ext];
        if (lang) {
          counts.set(lang, (counts.get(lang) ?? 0) + 1);
        }
      }
    }
  }

  await walk(repoDir);
  if (counts.size === 0) return "unknown";

  // Return language with the most files
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ─── Entry Points ────────────────────────────────────────────

const ENTRY_CANDIDATES = [
  "app.py",
  "main.py",
  "server.py",
  "index.ts",
  "index.js",
  "server.ts",
  "server.js",
  "src/index.ts",
  "src/index.js",
  "src/main.ts",
  "src/main.py",
  "src/app.py",
  "manage.py",
  "cli.py",
];

async function findEntryPoints(repoDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of ENTRY_CANDIDATES) {
    if (await exists(path.join(repoDir, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

// ─── Dependency Parsing ──────────────────────────────────────

async function parseDependencies(repoDir: string): Promise<string[]> {
  const deps = new Set<string>();

  // requirements.txt
  const reqPath = path.join(repoDir, "requirements.txt");
  if (await exists(reqPath)) {
    const content = await readFile(reqPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      // "openai>=1.0" → "openai"
      const name = trimmed.split(/[>=<!~\s\[]/)[0];
      if (name) deps.add(name.toLowerCase());
    }
  }

  // package.json
  const pkgPath = path.join(repoDir, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      for (const key of Object.keys(pkg.dependencies ?? {})) deps.add(key);
      for (const key of Object.keys(pkg.devDependencies ?? {})) deps.add(key);
    } catch { /* ignore */ }
  }

  // pyproject.toml (rough parse — grabs bracketed dependency names)
  const pyprojectPath = path.join(repoDir, "pyproject.toml");
  if (await exists(pyprojectPath)) {
    const content = await readFile(pyprojectPath, "utf-8");
    const depRegex = /^\s*"([^">=<!\s]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = depRegex.exec(content)) !== null) {
      deps.add(match[1].toLowerCase());
    }
  }

  return [...deps].sort();
}

// ─── AI Integration Detection ────────────────────────────────

const AI_PATTERNS: Array<{
  type: string;
  description: string;
  depNames: string[];
  importPatterns: RegExp[];
}> = [
  {
    type: "openai",
    description: "OpenAI API (GPT, DALL·E, Whisper, embeddings)",
    depNames: ["openai"],
    importPatterns: [/from\s+openai/i, /import\s+openai/i, /require\(["']openai["']\)/],
  },
  {
    type: "anthropic",
    description: "Anthropic Claude API",
    depNames: ["anthropic", "@anthropic-ai/sdk"],
    importPatterns: [/from\s+anthropic/i, /import\s+anthropic/i],
  },
  {
    type: "langchain",
    description: "LangChain orchestration framework",
    depNames: ["langchain", "langchain-core", "langchain-openai", "langchain-community"],
    importPatterns: [/from\s+langchain/i, /import\s+langchain/i],
  },
  {
    type: "huggingface",
    description: "Hugging Face transformers / inference",
    depNames: ["transformers", "@huggingface/inference"],
    importPatterns: [/from\s+transformers/i, /import\s+transformers/i],
  },
  {
    type: "whisper",
    description: "OpenAI Whisper speech-to-text",
    depNames: ["openai-whisper", "whisper"],
    importPatterns: [/import\s+whisper/i, /from\s+whisper/i, /whisper\.load_model/],
  },
  {
    type: "llamaindex",
    description: "LlamaIndex data framework for LLMs",
    depNames: ["llama-index", "llama_index", "llamaindex"],
    importPatterns: [/from\s+llama_index/i, /import\s+llama_index/i],
  },
  {
    type: "cohere",
    description: "Cohere API",
    depNames: ["cohere"],
    importPatterns: [/from\s+cohere/i, /import\s+cohere/i],
  },
  {
    type: "replicate",
    description: "Replicate model hosting",
    depNames: ["replicate"],
    importPatterns: [/from\s+replicate/i, /import\s+replicate/i],
  },
];

async function detectAIIntegrations(
  repoDir: string,
  deps: string[],
): Promise<AIIntegration[]> {
  const integrations: AIIntegration[] = [];
  const depsSet = new Set(deps);

  for (const pattern of AI_PATTERNS) {
    // Check dependency lists first
    const depMatch = pattern.depNames.some((d) => depsSet.has(d));

    // Scan source files for import statements
    const matchingFiles: string[] = [];
    await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
      for (const re of pattern.importPatterns) {
        if (re.test(content)) {
          matchingFiles.push(relPath);
          break;
        }
      }
    });

    if (depMatch || matchingFiles.length > 0) {
      const systemPrompts = await extractSystemPrompts(
        repoDir,
        matchingFiles,
      );

      integrations.push({
        type: pattern.type,
        description: pattern.description,
        files: matchingFiles,
        ...(systemPrompts.length > 0 ? { systemPrompts } : {}),
      });
    }
  }

  return integrations;
}

// ─── System Prompt Extraction ────────────────────────────────

const SYSTEM_PROMPT_PATTERNS: RegExp[] = [
  /system_prompt\s*=\s*(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|f?"([^"]*)"|f?'([^']*)')/g,
  /system_message\s*=\s*(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|f?"([^"]*)"|f?'([^']*)')/g,
  /["']role["']\s*:\s*["']system["']\s*,\s*["']content["']\s*:\s*["']([\s\S]*?)["']/g,
  /SystemMessage\(\s*content\s*=\s*(?:f?"""([\s\S]*?)"""|f?"([^"]*)"|f?'([^']*)')/g,
  /SYSTEM_PROMPT\s*=\s*(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|f?"([^"]*)"|f?'([^']*)')/g,
];

async function extractSystemPrompts(
  repoDir: string,
  files: string[],
): Promise<string[]> {
  const prompts = new Set<string>();

  // If specific files were flagged, scan those; otherwise scan all source files
  const targets = files.length > 0 ? files : undefined;

  async function scan(relPath: string, content: string): Promise<void> {
    for (const pattern of SYSTEM_PROMPT_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        // First non-undefined capture group is the prompt content
        const extracted = match.slice(1).find((g) => g !== undefined);
        if (extracted && extracted.trim().length > 10) {
          prompts.add(extracted.trim().slice(0, 500)); // cap length
        }
      }
    }
  }

  if (targets) {
    for (const rel of targets) {
      const full = path.join(repoDir, rel);
      try {
        const content = await readFile(full, "utf-8");
        await scan(rel, content);
      } catch { /* file might be binary or inaccessible */ }
    }
  } else {
    await scanSourceFiles(repoDir, repoDir, scan);
  }

  return [...prompts];
}

// ─── File Tree ───────────────────────────────────────────────

const MAX_TREE_DEPTH = 2;

async function buildFileTree(
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

async function countFilesAndLines(
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

const COUNTABLE_EXTS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".toml",
  ".html", ".css", ".scss", ".xml", ".sql", ".sh",
  ".env", ".cfg", ".ini", ".conf",
]);

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// ─── Source File Scanner ─────────────────────────────────────

const SOURCE_EXTS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".java", ".rb", ".go", ".rs",
]);

async function scanSourceFiles(
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

// ─── Utilities ───────────────────────────────────────────────

const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  ".next", "dist", "build", ".cache", ".tox",
  ".mypy_cache", ".pytest_cache", "coverage",
  ".idea", ".vscode",
]);

function shouldSkip(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDescription(repoDir: string): Promise<string> {
  // Try README first, then fall back to package.json description
  for (const readme of ["README.md", "README.rst", "README.txt", "README"]) {
    const readmePath = path.join(repoDir, readme);
    if (await exists(readmePath)) {
      try {
        const content = await readFile(readmePath, "utf-8");
        // Extract first non-heading, non-empty paragraph
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("=") &&
            !trimmed.startsWith("![") &&
            !trimmed.startsWith("<!--")
          ) {
            return trimmed.slice(0, 300);
          }
        }
      } catch { /* ignore */ }
    }
  }

  const pkgPath = path.join(repoDir, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      if (pkg.description) return String(pkg.description).slice(0, 300);
    } catch { /* ignore */ }
  }

  return "No description available";
}
