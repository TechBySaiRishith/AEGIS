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
  sentinel: JSON.stringify({
    findings: [
      {
        title: "Hardcoded OpenAI API key in source code",
        severity: "critical",
        category: "Secrets Management",
        description:
          "The GPT-4o API key is hardcoded as a string literal in config.py rather than loaded from environment variables or a secrets manager. This exposes the key in version control history.",
        filePath: "config.py",
        lineNumber: 12,
        snippet: "OPENAI_API_KEY = 'sk-proj-abc123...'",
        remediation:
          "Move all secrets to environment variables or a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault). Use: os.environ['OPENAI_API_KEY'].",
        framework: "CWE-798",
      },
      {
        title: "Reflected XSS in /api/verify endpoint",
        severity: "high",
        category: "Input Validation",
        description:
          "User-supplied media URL parameter is interpolated into the HTML response at app.py:87 without sanitisation, allowing reflected cross-site scripting.",
        filePath: "app.py",
        lineNumber: 87,
        snippet: "return f'<div>Result for {request.args[\"url\"]}</div>'",
        remediation:
          "Use Jinja2 auto-escaping or pass all dynamic values through markupsafe.escape() before rendering.",
        framework: "CWE-79",
      },
      {
        title: "Flask debug mode enabled in production configuration",
        severity: "high",
        category: "Security Misconfiguration",
        description:
          "app.run(debug=True) is set in the main entry point. Debug mode exposes the Werkzeug interactive debugger, which allows arbitrary code execution on the server.",
        filePath: "app.py",
        lineNumber: 142,
        snippet: "app.run(host='0.0.0.0', port=5000, debug=True)",
        remediation:
          "Set debug=False and control via environment variable: app.run(debug=os.getenv('FLASK_DEBUG', 'false').lower() == 'true').",
        framework: "CWE-489",
      },
      {
        title: "Outdated Flask version with known CVE",
        severity: "medium",
        category: "Dependency Management",
        description:
          "Flask 2.0.1 is pinned in requirements.txt. This version is affected by CVE-2023-30861 (session cookie handling vulnerability, CVSS 7.5).",
        filePath: "requirements.txt",
        lineNumber: 3,
        snippet: "Flask==2.0.1",
        remediation:
          "Upgrade to Flask >= 2.3.2 which patches CVE-2023-30861.",
        framework: "CWE-1104",
      },
    ],
    summary:
      "The VeriMedia Flask application has critical secrets management issues and high-severity input validation gaps. The hardcoded API key and enabled debug mode represent the most urgent risks requiring immediate remediation before any production deployment.",
    recommendation:
      "Immediately rotate the exposed OpenAI API key, move all secrets to environment variables, disable Flask debug mode, and upgrade Flask to patch the known CVE.",
    score: 35,
    riskLevel: "high",
  }),

  watchdog: JSON.stringify({
    findings: [
      {
        title: "Direct prompt injection via unescaped user input to GPT-4o",
        severity: "critical",
        category: "Prompt Injection",
        description:
          "User-supplied media descriptions are concatenated directly into the GPT-4o system prompt at app.py:62 using f-string interpolation. An adversary can inject 'Ignore previous instructions' style payloads to override safety guardrails and exfiltrate system prompt content.",
        filePath: "app.py",
        lineNumber: 62,
        snippet:
          "prompt = f'{SYSTEM_PROMPT}\\nAnalyze this media: {user_input}'",
        remediation:
          "Use OpenAI's structured message format with separate system/user roles. Apply an input classifier to detect injection attempts before LLM invocation. Implement input/output guardrails.",
        framework: "OWASP-LLM01",
      },
      {
        title: "Insecure output handling — LLM response rendered as raw HTML",
        severity: "high",
        category: "Output Handling",
        description:
          "GPT-4o responses are inserted directly into the Jinja2 template using the |safe filter at templates/result.html:24, bypassing auto-escaping. Any markup the model returns (including <script> tags) executes in the user's browser.",
        filePath: "templates/result.html",
        lineNumber: 24,
        snippet: "{{ analysis_result|safe }}",
        remediation:
          "Remove the |safe filter and let Jinja2 auto-escape LLM output. Alternatively, sanitise with bleach.clean() before rendering.",
        framework: "OWASP-LLM02",
      },
      {
        title:
          "Excessive agency — GPT-4o agent has unrestricted tool access",
        severity: "high",
        category: "Excessive Agency",
        description:
          "The verification agent is configured with function calling that includes file system read access and HTTP request capabilities without an allow-list or human approval step.",
        filePath: "agents/verifier.py",
        lineNumber: 31,
        snippet: "tools=[file_read_tool, http_request_tool, shell_exec_tool]",
        remediation:
          "Restrict tool access to a curated allow-list. Remove shell_exec_tool entirely. Require human-in-the-loop confirmation for HTTP requests to external domains.",
        framework: "OWASP-LLM06",
      },
      {
        title: "No rate limiting on GPT-4o API calls",
        severity: "medium",
        category: "Denial of Service",
        description:
          "The /api/verify endpoint has no rate limiting, allowing an attacker to trigger unlimited GPT-4o API calls, leading to cost exhaustion and potential denial-of-wallet attacks.",
        filePath: "app.py",
        lineNumber: 55,
        snippet: "def verify_media():",
        remediation:
          "Implement Flask-Limiter with per-IP and per-user rate limits. Add budget caps on OpenAI API usage with monitoring alerts.",
        framework: "OWASP-LLM04",
      },
      {
        title: "Model version not pinned — supply chain risk",
        severity: "medium",
        category: "Supply Chain",
        description:
          "The OpenAI model is referenced as 'gpt-4o' without version pinning. Model behavior changes on provider-side updates could silently alter application behavior and safety properties.",
        filePath: "config.py",
        lineNumber: 8,
        snippet: "MODEL_NAME = 'gpt-4o'",
        remediation:
          "Pin to a specific model snapshot (e.g. 'gpt-4o-2024-08-06'). Implement regression tests for model output quality before adopting new versions.",
        framework: "OWASP-LLM05",
      },
    ],
    summary:
      "The VeriMedia application has a critical prompt injection vulnerability that is directly exploitable today. Combined with excessive agent tool access and insecure output handling, a successful injection could lead to server-side code execution and cross-site scripting. The lack of rate limiting compounds the risk by enabling denial-of-wallet attacks.",
    recommendation:
      "Immediately restructure the prompt construction to use OpenAI's message array format with strict role separation. Remove the |safe filter from templates. Strip shell_exec_tool from the agent's tool set. These three changes should be deployed before any external user access.",
    score: 28,
    riskLevel: "critical",
  }),

  guardian: JSON.stringify({
    findings: [
      {
        title: "No AI system documentation or model card",
        severity: "high",
        category: "transparency",
        description:
          "The application lacks any documentation describing the AI system's purpose, intended use scope, limitations, or out-of-scope uses. No MODEL_CARD.md or equivalent artifact exists in the repository. This is required under NIST AI RMF MAP-1.1 and EU AI Act transparency obligations.",
        filePath: "",
        lineNumber: 0,
        snippet: "",
        remediation:
          "Create a MODEL_CARD.md documenting: intended users, use cases, known limitations, data sources, ethical considerations, and performance characteristics per NIST MAP-1.1 / MAP-1.5.",
        framework: "NIST-MAP-1.1",
      },
      {
        title: "No bias or fairness evaluation process",
        severity: "high",
        category: "bias_fairness",
        description:
          "There is no evidence of fairness testing or bias evaluation for the GPT-4o media verification pipeline. The system may produce inconsistent or biased results across different demographic groups, languages, or media sources without any measurement or mitigation in place.",
        filePath: "",
        lineNumber: 0,
        snippet: "",
        remediation:
          "Implement a bias evaluation pipeline testing verification accuracy across diverse media sources, languages, and demographic contexts. Document results in periodic audit reports per NIST MEASURE-2.6.",
        framework: "NIST-MEASURE-2.6",
      },
      {
        title: "Missing AI risk management policy",
        severity: "medium",
        category: "governance",
        description:
          "No organizational policy document governs AI risk acceptance thresholds, incident response procedures, or escalation paths for the VeriMedia verification system. This is a prerequisite for NIST GOVERN-1.2 compliance and SOC 2 / ISO 42001 audit readiness.",
        filePath: "",
        lineNumber: 0,
        snippet: "",
        remediation:
          "Draft an AI Risk Management Policy aligned to NIST AI 600-1, assigning roles for risk acceptance, override authority, and incident response. Include specific thresholds for verification confidence scores.",
        framework: "NIST-GOVERN-1.2",
      },
      {
        title:
          "No human override mechanism for automated verification decisions",
        severity: "medium",
        category: "human_oversight",
        description:
          "The media verification pipeline produces automated authenticity verdicts with no mechanism for human review, appeal, or override. High-stakes verification decisions lack human-in-the-loop safeguards.",
        filePath: "app.py",
        lineNumber: 95,
        snippet: "return jsonify({'verdict': result, 'confidence': score})",
        remediation:
          "Add a circuit-breaker middleware that flags low-confidence verdicts for human review before final output. Implement an appeal workflow for contested decisions.",
        framework: "NIST-MANAGE-2.2",
      },
    ],
    summary:
      "The VeriMedia application has significant governance gaps that would block SOC 2 or ISO 42001 certification. The absence of AI system documentation and bias evaluation processes are the most critical governance deficiencies. While these gaps do not represent immediate exploitable vulnerabilities, they expose the organization to regulatory and reputational risk.",
    recommendation:
      "Prioritize creating a MODEL_CARD.md and implementing a basic bias evaluation pipeline. Draft an AI Risk Management Policy before scaling the system beyond internal use. Add human oversight for low-confidence verification decisions.",
    score: 45,
    riskLevel: "medium",
  }),
};

