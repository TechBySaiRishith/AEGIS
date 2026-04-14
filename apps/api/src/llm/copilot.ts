import type { LLMResponse, LLMProvider as LLMProviderType } from "@aegis/shared";
import {
  type LLMProvider,
  type CompletionOptions,
  type ChatTurn,
  type ChatStreamOptions,
  type ChatStreamChunk,
  LLMError,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
} from "./provider.js";

const PROVIDER_ID: LLMProviderType = "copilot";

const COPILOT_TOKEN_URL =
  "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL =
  "https://api.githubcopilot.com/chat/completions";

const EDITOR_VERSION = "vscode/1.96.0";
const EDITOR_PLUGIN_VERSION = "copilot-chat/0.24.2";
const INTEGRATION_ID = "vscode-chat";

// Refresh 60 s before actual expiry to avoid races
const TOKEN_REFRESH_BUFFER_S = 60;

interface CopilotToken {
  token: string;
  expiresAt: number; // epoch seconds
}

/**
 * Resolve the long-lived GitHub OAuth token (`ghu_*`) used to obtain
 * short-lived Copilot session tokens.
 *
 * Priority: COPILOT_GITHUB_TOKEN > GITHUB_TOKEN (if ghu_*)
 */
function resolveGitHubToken(): string | undefined {
  if (process.env.COPILOT_GITHUB_TOKEN) {
    return process.env.COPILOT_GITHUB_TOKEN;
  }

  const gh = process.env.GITHUB_TOKEN;
  if (gh?.startsWith("ghu_")) return gh;

  return undefined;
}

/**
 * LLM provider that talks to GitHub Copilot's chat completion endpoint.
 *
 * Uses native `fetch` — no extra dependencies.
 */
