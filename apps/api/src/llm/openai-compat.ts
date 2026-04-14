import OpenAI from "openai";
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

const GITHUB_MODELS_BASE = "https://models.inference.ai.azure.com";

interface OpenAICompatConfig {
  providerId: LLMProviderType;
  displayName: string;
  model: string;
  apiKey: string;
  baseURL?: string;
}

/**
 * Shared implementation for OpenAI, GitHub Models, and custom
 * OpenAI-compatible endpoints. All three use the `openai` SDK
 * with different base URLs and API keys.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly id: LLMProviderType;
  readonly displayName: string;
  readonly model: string;

  // Allow injection in tests
  client: OpenAI | null = null;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string | undefined;

  constructor(config: OpenAICompatConfig) {
    this.id = config.providerId;
    this.displayName = config.displayName;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
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
        `${this.displayName} API key is not configured`,
        this.id,
        "auth",
      );
    }

    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.ChatCompletionMessageParam[] = [];
        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        // Newer models (GPT-5.x, o3, o4) use max_completion_tokens instead of max_tokens
        const usesNewTokenParam = /^(gpt-5|o[34])/.test(this.model);
        const tokenLimit = options?.maxTokens ?? 4096;

        const response = await Promise.race([
          this.client.chat.completions.create({
            model: this.model,
            messages,
            temperature: options?.temperature ?? 0.3,
            ...(usesNewTokenParam
              ? { max_completion_tokens: tokenLimit }
              : { max_tokens: tokenLimit }),
          }),
          timeout(DEFAULT_TIMEOUT_MS),
        ]);

        const completion = response as OpenAI.ChatCompletion;
        const content = completion.choices[0]?.message?.content ?? "";

        return {
          content,
          model: this.model,
          provider: this.id,
          usage: completion.usage
            ? {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens ?? 0,
              }
            : undefined,
        };
      } catch (err: unknown) {
        lastError = err;

        if (isAuthError(err)) {
          throw new LLMError(
            `${this.displayName} authentication failed — check your API key`,
            this.id,
            "auth",
            err,
          );
        }

        if (isTimeoutError(err)) {
          if (attempt === MAX_RETRIES) {
            throw new LLMError(
              `${this.displayName} request timed out after ${MAX_RETRIES} attempts`,
              this.id,
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
              `${this.displayName} rate limited after ${MAX_RETRIES} retries`,
              this.id,
              "rate_limit",
              err,
            );
          }
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }

        break;
      }
    }

    throw new LLMError(
      `${this.displayName} request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      this.id,
      "unknown",
      lastError,
    );
  }

  supportsVision() { return /gpt-4o|gpt-4\.1|o\d/i.test(this.model); }

  async *chatStream(messages: ChatTurn[], options?: ChatStreamOptions): AsyncIterable<ChatStreamChunk> {
    if (!this.isAvailable()) {
      throw new LLMError(`${this.displayName} API key is not configured`, this.id, "auth");
    }

    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
    }

    const mapped = messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string"
        ? m.content
        : m.content.map(p => {
            if (p.type === "text") return { type: "text", text: p.text };
            if (p.type === "image") return { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.dataBase64}` } };
            return { type: "text", text: `[File: ${p.name} (${p.mime})]` }; // PDF not natively supported by OpenAI chat — text fallback
          }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completionsAny = this.client.chat.completions as any;
    const stream = await completionsAny.stream({
      model: this.model,
      messages: mapped as never,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      stream_options: { include_usage: true },
    });

    let promptTokens = 0;
    let completionTokens = 0;
    for await (const chunk of stream as AsyncIterable<{ choices: Array<{ delta?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { delta };
      if (chunk.usage) {
        if (chunk.usage.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
        if (chunk.usage.completion_tokens) completionTokens = chunk.usage.completion_tokens;
      }
    }
    yield { done: true, tokenUsage: { prompt: promptTokens, completion: completionTokens } };
  }
}

// ─── Factory helpers ─────────────────────────────────────────

export function createOpenAIProvider(model: string): OpenAICompatProvider {
  return new OpenAICompatProvider({
    providerId: "openai",
    displayName: "OpenAI",
    model,
    apiKey: process.env.OPENAI_API_KEY ?? "",
  });
}

export function createGitHubModelsProvider(
  model: string,
): OpenAICompatProvider {
  return new OpenAICompatProvider({
    providerId: "github",
    displayName: "GitHub Models",
    model,
    apiKey: process.env.GITHUB_TOKEN ?? "",
    baseURL: GITHUB_MODELS_BASE,
  });
}

export function createCustomProvider(model: string): OpenAICompatProvider {
  return new OpenAICompatProvider({
    providerId: "custom",
    displayName: "Custom OpenAI-compatible",
    model,
    apiKey: process.env.CUSTOM_LLM_API_KEY ?? "",
    baseURL: process.env.CUSTOM_LLM_BASE_URL,
  });
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
  if (err instanceof OpenAI.AuthenticationError) return true;
  if (err instanceof Error && /401|auth|unauthorized/i.test(err.message))
    return true;
  return false;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message === "LLM_TIMEOUT";
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof Error && /429|rate.?limit/i.test(err.message))
    return true;
  return false;
}