// ─── Council mock responses ──────────────────────────────────

const COUNCIL_CRITIQUE_MOCK = JSON.stringify({
  critiques: [
    {
      fromModule: "sentinel",
      aboutModule: "watchdog",
      type: "agreement",
      description:
        "Both Sentinel and Watchdog identified the prompt injection vulnerability in app.py as a critical risk. Sentinel flagged it as CWE-79 (input validation) while Watchdog classified it as OWASP-LLM01 (prompt injection). The convergence reinforces it as the highest-priority remediation item.",
    },
    {
      fromModule: "watchdog",
      aboutModule: "sentinel",
      type: "agreement",
      description:
        "Both modules flagged insecure output handling — Sentinel identified XSS via unsanitised HTML rendering, while Watchdog identified the same pattern through the LLM output handling lens (OWASP-LLM02). The root cause is identical: untrusted content rendered without escaping.",
    },
    {
      fromModule: "watchdog",
      aboutModule: "guardian",
      type: "conflict",
      description:
        "Watchdog assigns a critical overall risk level based on the exploitable prompt injection, while Guardian rates the application as medium risk focused on governance gaps. The conflict arises because Guardian's framework does not weight active exploitability as heavily as technical vulnerability assessments.",
    },
    {
      fromModule: "guardian",
      aboutModule: "sentinel",
      type: "addition",
      description:
        "Neither Sentinel nor Watchdog assessed the regulatory implications of processing media content without documented consent mechanisms or data retention policies. Under GDPR and emerging AI regulations, the absence of a DPIA for the AI-powered verification pipeline is a significant gap.",
    },
    {
      fromModule: "sentinel",
      aboutModule: "guardian",
      type: "addition",
      description:
        "No module assessed the incident response readiness for AI-specific failures such as model hallucinations leading to false verification verdicts. A runbook covering AI failure modes should be developed alongside the technical fixes.",
    },
  ],
  narrative:
    "The VeriMedia Flask application presents a concerning security posture with critical technical vulnerabilities compounded by governance deficiencies. The most significant finding — direct prompt injection into GPT-4o — was independently identified by both Sentinel and Watchdog, providing high confidence in its severity and exploitability.\n\nThe three expert modules broadly agree that the application requires substantial hardening before production deployment. However, a notable conflict exists in risk prioritisation: Watchdog's critical rating reflects the immediate exploitability of LLM-specific attack vectors, while Guardian's medium rating reflects the governance perspective where documentation and process gaps, though important, do not represent active threats. The Council finds that the technical risk assessment should take precedence for deployment decisions, while governance remediation should proceed in parallel.\n\nKey gaps remain unaddressed across all three assessments. No module evaluated data privacy compliance for the media verification pipeline, and incident response readiness for AI-specific failure modes was not assessed. These gaps should be added to the remediation roadmap alongside the identified technical and governance findings.",
});