export class CopilotProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = "GitHub Copilot";
  readonly model: string;

  private readonly githubToken: string | undefined;
  private cachedToken: CopilotToken | null = null;

  constructor(model: string) {
    this.model = model;
    this.githubToken = resolveGitHubToken();
  }

  isAvailable(): boolean {
    return !!this.githubToken;
  }

  async complete(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    if (!this.isAvailable()) {
      throw new LLMError(
        "Copilot GitHub token is not configured — set COPILOT_GITHUB_TOKEN or place a token in the token file",
        PROVIDER_ID,
        "auth",
      );
    }

    const copilotToken = await this.getCopilotToken();

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: Array<{ role: string; content: string }> = [];
        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const tokenLimit = options?.maxTokens ?? 4096;

        // Guard: truncate user message if serialized body exceeds API limit.
        // Copilot API rejects requests with "Too many parameter values" when
        // the body is too large.  JSON-encoding of code with escapes can
        // easily 2× the raw character count.
        const MAX_BODY_BYTES = 80_000;

        let requestBody = JSON.stringify({
          model: this.model,
          messages,
          max_completion_tokens: tokenLimit,
          temperature: options?.temperature ?? 0.3,
          stream: false,
        });

        if (requestBody.length > MAX_BODY_BYTES) {
          const userMsg = messages[messages.length - 1];
          if (userMsg?.role === "user") {
            const excess = requestBody.length - MAX_BODY_BYTES;
            const trimTo = Math.max(500, userMsg.content.length - excess - 2000);
            console.warn(
              `[copilot] Body ${requestBody.length} bytes exceeds ${MAX_BODY_BYTES} limit — trimming user message from ${userMsg.content.length} to ${trimTo} chars`,
            );
            userMsg.content =
              userMsg.content.slice(0, trimTo) +
              "\n\n[Content truncated to fit API limits — analyse what is provided above]";
            requestBody = JSON.stringify({
              model: this.model,
              messages,
              max_completion_tokens: tokenLimit,
              temperature: options?.temperature ?? 0.3,
              stream: false,
            });
          }
        }

        console.log(
          `[copilot] Request body: ${requestBody.length} bytes, model: ${this.model}`,
        );

        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          DEFAULT_TIMEOUT_MS,
        );

        const res = await fetch(COPILOT_CHAT_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${copilotToken}`,
            "Content-Type": "application/json",
            "Editor-Version": EDITOR_VERSION,
            "Copilot-Integration-Id": INTEGRATION_ID,
          },
          body: requestBody,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            throw new LLMError(
              `Copilot authentication failed (${res.status}): ${body}`,
              PROVIDER_ID,
              "auth",
            );
          }
          if (res.status === 429) {
            throw Object.assign(new Error(`Rate limited: ${body}`), {
              status: 429,
            });
          }
          throw new Error(
            `Copilot API error ${res.status}: ${body}`,
          );
        }

        const json = (await res.json()) as {
          choices: Array<{
            message?: { content?: string };
          }>;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
          };
        };

        const content = json.choices?.[0]?.message?.content ?? "";

        return {
          content,
          model: this.model,
          provider: PROVIDER_ID,
          usage: json.usage
            ? {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens ?? 0,
              }
            : undefined,
        };
      } catch (err: unknown) {
        lastError = err;

        if (err instanceof LLMError && err.code === "auth") throw err;

        if (isAbortError(err)) {
          if (attempt === MAX_RETRIES) {
            throw new LLMError(
              `Copilot request timed out after ${MAX_RETRIES} attempts`,
              PROVIDER_ID,
              "timeout",
              err,
            );
          }
          // Exponential backoff: 5s, 15s, 45s
          await sleep(RETRY_BASE_DELAY_MS * 3 ** (attempt - 1));
          continue;
        }

        if (isRateLimitError(err)) {
          if (attempt === MAX_RETRIES) {
            throw new LLMError(
              `Copilot rate limited after ${MAX_RETRIES} retries`,
              PROVIDER_ID,
              "rate_limit",
              err,
            );
          }
          // Exponential backoff: 5s, 15s, 45s
          await sleep(RETRY_BASE_DELAY_MS * 3 ** (attempt - 1));
          continue;
        }

        // Unknown error — don't retry
        break;
      }
    }

    throw new LLMError(
      `Copilot request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      PROVIDER_ID,
      "unknown",
      lastError,
    );
  }

  supportsVision(): boolean {
    return /claude|gpt-4o|gpt-4\.1/i.test(this.model);
  }

  async *chatStream(
    messages: ChatTurn[],
    options?: ChatStreamOptions,
  ): AsyncIterable<ChatStreamChunk> {
    if (!this.isAvailable()) {
      throw new LLMError(
        "Copilot GitHub token is not configured",
        PROVIDER_ID,
        "auth",
      );
    }

    const copilotToken = await this.getCopilotToken();

    const mapped = messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) => {
              if (p.type === "text") return { type: "text", text: p.text };
              if (p.type === "image")
                return {
                  type: "image_url",
                  image_url: { url: `data:${p.mime};base64,${p.dataBase64}` },
                };
              return { type: "text", text: `[File: ${p.name} (${p.mime})]` };
            }),
    }));

    const body = JSON.stringify({
      model: this.model,
      messages: mapped,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.3,
      stream: true,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let res: Response;
    try {
      res = await fetch(COPILOT_CHAT_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${copilotToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Editor-Version": EDITOR_VERSION,
          "Copilot-Integration-Id": INTEGRATION_ID,
        },
        body,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new LLMError(
        `Copilot chatStream request failed: ${err instanceof Error ? err.message : String(err)}`,
        PROVIDER_ID,
        isAbortError(err) ? "timeout" : "unknown",
        err,
      );
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      const text = await res.text().catch(() => "");
      throw new LLMError(
        `Copilot chatStream error ${res.status}: ${text}`,
        PROVIDER_ID,
        res.status === 401 || res.status === 403 ? "auth" : "unknown",
      );
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        let sepIdx;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const chunk = JSON.parse(data) as {
                choices?: Array<{
                  delta?: { content?: string };
                  finish_reason?: string | null;
                }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                };
              };
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) yield { delta };
              if (chunk.usage) {
                if (chunk.usage.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
                if (chunk.usage.completion_tokens) completionTokens = chunk.usage.completion_tokens;
              }
            } catch {
              // Ignore malformed SSE frames
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }

    yield { done: true, tokenUsage: { prompt: promptTokens, completion: completionTokens } };
  }

  // ─── Token management ────────────────────────────────────

  private async getCopilotToken(): Promise<string> {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_S >
        Math.floor(Date.now() / 1000)
    ) {
      return this.cachedToken.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(COPILOT_TOKEN_URL, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Authorization: `token ${this.githubToken}`,
          "Editor-Version": EDITOR_VERSION,
          "Editor-Plugin-Version": EDITOR_PLUGIN_VERSION,
          Accept: "application/json",
        },
      });

      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LLMError(
          `Failed to exchange Copilot token (${res.status}): ${body}`,
          PROVIDER_ID,
          "auth",
        );
      }

      const json = (await res.json()) as {
        token: string;
        expires_at: number;
      };

      this.cachedToken = {
        token: json.token,
        expiresAt: json.expires_at,
      };

      return this.cachedToken.token;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof LLMError) throw err;
      throw new LLMError(
        `Copilot token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
        PROVIDER_ID,
        "auth",
        err,
      );
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err instanceof Error && err.message === "LLM_TIMEOUT") return true;
  return false;
}

function isRateLimitError(err: unknown): boolean {
  if (
    err instanceof Error &&
    "status" in err &&
    (err as { status: number }).status === 429
  )
    return true;
  if (err instanceof Error && /429|rate.?limit/i.test(err.message))
    return true;
  return false;
}

/** Check whether a Copilot GitHub token is available (for registry detection) */
export function isCopilotAvailable(): boolean {
  return !!resolveGitHubToken();
}
