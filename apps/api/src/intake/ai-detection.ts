import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AIIntegration } from "@aegis/shared";
import { exists, scanSourceFiles } from "./patterns.js";

// ─── AI Integration Patterns ─────────────────────────────────

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

// ─── Public API ──────────────────────────────────────────────

export async function detectAIIntegrations(
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

/**
 * Pure helper: extract AI integration types from a list of {path, content} source files
 * and a dependency list. Returns de-duplicated AIIntegration records (without system prompts).
 * Exported for unit tests. Mirrors the logic of {@link detectAIIntegrations} without any fs access.
 */
export function extractAIIntegrationsFromSources(
  deps: string[],
  sources: Array<{ path: string; content: string }>,
): AIIntegration[] {
  const integrations: AIIntegration[] = [];
  const depsSet = new Set(deps.map((d) => d.toLowerCase()));
  for (const pattern of AI_PATTERNS) {
    const depMatch = pattern.depNames.some((d) => depsSet.has(d.toLowerCase()));
    const matchingFiles: string[] = [];
    for (const src of sources) {
      for (const re of pattern.importPatterns) {
        // Clone regex per call to avoid lastIndex state on /g flagged regexes
        const r = new RegExp(re.source, re.flags);
        if (r.test(src.content)) {
          matchingFiles.push(src.path);
          break;
        }
      }
    }
    if (depMatch || matchingFiles.length > 0) {
      integrations.push({
        type: pattern.type,
        description: pattern.description,
        files: matchingFiles,
      });
    }
  }
  return integrations;
}

export async function detectModels(repoDir: string): Promise<string[]> {
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
