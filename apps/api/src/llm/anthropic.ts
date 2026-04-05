import Anthropic from "@anthropic-ai/sdk";
import type { LLMResponse, LLMProvider as LLMProviderType } from "@aegis/shared";
import {
  type LLMProvider,
  type CompletionOptions,
  LLMError,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
} from "./provider.js";

const PROVIDER_ID: LLMProviderType = "anthropic";

export class AnthropicProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = "Anthropic";
  readonly model: string;

  private client: Anthropic | null = null;
  private readonly apiKey: string | undefined;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    if (!this.isAvailable()) {
      throw new LLMError(
        "ANTHROPIC_API_KEY is not set",
        PROVIDER_ID,
        "auth",
      );
    }

    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.client.messages.create({
            model: this.model,
            max_tokens: options?.maxTokens ?? 4096,
            temperature: options?.temperature ?? 0.3,
            ...(options?.systemPrompt
              ? { system: options.systemPrompt }
              : {}),
            messages: [{ role: "user", content: prompt }],
          }),
          timeout(DEFAULT_TIMEOUT_MS),
        ]);

        // timeout() throws — if we're here we have a real response
        const msg = response as Anthropic.Message;
        const text = msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return {
          content: text,
          model: this.model,
          provider: PROVIDER_ID,
          usage: {
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
          },
        };
      } catch (err: unknown) {
        lastError = err;

        if (isAuthError(err)) {
          throw new LLMError(
            "Anthropic authentication failed — check ANTHROPIC_API_KEY",
            PROVIDER_ID,
            "auth",
            err,
          );
        }

        if (isTimeoutError(err)) {
          if (attempt === MAX_RETRIES) {
            throw new LLMError(
              `Anthropic request timed out after ${MAX_RETRIES} attempts`,
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
              `Anthropic rate limited after ${MAX_RETRIES} retries`,
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
      `Anthropic request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      PROVIDER_ID,
      "unknown",
      lastError,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError) return true;
  if (err instanceof Error && /401|auth|unauthorized/i.test(err.message))
    return true;
  return false;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message === "LLM_TIMEOUT";
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Error && /429|rate.?limit/i.test(err.message))
    return true;
  return false;
}
