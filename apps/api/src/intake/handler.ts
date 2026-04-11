import path from "node:path";
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
    case "text":
      return handleText(request);
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

  // Normalize GitHub URL (strip trailing .git, trailing slashes)
  let repoUrl = request.source.trim();
  repoUrl = repoUrl.replace(/\/+$/, "");
  if (!repoUrl.endsWith(".git") && repoUrl.startsWith("https://github.com/")) {
    repoUrl = repoUrl + ".git";
  }

  await cloneRepo(repoUrl, repoDir);

  const analysis = await analyzeApplication(repoDir);

  // Derive a better name from the GitHub URL if possible
  const urlName = extractRepoName(request.source);

  return {
    id: evaluationId,
    inputType: "github_url",
    sourceUrl: request.source,
    clonedAt: new Date().toISOString(),
    ...analysis,
    // Use GitHub repo name if the analyzer only returned a UUID-based dir name
    ...(urlName && analysis.name !== urlName ? { name: urlName } : {}),
    // Override description if caller provided one
    ...(request.description ? { description: request.description } : {}),
  };
}

function extractRepoName(url: string): string | null {
  try {
    const cleaned = url.replace(/\.git$/, "").replace(/\/+$/, "");
    const parts = cleaned.split("/");
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
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
    // Accept inline JSON string directly — no file system reads.
    // The source field contains the raw JSON conversation payload.
    data = JSON.parse(request.source) as ConversationData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse conversation JSON: ${message}`);
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

  const sourceName = data.model ? `conversation-${model}` : "conversation";

  return {
    id,
    inputType: "conversation_json",
    sourceUrl: sourceName,
    name: sourceName,
    description: request.description ?? `Conversation log (${messages.length} messages, model: ${model})`,
    framework: "conversation",
    language: "natural_language",
    entryPoints: [],
    dependencies: [],
    aiIntegrations: [
      {
        type: aiType,
        description: `Model: ${model}`,
        files: [],
        ...(systemPrompts.length > 0 ? { systemPrompts } : {}),
      },
    ],
    fileStructure: [],
    totalFiles: 1,
    totalLines: messages.length,
  };
}

// ─── API Endpoint Handler ────────────────────────────────────

interface EndpointProbe {
  framework?: string;
  language?: string;
  detectedTech: string[];
  aiIndicators: Array<{ name: string; type: string; files: string[]; confidence: string }>;
  securityHeaders: Record<string, string>;
  routes: Array<{ method: string; path: string }>;
  openApiSpec?: string;
  serverHeader?: string;
}

async function probeEndpoint(url: string): Promise<EndpointProbe> {
  const result: EndpointProbe = {
    detectedTech: [],
    aiIndicators: [],
    securityHeaders: {},
    routes: [],
  };

  // 1. HEAD request with timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    const server = response.headers.get("server");
    const powered = response.headers.get("x-powered-by");
    if (server) {
      result.serverHeader = server;
      result.detectedTech.push(`Server: ${server}`);
    }
    if (powered) {
      result.detectedTech.push(`X-Powered-By: ${powered}`);
      if (/express/i.test(powered)) result.framework = "express";
      if (/flask|werkzeug/i.test(powered)) { result.framework = "flask"; result.language = "python"; }
      if (/next/i.test(powered)) result.framework = "next.js";
      if (/asp\.net/i.test(powered)) { result.framework = "asp.net"; result.language = "csharp"; }
    }

    // Security headers
    const secHeaderNames = [
      "strict-transport-security", "content-security-policy",
      "x-frame-options", "x-content-type-options",
      "x-xss-protection", "referrer-policy",
      "permissions-policy",
    ];
    for (const h of secHeaderNames) {
      const val = response.headers.get(h);
      if (val) result.securityHeaders[h] = val;
    }

    // CORS
    const cors = response.headers.get("access-control-allow-origin");
    if (cors) result.detectedTech.push(`CORS: ${cors}`);

    // Auth indicator
    const wwwAuth = response.headers.get("www-authenticate");
    if (wwwAuth) result.detectedTech.push(`WWW-Authenticate: ${wwwAuth}`);
  } catch {
    result.detectedTech.push("endpoint-unreachable");
  }

  // 2. Try OpenAPI/Swagger discovery
  for (const docPath of ["/openapi.json", "/swagger.json", "/api/openapi.json"]) {
    try {
      const base = new URL(url);
      base.pathname = docPath;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(base.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const text = await resp.text();
        if (text.includes('"openapi"') || text.includes('"swagger"')) {
          result.openApiSpec = text;
          try {
            const spec = JSON.parse(text);
            const paths = spec.paths ?? {};
            for (const [routePath, methods] of Object.entries(paths)) {
              for (const method of Object.keys(methods as object)) {
                if (["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) {
                  result.routes.push({ method: method.toUpperCase(), path: routePath });
                }
              }
            }
          } catch { /* malformed spec */ }
          break;
        }
      }
    } catch { /* not available */ }
  }

  return result;
}

function buildEndpointDescription(hostname: string, probe: EndpointProbe): string {
  const parts = [`Live API endpoint at ${hostname}`];
  if (probe.framework) parts.push(`detected framework: ${probe.framework}`);
  if (probe.routes.length > 0) parts.push(`${probe.routes.length} API routes discovered`);
  const missingHeaders = ["strict-transport-security", "content-security-policy", "x-frame-options"]
    .filter(h => !probe.securityHeaders[h]);
  if (missingHeaders.length > 0) parts.push(`missing security headers: ${missingHeaders.join(", ")}`);
  return parts.join(". ") + ".";
}

async function handleAPIEndpoint(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  const id = nanoid();

  let url: URL;
  try {
    url = new URL(request.source);
  } catch {
    throw new Error(`Invalid API endpoint URL: "${request.source}"`);
  }

  const hostname = url.hostname;
  const probe = await probeEndpoint(request.source);

  return {
    id,
    inputType: "api_endpoint",
    sourceUrl: request.source,
    name: request.source.length > 60 ? hostname : request.source,
    description: request.description ?? buildEndpointDescription(hostname, probe),
    framework: probe.framework ?? "api",
    language: probe.language ?? "unknown",
    entryPoints: [request.source],
    dependencies: probe.detectedTech,
    aiIntegrations: probe.aiIndicators.map(ai => ({
      type: ai.type,
      description: ai.name,
      files: ai.files,
    })),
    fileStructure: [],
    routes: probe.routes.map(r => ({ method: r.method, path: r.path, file: "openapi-spec" })),
    environmentVariables: [],
    securityHeaders: probe.securityHeaders,
    totalFiles: 0,
    totalLines: 0,
    codeExcerpts: probe.openApiSpec ? { "openapi.json": probe.openApiSpec.slice(0, 8000) } : undefined,
  };
}

// ─── Text Handler ────────────────────────────────────────────

async function handleText(
  request: EvaluateRequest,
): Promise<ApplicationProfile> {
  const id = nanoid();

  return {
    id,
    inputType: "text",
    name: request.source,
    description: request.description ?? request.source,
    framework: "unknown",
    language: "unknown",
    entryPoints: [],
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
