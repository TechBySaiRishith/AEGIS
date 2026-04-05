import { readFileSync } from "node:fs";
import type { LLMResponse, LLMProvider as LLMProviderType } from "@aegis/shared";
import {
  type LLMProvider,
  type CompletionOptions,
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

const TOKEN_FILE_PATH =
  "/Users/ankitdas/.local/share/copilot-api/github_token";

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
 * Priority: COPILOT_GITHUB_TOKEN > token file > GITHUB_TOKEN (if ghu_*)
 */
function resolveGitHubToken(): string | undefined {
  if (process.env.COPILOT_GITHUB_TOKEN) {
    return process.env.COPILOT_GITHUB_TOKEN;
  }

  try {
    const fileToken = readFileSync(TOKEN_FILE_PATH, "utf-8").trim();
    if (fileToken) return fileToken;
  } catch {
    // file missing — fall through
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
          body: JSON.stringify({
            model: this.model,
            messages,
            max_completion_tokens: tokenLimit,
            temperature: options?.temperature ?? 0.3,
            stream: false,
          }),
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
          await sleep(RETRY_BASE_DELAY_MS * attempt);
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
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
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
