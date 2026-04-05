// ─── LLM Abstraction Layer ───────────────────────────────────
// Re-exports for convenient barrel imports:
//
//   import { getLLMRegistry, LLMError } from "./llm/index.js";
//

export {
  type LLMProvider,
  type CompletionOptions,
  LLMError,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  parseModelSpec,
  moduleEnvKey,
} from "./provider.js";

export { AnthropicProvider } from "./anthropic.js";
export {
  OpenAICompatProvider,
  createOpenAIProvider,
  createGitHubModelsProvider,
  createCustomProvider,
} from "./openai-compat.js";
export { CopilotProvider, isCopilotAvailable } from "./copilot.js";
export { MockProvider } from "./mock.js";
export {
  LLMRegistry,
  getLLMRegistry,
  resetLLMRegistry,
} from "./registry.js";
