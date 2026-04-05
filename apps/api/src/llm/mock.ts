import type {
  LLMResponse,
  LLMProvider as LLMProviderType,
  ExpertModuleId,
} from "@aegis/shared";
import type { LLMProvider, CompletionOptions } from "./provider.js";

const PROVIDER_ID: LLMProviderType = "mock";

// ─── Per-module mock responses ───────────────────────────────
// Realistic structured text that mirrors what a real LLM analysis
// produces for each expert module.

const MOCK_RESPONSES: Record<ExpertModuleId, string> = {
  sentinel: `## Sentinel — Static Code & Dependency Analysis

### Overall Risk: MEDIUM (Score 72/100)

**Findings (4):**

1. **[HIGH] CWE-79 — Reflected XSS in /api/chat endpoint**
   - File: src/routes/chat.ts:42
   - User-supplied \`message\` parameter is interpolated into HTML response without sanitisation.
   - Remediation: Pass all dynamic values through \`DOMPurify.sanitize()\` or use a templating engine with auto-escaping.

2. **[HIGH] CWE-502 — Unsafe Deserialisation of session payload**
   - File: src/middleware/session.ts:18
   - \`JSON.parse(req.cookies.session)\` processes untrusted input. An attacker can craft a malicious payload to trigger prototype pollution.
   - Remediation: Validate with Zod schema before parsing; reject payloads > 4 KB.

3. **[MEDIUM] OWASP-LLM01 — Prompt injection surface**
   - File: src/ai/prompt-builder.ts:55
   - System prompt is concatenated with user input using plain string interpolation. No delimiter or input-encoding boundary exists.
   - Remediation: Use structured message arrays, not concatenation. Wrap user content in explicit <user_input> delimiters and instruct the model to treat them as untrusted.

4. **[LOW] Outdated dependency — langchain 0.0.154**
   - Known CVE-2024-XXXX with CVSS 6.1 in recursive document loader.
   - Remediation: Upgrade to langchain >= 0.1.0.

**Recommendation:** Address the two HIGH findings before any production deployment. The prompt injection surface should be redesigned during the next sprint.`,

  watchdog: `## Watchdog — AI / LLM Threat Analysis (OWASP LLM Top 10)

### Overall Risk: HIGH (Score 58/100)

**Findings (5):**

1. **[CRITICAL] LLM01 — Prompt Injection via system prompt override**
   - The application concatenates user input directly into the system prompt at src/ai/agent.ts:30.
   - An adversary can inject "Ignore previous instructions…" to override safety guardrails.
   - Evidence: The string \`\${systemPrompt}\\n\\nUser: \${userMessage}\` has no sandboxing.
   - Remediation: Move to OpenAI's structured message format. Apply an input classifier to detect injection attempts before LLM invocation.

2. **[HIGH] LLM02 — Insecure Output Handling**
   - LLM responses are rendered via \`dangerouslySetInnerHTML\` in the React frontend (src/components/ChatBubble.tsx:12).
   - Any markup the model returns is executed in the user's browser.
   - Remediation: Render LLM output as plain text or sanitise with DOMPurify.

3. **[HIGH] LLM06 — Excessive Agency**
   - The agent has tool access to \`exec()\` (src/tools/shell.ts) with no allow-list.
   - Remediation: Restrict to a curated set of tools; require human-in-the-loop for shell commands.

4. **[MEDIUM] LLM05 — Supply Chain — Unverified model weights**
   - Model loaded from Hugging Face Hub without SHA-256 checksum verification.
   - Remediation: Pin model revision hashes in config.

5. **[MEDIUM] LLM09 — Over-reliance indicators**
   - No confidence calibration or disclaimer is surfaced when the model's response certainty is low.
   - Remediation: Implement confidence scoring and show uncertainty indicators in the UI.

**Recommendation:** The critical prompt injection finding is exploitable today. Remediate before exposing the application to external users. The excessive agency issue compounds the risk — a successful injection can trigger shell execution.`,

  guardian: `## Guardian — Governance & Compliance (NIST AI RMF)

### Overall Risk: MEDIUM (Score 68/100)

**Findings (4):**

1. **[HIGH] NIST MAP-1.1 — No documented intended use scope**
   - The application lacks a Model Card or system-level documentation describing the AI system's purpose, limitations, and out-of-scope uses.
   - Remediation: Create a MODEL_CARD.md covering intended users, use cases, known limitations, and ethical considerations per NIST MAP-1.1 / MAP-1.5.

2. **[HIGH] NIST MEASURE-2.6 — No bias evaluation process**
   - There is no evidence of fairness testing or bias evaluation across protected demographics.
   - Remediation: Implement a bias evaluation pipeline using Fairlearn or AIF360. Document results in periodic audit reports.

3. **[MEDIUM] NIST GOVERN-1.2 — Missing AI risk management policy**
   - No organizational policy document governs AI risk acceptance thresholds, incident response, or escalation procedures.
   - Remediation: Draft an AI Risk Management Policy aligned to NIST AI 600-1, assigning roles for risk acceptance and override authority.

4. **[MEDIUM] NIST MANAGE-2.2 — No human override mechanism**
   - The autonomous agent pipeline has no "kill switch" or human-in-the-loop escalation for high-stakes decisions.
   - Remediation: Add a circuit-breaker middleware that pauses execution and notifies an operator when risk scores exceed a configurable threshold.

**Recommendation:** Governance gaps do not block initial deployment but must be addressed before any SOC 2 or ISO 42001 audit. The lack of bias evaluation is the highest-priority governance item.`,
};

// Generic fallback for prompts that aren't module-specific
const GENERIC_MOCK =
  "This is a mock LLM response. In production this would contain the model's analysis based on the provided prompt and system instructions.";

export class MockProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = "Mock (no API calls)";
  readonly model = "mock-v1";

  isAvailable(): boolean {
    return true;
  }

  async complete(
    prompt: string,
    _options?: CompletionOptions,
  ): Promise<LLMResponse> {
    // Simulate a small network delay so callers behave realistically
    await new Promise((r) => setTimeout(r, 50));

    const content = this.resolveResponse(prompt);

    return {
      content,
      model: this.model,
      provider: PROVIDER_ID,
      usage: {
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(content.length / 4),
      },
    };
  }

  /** Pick a module-specific canned response based on prompt keywords */
  private resolveResponse(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes("sentinel") || lower.includes("static analysis") || lower.includes("cwe"))
      return MOCK_RESPONSES.sentinel;
    if (lower.includes("watchdog") || lower.includes("llm threat") || lower.includes("owasp llm"))
      return MOCK_RESPONSES.watchdog;
    if (lower.includes("guardian") || lower.includes("governance") || lower.includes("nist"))
      return MOCK_RESPONSES.guardian;
    return GENERIC_MOCK;
  }

  /** Direct access to mock responses for tests */
  static getModuleResponse(moduleId: ExpertModuleId): string {
    return MOCK_RESPONSES[moduleId];
  }
}
