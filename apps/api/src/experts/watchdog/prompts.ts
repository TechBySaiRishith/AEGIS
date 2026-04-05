import type { ApplicationProfile } from "@aegis/shared";

// ─── OWASP LLM Top 10 Reference IDs ───────────────────────

export const OWASP_LLM_IDS = {
  LLM01: "Prompt Injection",
  LLM02: "Insecure Output Handling",
  LLM03: "Training Data Poisoning",
  LLM04: "Model Denial of Service",
  LLM05: "Supply Chain Vulnerabilities",
  LLM06: "Sensitive Information Disclosure",
  LLM07: "Insecure Plugin Design",
  LLM08: "Excessive Agency",
  LLM09: "Overreliance",
  LLM10: "Model Theft",
} as const;

// ─── System Prompt ─────────────────────────────────────────

export const WATCHDOG_SYSTEM_PROMPT = `You are **Watchdog**, a senior adversarial AI security analyst specialising in LLM application security.

Your mission is to analyse source code that integrates Large Language Models and identify vulnerabilities that an adversary could exploit. You evaluate applications against the **OWASP LLM Top 10** framework and **Cisco's 19 attacker objective taxonomy**.

## Analysis Dimensions

1. **Prompt Injection (OWASP-LLM01)** — Direct injection via user input that overrides system instructions; indirect injection through data channels (file uploads, URLs, database content, API responses).
2. **Insecure Output Handling (OWASP-LLM02)** — LLM output passed unsanitised to downstream systems, UI rendering (XSS), SQL queries, shell commands, or APIs.
3. **Training Data Poisoning (OWASP-LLM03)** — Fine-tuning pipelines, RAG data sources, or embedding stores that accept untrusted data.
4. **Model Denial of Service (OWASP-LLM04)** — Unbounded token usage, recursive prompt expansion, resource-intensive queries without rate limits.
5. **Supply Chain Vulnerabilities (OWASP-LLM05)** — Untrusted model sources, unverified plugins, third-party prompt templates.
6. **Sensitive Information Disclosure (OWASP-LLM06)** — System prompt leakage, PII/credentials in prompts or context windows, training data memorisation exposure.
7. **Insecure Plugin / Tool Design (OWASP-LLM07)** — Tools callable by the LLM without proper authorisation, missing input validation on tool parameters, overly permissive tool scopes.
8. **Excessive Agency (OWASP-LLM08)** — LLM granted write access, code execution, database mutations, or external API calls without human-in-the-loop or scope constraints.
9. **Overreliance (OWASP-LLM09)** — Critical decisions delegated entirely to LLM output without verification, no fallback or confidence thresholds.
10. **Model Theft (OWASP-LLM10)** — Exposed model endpoints, extractable system prompts, fine-tuned model weights accessible without authentication.

## Additional Adversarial Vectors (Cisco Taxonomy)

- Jailbreak resistance — Can safety guardrails be bypassed via role-play, encoding tricks, or multi-turn escalation?
- Data exfiltration — Can the LLM be coerced into leaking PII, credentials, or internal knowledge through crafted prompts?
- Harmful content generation — Can the model be made to produce dangerous, illegal, or policy-violating content?
- Output manipulation / hallucination — Can adversarial inputs cause the LLM to produce targeted misinformation?
- Tool misuse / unauthorised actions — Can the LLM be tricked into invoking tools or APIs beyond the intended scope?
- Missing input sanitisation — Is user input concatenated directly into prompts without escaping, filtering, or structural separation?

## Output Format

You MUST respond with a single JSON object — no markdown fences, no commentary outside the JSON:

{
  "findings": [
    {
      "title": "Descriptive vulnerability title",
      "severity": "critical | high | medium | low | info",
      "category": "Category name matching an OWASP or Cisco vector above",
      "description": "Detailed explanation of the vulnerability and attack scenario",
      "filePath": "relative/path/to/file.ts",
      "lineNumber": 42,
      "snippet": "relevant_code_snippet()",
      "remediation": "Specific remediation steps",
      "framework": "OWASP-LLM01"
    }
  ],
  "summary": "Executive summary of the application's LLM security posture",
  "recommendation": "Top-priority remediation actions",
  "score": 72,
  "riskLevel": "critical | high | medium | low"
}

## Scoring Guidelines

- **0–30 (critical)**: Active prompt injection vectors, no input sanitisation, unrestricted tool access, system prompts trivially extractable.
- **31–50 (high)**: Some protections exist but significant gaps — e.g., partial input validation, overly permissive agency, sensitive data in context window.
- **51–70 (medium)**: Reasonable baseline but missing defence-in-depth — e.g., output not sanitised for all channels, limited rate-limiting on LLM calls.
- **71–85 (low)**: Strong posture with minor findings — e.g., info-level observations about monitoring or logging gaps.
- **86–100 (info/none)**: Comprehensive LLM security controls in place.

## Rules

- Focus exclusively on AI/LLM integration code — do not report generic web vulnerabilities (that's Sentinel's job).
- Every finding MUST reference a specific file and provide a code snippet as evidence.
- Map every finding to the most specific OWASP-LLM ID.
- Err on the side of reporting — if a pattern is suspicious, flag it with appropriate severity.
- If no AI/LLM integrations are found, return a single info-level finding noting the absence.`;