const COUNCIL_SYNTHESIS_MOCK =
  "The VeriMedia application presents a high overall risk posture driven primarily by critical prompt injection and secrets management vulnerabilities identified by Sentinel and Watchdog. Both technical modules converged on the prompt injection finding, reinforcing its severity. The hardcoded OpenAI API key (CWE-798) represents a critical supply-chain exposure that could lead to unauthorised API usage and cost escalation.\n\nGuardian's governance assessment reveals that the application lacks foundational AI risk management artefacts — no model card, no bias evaluation pipeline, and no human override mechanism. While these gaps do not represent immediately exploitable vulnerabilities, they would block any compliance certification and expose the organisation to regulatory risk under emerging AI legislation.\n\nThe Council recommends a phased remediation approach: (1) immediately rotate the exposed API key and restructure prompt construction to use role-separated message arrays, (2) within one sprint, remove the Jinja2 |safe filter and restrict agent tool access, (3) within one quarter, establish AI governance documentation and a bias evaluation pipeline. The application should not be exposed to external users until phases 1 and 2 are complete.";

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

  /** Pick a module-specific canned response based on prompt keywords.
   *  Council prompts are checked first because they contain all module
   *  keywords in the embedded assessments and would otherwise match
   *  the first module-specific branch. */
  private resolveResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Council synthesis (plain text response — no JSON)
    if (lower.includes("synthesis narrative") || lower.includes("overall risk posture clearly"))
      return COUNCIL_SYNTHESIS_MOCK;
    // Council critique (JSON with critiques + narrative)
    if (lower.includes("frommodule") || lower.includes("aboutmodule"))
      return COUNCIL_CRITIQUE_MOCK;

    // Module-specific expert analysis (JSON)
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
