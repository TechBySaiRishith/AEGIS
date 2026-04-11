import { readFile } from "node:fs/promises";
import path from "node:path";
import { exists, scanSourceFiles } from "./patterns.js";

// ─── Dependency Parsing ──────────────────────────────────────

export async function parseDependencies(repoDir: string): Promise<string[]> {
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

/**
 * Pure helper: parse a requirements.txt text blob into a list of dependency names.
 * Strips version specifiers, comments, and extras. Exported for unit tests.
 */
export function parseRequirementsTxt(content: string): string[] {
  const deps: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[>=<!~\s\[]/)[0];
    if (name) deps.push(name.toLowerCase());
  }
  return deps;
}

// ─── Framework Detection ─────────────────────────────────────

/**
 * Pure helper: detect a JS/TS framework from a parsed package.json object.
 * Returns null if no recognised framework is found. Exported for unit tests.
 */
export function detectFrameworkFromPackageJson(pkg: unknown): string | null {
  if (!pkg || typeof pkg !== "object") return null;
  const p = pkg as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  const allDeps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
  if ("next" in allDeps) return "Next.js";
  if ("express" in allDeps) return "Express";
  if ("fastify" in allDeps) return "Fastify";
  if ("hono" in allDeps) return "Hono";
  if ("react" in allDeps) return "React";
  if ("vue" in allDeps) return "Vue";
  if ("angular" in allDeps) return "Angular";
  return null;
}

/**
 * Pure helper: detect a Python framework from the raw text of a requirements.txt file.
 * Returns null if no recognised framework is found. Exported for unit tests.
 */
export function detectFrameworkFromRequirementsTxt(content: string): string | null {
  const lower = content.toLowerCase();
  if (lower.includes("flask")) return "Flask";
  if (lower.includes("django")) return "Django";
  if (lower.includes("fastapi")) return "FastAPI";
  if (lower.includes("streamlit")) return "Streamlit";
  return null;
}

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

export async function detectFramework(repoDir: string, deps: string[]): Promise<string> {
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
