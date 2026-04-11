import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ApplicationProfile } from "@aegis/shared";
import { LANG_MAP, shouldSkip, exists, buildFileTree, countFilesAndLines, extractCodeExcerpts } from "./patterns.js";
import { parseDependencies, detectFramework } from "./dependencies.js";
import { detectAIIntegrations, detectModels } from "./ai-detection.js";
import { detectRoutes } from "./routes.js";
import { detectSecurityProfile, detectEnvironmentVariables, detectDataHandling } from "./security.js";

// ─── Re-exports (preserve public API for existing consumers) ─

export { aggregateFileCounts } from "./patterns.js";
export { detectFrameworkFromPackageJson, detectFrameworkFromRequirementsTxt, parseRequirementsTxt } from "./dependencies.js";
export { extractAIIntegrationsFromSources } from "./ai-detection.js";

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

// ─── Language Detection ──────────────────────────────────────

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

// ─── Description ─────────────────────────────────────────────

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
