import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ApplicationProfile,
  AIIntegration,
  FileNode,
  SecurityProfile,
  RouteInfo,
  DataHandlingPattern,
} from "@aegis/shared";

// ─── Public API ──────────────────────────────────────────────

/**
 * Walk a cloned repository and produce an {@link ApplicationProfile}.
 *
 * Works for any repo — detects framework, language, dependencies,
 * AI integrations, entry points, system prompts, file structure,
 * security profile, routes, environment variables, data handling,
 * and smart code excerpts for large files.
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
  const framework = await detectFramework(repoDir, deps);
  const entryPoints = await findEntryPoints(repoDir);
  const aiIntegrations = await detectAIIntegrations(repoDir, deps);

  const name = path.basename(repoDir);
  const description = await readDescription(repoDir);

  // Deep analysis passes — run in parallel
  const [
    detectedModels,
    securityProfile,
    routes,
    environmentVariables,
    dataHandling,
    codeExcerpts,
  ] = await Promise.all([
    detectModels(repoDir),
    detectSecurityProfile(repoDir, deps),
    detectRoutes(repoDir, framework),
    detectEnvironmentVariables(repoDir),
    detectDataHandling(repoDir),
    extractCodeExcerpts(repoDir),
  ]);

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
    detectedModels,
    securityProfile,
    routes,
    environmentVariables,
    dataHandling,
    codeExcerpts,
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

async function detectFramework(repoDir: string, deps: string[]): Promise<string> {
  // Check known signal files
  for (const { name, requires } of FRAMEWORK_SIGNALS) {
    const hits = await Promise.all(
      requires.map((f) => exists(path.join(repoDir, f))),
    );
    if (hits.every(Boolean)) return name;
  }

  // Check requirements.txt content for Python frameworks
  const reqPath = path.join(repoDir, "requirements.txt");
  if (await exists(reqPath)) {
    try {
      const content = await readFile(reqPath, "utf-8");
      const lower = content.toLowerCase();
      if (lower.includes("flask")) return "Flask";
      if (lower.includes("django")) return "Django";
      if (lower.includes("fastapi")) return "FastAPI";
      if (lower.includes("streamlit")) return "Streamlit";
    } catch { /* ignore */ }
  }

  // Check dependency list for framework names
  const depsSet = new Set(deps.map((d) => d.toLowerCase()));
  if (depsSet.has("flask")) return "Flask";
  if (depsSet.has("django")) return "Django";
  if (depsSet.has("fastapi")) return "FastAPI";
  if (depsSet.has("streamlit")) return "Streamlit";

  // Scan Python files for framework imports
  let detectedFromImport = "";
  await scanSourceFiles(repoDir, repoDir, (_relPath, content) => {
    if (detectedFromImport) return;
    if (/from\s+flask\s+import|import\s+flask/i.test(content)) detectedFromImport = "Flask";
    else if (/from\s+django/i.test(content)) detectedFromImport = "Django";
    else if (/from\s+fastapi/i.test(content)) detectedFromImport = "FastAPI";
    else if (/import\s+streamlit/i.test(content)) detectedFromImport = "Streamlit";
  });
  if (detectedFromImport) return detectedFromImport;

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
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".sh": "Shell",
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
  "setup.sh",
  "finetune.py",
  "run_fine_tuning.py",
  "prepare_fine_tuning.py",
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

