import path from "node:path";
import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import type {
  ApplicationProfile,
  EvaluateRequest,
  InputType,
} from "@aegis/shared";
import { config } from "../config.js";
import { cloneRepo } from "./clone.js";
import { analyzeApplication } from "./analyze.js";

/**
 * Main intake handler — accepts an {@link EvaluateRequest} and produces
 * an {@link ApplicationProfile} ready for the expert pipeline.
 */
export async function handleIntake(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  switch (request.inputType) {
    case "github_url":
      return handleGitHub(request);
    case "conversation_json":
      return handleConversationJSON(request);
    case "api_endpoint":
      return handleAPIEndpoint(request);
    default:
      throw new Error(`Unsupported input type: "${request.inputType satisfies never}"`);
  }
}

// ─── GitHub URL Handler ──────────────────────────────────────

async function handleGitHub(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  const evaluationId = nanoid();
  const repoDir = path.join(config.dataDir, "repos", evaluationId);

  await cloneRepo(request.source, repoDir);

  const analysis = await analyzeApplication(repoDir);

  return {
    id: evaluationId,
    inputType: "github_url",
    sourceUrl: request.source,
    clonedAt: new Date().toISOString(),
    ...analysis,
    // Override description if caller provided one
    ...(request.description ? { description: request.description } : {}),
  };
}

// ─── Conversation JSON Handler ───────────────────────────────

interface ConversationMessage {
  role: string;
  content: string;
}

interface ConversationData {
  model?: string;
  messages?: ConversationMessage[];
  system?: string;
  metadata?: Record<string, unknown>;
}

async function handleConversationJSON(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  const id = nanoid();

  let data: ConversationData;
  try {
    const raw = await readFile(request.source, "utf-8");
    data = JSON.parse(raw) as ConversationData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse conversation JSON at "${request.source}": ${message}`);
  }

  const messages = data.messages ?? [];
  const systemPrompts: string[] = [];

  // Extract system messages
  if (data.system) {
    systemPrompts.push(data.system);
  }
  for (const msg of messages) {
    if (msg.role === "system" && msg.content) {
      systemPrompts.push(msg.content);
    }
  }

  // Infer which AI provider from model name
  const model = data.model ?? "unknown";
  const aiType = inferProviderFromModel(model);

  return {
    id,
    inputType: "conversation_json",
    sourceUrl: request.source,
    name: path.basename(request.source, path.extname(request.source)),
    description: request.description ?? `Conversation log (${messages.length} messages, model: ${model})`,
    framework: "conversation",
    language: "natural_language",
    entryPoints: [],
    dependencies: [],
    aiIntegrations: [
      {
        type: aiType,
        description: `Model: ${model}`,
        files: [request.source],
        ...(systemPrompts.length > 0 ? { systemPrompts } : {}),
      },
    ],
    fileStructure: [
      { path: path.basename(request.source), type: "file" },
    ],
    totalFiles: 1,
    totalLines: messages.length,
  };
}

// ─── API Endpoint Handler ────────────────────────────────────

async function handleAPIEndpoint(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  const id = nanoid();

  let hostname: string;
  try {
    hostname = new URL(request.source).hostname;
  } catch {
    throw new Error(`Invalid API endpoint URL: "${request.source}"`);
  }

  return {
    id,
    inputType: "api_endpoint",
    sourceUrl: request.source,
    name: hostname,
    description: request.description ?? `Live API endpoint at ${request.source}`,
    framework: "api",
    language: "unknown",
    entryPoints: [request.source],
    dependencies: [],
    aiIntegrations: [],
    fileStructure: [],
    totalFiles: 0,
    totalLines: 0,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function inferProviderFromModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("davinci"))
    return "openai";
  if (lower.includes("claude")) return "anthropic";
  if (lower.includes("gemini") || lower.includes("palm")) return "google";
  if (lower.includes("llama") || lower.includes("mistral")) return "meta";
  if (lower.includes("command")) return "cohere";
  return "unknown";
}