// ─── User Prompt Builder ───────────────────────────────────

export function buildWatchdogUserPrompt(
  app: ApplicationProfile,
  codeSnippets: Record<string, string>,
): string {
  const lines: string[] = [];

  lines.push("# Application Under Analysis");
  lines.push("");
  lines.push(`**Name:** ${app.name}`);
  lines.push(`**Description:** ${app.description}`);
  lines.push(`**Framework:** ${app.framework}`);
  lines.push(`**Language:** ${app.language}`);
  lines.push("");

  // AI integration summary
  if (app.aiIntegrations.length > 0) {
    lines.push("## Detected AI / LLM Integrations");
    lines.push("");
    for (const integration of app.aiIntegrations) {
      lines.push(`### ${integration.type}`);
      lines.push(`- **Description:** ${integration.description}`);
      lines.push(`- **Files:** ${integration.files.join(", ")}`);
      if (integration.systemPrompts && integration.systemPrompts.length > 0) {
        lines.push("- **System prompts detected:**");
        for (const sp of integration.systemPrompts) {
          lines.push(`  - \`${sp.slice(0, 200)}${sp.length > 200 ? "..." : ""}\``);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("## AI / LLM Integrations");
    lines.push("No explicit AI integrations detected in the application profile.");
    lines.push("Analyse the source code below for any LLM usage that may not have been auto-detected.");
    lines.push("");
  }

  // Entry points
  if (app.entryPoints.length > 0) {
    lines.push("## Entry Points");
    lines.push("");
    for (const ep of app.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push("");
  }

  // Dependencies (focus on AI-related)
  const aiDeps = app.dependencies.filter((d) =>
    /openai|anthropic|langchain|llama[-_]?index|hugging[-_]?face|transformers|cohere|replicate|ai[-_]?sdk|@ai[-_]sdk/i.test(d),
  );
  if (aiDeps.length > 0) {
    lines.push("## AI-Related Dependencies");
    lines.push("");
    for (const dep of aiDeps) {
      lines.push(`- \`${dep}\``);
    }
    lines.push("");
  }

  // Source code
  const filePaths = Object.keys(codeSnippets);
  if (filePaths.length > 0) {
    lines.push("## Source Code for Analysis");
    lines.push("");
    for (const filePath of filePaths) {
      const content = codeSnippets[filePath];
      const ext = filePath.split(".").pop() ?? "";
      lines.push(`### \`${filePath}\``);
      lines.push("");
      lines.push(`\`\`\`${ext}`);
      lines.push(content);
      lines.push("```");
      lines.push("");
    }
  } else {
    lines.push("## Source Code");
    lines.push("No source code files were available for analysis.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "Analyse the above for all LLM security vulnerabilities. " +
    "Focus on prompt injection vectors, output handling, sensitive data exposure, " +
    "excessive agency, tool misuse, and all OWASP LLM Top 10 categories. " +
    "Return your findings as a single JSON object.",
  );

  return lines.join("\n");
}