const MAX_TREE_DEPTH = 4;

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
  ".html", ".htm", ".sh",
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
  // Try README first — capture a rich multi-paragraph description
  for (const readme of ["README.md", "README.rst", "README.txt", "README"]) {
    const readmePath = path.join(repoDir, readme);
    if (await exists(readmePath)) {
      try {
        const content = await readFile(readmePath, "utf-8");
        const lines = content.split("\n");
        const descLines: string[] = [];
        let foundContent = false;

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip headings, badges, images, HTML comments at the top
          if (
            !trimmed ||
            trimmed.startsWith("#") ||
            trimmed.startsWith("=") ||
            trimmed.startsWith("![") ||
            trimmed.startsWith("<!--") ||
            trimmed.startsWith("[![") ||
            trimmed.startsWith("<")
          ) {
            // If we already have content, a heading signals end of intro
            if (foundContent && (trimmed.startsWith("#") || trimmed.startsWith("="))) break;
            continue;
          }

          foundContent = true;
          descLines.push(trimmed);

          // Capture up to ~800 chars for a rich description
          if (descLines.join(" ").length > 800) break;
        }

        if (descLines.length > 0) {
          return descLines.join(" ").slice(0, 1000);
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

// ─── Model Detection ─────────────────────────────────────────

const MODEL_PATTERNS: Array<{ pattern: RegExp; model: string }> = [
  { pattern: /gpt-4o-mini/gi, model: "gpt-4o-mini" },
  { pattern: /gpt-4o/gi, model: "gpt-4o" },
  { pattern: /gpt-4-turbo/gi, model: "gpt-4-turbo" },
  { pattern: /gpt-4/gi, model: "gpt-4" },
  { pattern: /gpt-3\.5-turbo/gi, model: "gpt-3.5-turbo" },
  { pattern: /o1-preview/gi, model: "o1-preview" },
  { pattern: /o1-mini/gi, model: "o1-mini" },
  { pattern: /claude-3[.-]5-sonnet/gi, model: "claude-3.5-sonnet" },
  { pattern: /claude-3-opus/gi, model: "claude-3-opus" },
  { pattern: /claude-3-sonnet/gi, model: "claude-3-sonnet" },
  { pattern: /claude-3-haiku/gi, model: "claude-3-haiku" },
  { pattern: /whisper-1/gi, model: "whisper-1" },
  { pattern: /whisper/gi, model: "whisper" },
  { pattern: /dall-e-3/gi, model: "dall-e-3" },
  { pattern: /text-embedding-ada/gi, model: "text-embedding-ada-002" },
  { pattern: /text-embedding-3/gi, model: "text-embedding-3" },
  { pattern: /gemini-pro/gi, model: "gemini-pro" },
  { pattern: /gemini-1\.5/gi, model: "gemini-1.5" },
  { pattern: /ft:gpt[^\s"'`,)}\]]+/g, model: "fine-tuned-gpt" },
];

async function detectModels(repoDir: string): Promise<string[]> {
  const models = new Set<string>();

  await scanSourceFiles(repoDir, repoDir, (_relPath, content) => {
    for (const { pattern, model } of MODEL_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        models.add(model);
      }
    }
  });

  // Also check .txt and .md files for model references
  for (const name of ["README.md", "finetune_model_id.txt", "finetune_job_id.txt"]) {
    const filePath = path.join(repoDir, name);
    if (await exists(filePath)) {
      try {
        const content = await readFile(filePath, "utf-8");
        for (const { pattern, model } of MODEL_PATTERNS) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            models.add(model);
          }
        }
        // Check for fine-tuned model references
        if (/ft:/i.test(content)) models.add("fine-tuned-model");
      } catch { /* ignore */ }
    }
  }

  return [...models].sort();
}

// ─── Security Profile Detection ──────────────────────────────

const AUTH_PATTERNS = [
  /login_required/i,
  /@login_required/i,
  /flask[_-]?login/i,
  /flask[_-]?security/i,
  /flask[_-]?jwt/i,
  /passport\.authenticate/i,
  /requireAuth/i,
  /isAuthenticated/i,
  /jwt\.verify/i,
  /auth_required/i,
  /permission_required/i,
  /from\s+django\.contrib\.auth/i,
  /Depends\(.*auth/i,
  /session\[['"]user/i,
  /@requires_auth/i,
  /flask_httpauth/i,
];

const FILE_UPLOAD_PATTERNS = [
  /request\.files/i,
  /FileField/i,
  /UploadFile/i,
  /multer/i,
  /file\.save\(/i,
  /secure_filename/i,
  /upload/i,
  /enctype.*multipart/i,
  /form.*file/i,
];

const RATE_LIMIT_PATTERNS = [
  /flask[_-]?limiter/i,
  /rate[_-]?limit/i,
  /throttle/i,
  /express[_-]?rate[_-]?limit/i,
  /slowapi/i,
  /RateLimiter/i,
];

const CSRF_PATTERNS = [
  /csrf/i,
  /CSRFProtect/i,
  /flask[_-]?wtf/i,
  /csurf/i,
  /@csrf_exempt/i,
];

const INPUT_VALIDATION_PATTERNS = [
  /wtforms/i,
  /pydantic/i,
  /marshmallow/i,
  /joi\./i,
  /zod\./i,
  /validator/i,
  /sanitize/i,
  /escape\(/i,
  /bleach/i,
];

const CORS_PATTERNS = [
  /flask[_-]?cors/i,
  /CORS\(/i,
  /cors\(/i,
  /Access-Control-Allow/i,
];

const DEBUG_PATTERNS = [
  /debug\s*=\s*True/i,
  /DEBUG\s*=\s*True/i,
  /app\.run\(.*debug\s*=\s*True/i,
  /\.env.*DEBUG/i,
];

async function detectSecurityProfile(
  repoDir: string,
  deps: string[],
): Promise<SecurityProfile> {
  const profile: SecurityProfile = {
    hasAuthentication: false,
    hasFileUpload: false,
    hasRateLimiting: false,
    hasCSRFProtection: false,
    hasInputValidation: false,
    hasCORS: false,
    debugModeEnabled: false,
    findings: [],
  };

  const depsLower = new Set(deps.map((d) => d.toLowerCase()));

  // Check deps for security libraries
  if (depsLower.has("flask-login") || depsLower.has("flask-security") ||
      depsLower.has("flask-jwt-extended") || depsLower.has("passport") ||
      depsLower.has("flask-httpauth")) {
    profile.hasAuthentication = true;
  }
  if (depsLower.has("flask-limiter") || depsLower.has("express-rate-limit") ||
      depsLower.has("slowapi")) {
    profile.hasRateLimiting = true;
  }
  if (depsLower.has("flask-wtf") || depsLower.has("csurf")) {
    profile.hasCSRFProtection = true;
  }
  if (depsLower.has("flask-cors") || depsLower.has("cors")) {
    profile.hasCORS = true;
  }

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    if (AUTH_PATTERNS.some((p) => p.test(content))) profile.hasAuthentication = true;
    if (FILE_UPLOAD_PATTERNS.some((p) => p.test(content))) profile.hasFileUpload = true;
    if (RATE_LIMIT_PATTERNS.some((p) => p.test(content))) profile.hasRateLimiting = true;
    if (CSRF_PATTERNS.some((p) => p.test(content))) profile.hasCSRFProtection = true;
    if (INPUT_VALIDATION_PATTERNS.some((p) => p.test(content))) profile.hasInputValidation = true;
    if (CORS_PATTERNS.some((p) => p.test(content))) profile.hasCORS = true;
    if (DEBUG_PATTERNS.some((p) => p.test(content))) profile.debugModeEnabled = true;
  });

  // Also check HTML templates for file upload forms
  await scanTemplateFiles(repoDir, (_relPath, content) => {
    if (/enctype\s*=\s*["']multipart\/form-data["']/i.test(content)) {
      profile.hasFileUpload = true;
    }
    if (/type\s*=\s*["']file["']/i.test(content)) {
      profile.hasFileUpload = true;
    }
  });

  // Generate findings based on what's missing
  if (!profile.hasAuthentication) {
    profile.findings.push("No authentication mechanism detected — all endpoints appear publicly accessible.");
  }
  if (profile.hasFileUpload && !profile.hasInputValidation) {
    profile.findings.push("File upload functionality detected without robust input validation library.");
  }
  if (!profile.hasRateLimiting) {
    profile.findings.push("No rate limiting detected — API endpoints may be vulnerable to abuse.");
  }
  if (!profile.hasCSRFProtection) {
    profile.findings.push("No CSRF protection detected on form submissions.");
  }
  if (profile.debugModeEnabled) {
    profile.findings.push("Debug mode appears to be enabled — exposes stack traces and internal state.");
  }
  if (!profile.hasCORS) {
    profile.findings.push("No CORS configuration detected.");
  }

  return profile;
}

// ─── Route Detection ─────────────────────────────────────────

const ROUTE_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  // Flask: @app.route("/path", methods=["GET", "POST"])
  { regex: /@app\.route\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)/g, type: "flask" },
  // Flask: @blueprint.route(...)
  { regex: /@\w+\.route\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)/g, type: "flask" },
  // FastAPI: @app.get("/path"), @app.post("/path")
  { regex: /@app\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/g, type: "fastapi" },
  // Express: app.get("/path", ...), router.post("/path", ...)
  { regex: /(?:app|router)\.(get|post|put|delete|patch|all)\(\s*["']([^"']+)["']/g, type: "express" },
];

async function detectRoutes(repoDir: string, framework: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    const lines = content.split("\n");

    for (const { regex, type } of ROUTE_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.slice(0, match.index);
        const lineNum = beforeMatch.split("\n").length;

        if (type === "flask") {
          const routePath = match[1];
          const methodsRaw = match[2];
          const methods = methodsRaw
            ? methodsRaw.replace(/["'\s]/g, "").split(",")
            : ["GET"];

          // Find the handler function name (next def line)
          for (let i = lineNum; i < Math.min(lineNum + 3, lines.length); i++) {
            const defMatch = lines[i]?.match(/def\s+(\w+)/);
            if (defMatch) {
              for (const method of methods) {
                routes.push({
                  method: method.toUpperCase(),
                  path: routePath,
                  file: relPath,
                  handler: defMatch[1],
                });
              }
              break;
            }
          }

          if (routes.length === 0 || routes[routes.length - 1].path !== routePath) {
            for (const method of methods) {
              routes.push({ method: method.toUpperCase(), path: routePath, file: relPath });
            }
          }
        } else if (type === "fastapi") {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: relPath,
          });
        } else if (type === "express") {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: relPath,
          });
        }
      }
    }
  });

  // Deduplicate routes
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${r.method}:${r.path}:${r.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Environment Variable Detection ──────────────────────────

const ENV_PATTERNS = [
  /os\.(?:environ|getenv)\(?['"]([A-Z_][A-Z0-9_]+)['"]/g,
  /process\.env\.([A-Z_][A-Z0-9_]+)/g,
  /os\.environ\[['"]([A-Z_][A-Z0-9_]+)['"]\]/g,
  /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]+)['"]/g,
];

async function detectEnvironmentVariables(repoDir: string): Promise<string[]> {
  const envVars = new Set<string>();

  // Parse .env.example / .env.sample
  for (const envFile of [".env.example", ".env.sample", ".env.template"]) {
    const envPath = path.join(repoDir, envFile);
    if (await exists(envPath)) {
      try {
        const content = await readFile(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            if (/^[A-Z_][A-Z0-9_]*$/.test(key)) envVars.add(key);
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Scan source files for env var references
  await scanSourceFiles(repoDir, repoDir, (_relPath, content) => {
    for (const pattern of ENV_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        envVars.add(match[1]);
      }
    }
  });

  return [...envVars].sort();
}

// ─── Data Handling Detection ─────────────────────────────────

async function detectDataHandling(repoDir: string): Promise<DataHandlingPattern[]> {
  const patterns: DataHandlingPattern[] = [];
  const fileUploadFiles: string[] = [];
  const mediaProcessingFiles: string[] = [];
  const databaseFiles: string[] = [];
  const piiFiles: string[] = [];
  const storageFiles: string[] = [];

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    // File upload handling
    if (/request\.files|FileField|UploadFile|multer|file\.save|secure_filename/i.test(content)) {
      fileUploadFiles.push(relPath);
    }
    // Media processing (audio, video, image)
    if (/moviepy|pydub|ffmpeg|AudioSegment|VideoFileClip|PIL|Pillow|imageio|cv2|whisper/i.test(content)) {
      mediaProcessingFiles.push(relPath);
    }
    // Database operations
    if (/sqlite|sqlalchemy|pymongo|psycopg|mysql|redis|database|\.execute\(|\.query\(/i.test(content)) {
      databaseFiles.push(relPath);
    }
    // PII/personal data handling
    if (/email|password|user_?name|phone|address|ssn|credit.?card|personal/i.test(content) &&
        /store|save|log|write|insert|upload/i.test(content)) {
      piiFiles.push(relPath);
    }
    // File storage/disk writes
    if (/tempfile|NamedTemporaryFile|open\(.*['"]w/i.test(content) ||
        /os\.makedirs|os\.path\.join.*upload/i.test(content)) {
      storageFiles.push(relPath);
    }
  });

  if (fileUploadFiles.length > 0) {
    patterns.push({
      type: "file_upload",
      description: "Application accepts file uploads from users (documents, media files). Potential vectors for malicious file injection.",
      files: [...new Set(fileUploadFiles)],
    });
  }
  if (mediaProcessingFiles.length > 0) {
    patterns.push({
      type: "media_processing",
      description: "Application processes media content (audio/video/images) using external libraries. Potential for processing of malicious media files.",
      files: [...new Set(mediaProcessingFiles)],
    });
  }
  if (databaseFiles.length > 0) {
    patterns.push({
      type: "database",
      description: "Application performs database operations. Check for SQL injection and data exposure.",
      files: [...new Set(databaseFiles)],
    });
  }
  if (piiFiles.length > 0) {
    patterns.push({
      type: "pii_handling",
      description: "Application appears to handle personally identifiable information (emails, usernames, etc.).",
      files: [...new Set(piiFiles)],
    });
  }
  if (storageFiles.length > 0) {
    patterns.push({
      type: "local_storage",
      description: "Application writes files to local disk (temporary files, uploads). Check for path traversal and cleanup.",
      files: [...new Set(storageFiles)],
    });
  }

  return patterns;
}

// ─── Code Excerpt Extraction (for large files) ───────────────

const LARGE_FILE_THRESHOLD = 20_000; // chars
const MAX_EXCERPT_SIZE = 30_000; // chars per file
const MAX_TOTAL_EXCERPTS = 80_000; // total chars across all files

/**
 * For source files that exceed the normal read limit (>20KB), extract
 * the most security- and AI-relevant sections so experts can still
 * analyze them even when the full file is too large.
 */
async function extractCodeExcerpts(repoDir: string): Promise<Record<string, string>> {
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

// ─── Template File Scanner ───────────────────────────────────

const TEMPLATE_EXTS = new Set([".html", ".htm", ".jinja", ".jinja2", ".j2", ".ejs", ".hbs"]);

async function scanTemplateFiles(
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

// ─── General File Scanner (for large file detection) ─────────

async function scanAllFiles(
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
