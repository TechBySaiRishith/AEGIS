import type { ApplicationProfile } from "@aegis/shared";

// ─── System Prompt ───────────────────────────────────────────

export const SENTINEL_SYSTEM_PROMPT = `You are **Sentinel**, the AEGIS Security & Privacy Analyzer — an expert static-analysis engine specialising in **traditional web-application and infrastructure security**.

You evaluate source code against:
- **CWE/SANS Top 25** Most Dangerous Software Weaknesses
- **OWASP Web Application Security Testing Guide (WSTG)**
- **OWASP API Security Top 10**

## Scope — what you DO analyse (and ONLY this)

| Category | Examples |
|---|---|
| **Authentication & Session Management** | Missing auth middleware, weak session config, no CSRF protection |
| **Secrets & Credential Management** | Hard-coded API keys, secrets in source, .env committed, debug mode on |
| **Input Validation & Injection** | SQL/NoSQL/command/template injection, path traversal, XSS |
| **File Upload Security** | Unrestricted file types, no size limits, missing content-type validation |
| **API Security** | Missing rate limiting, no CORS policy, overly permissive endpoints |
| **Dependency Vulnerabilities** | Known CVEs in pinned dependency versions |
| **Error Handling & Information Leakage** | Stack traces exposed, debug mode in production, verbose error responses |
| **Transport & Cryptography** | HTTP-only endpoints, weak TLS config, insecure random |

## Scope — what you do NOT analyse (leave to other experts)

- AI/LLM-specific risks like prompt injection, model abuse, output hallucination → that is **Watchdog's** job
- Governance, compliance, bias, fairness, documentation completeness → that is **Guardian's** job
- Do NOT duplicate their work. If a finding is primarily about LLM security or regulatory compliance, skip it.

## Application-specific analysis requirements

You are analysing a **real, specific application** — not a hypothetical system. You MUST:

1. **Name the exact technologies**: e.g., "Flask 2.3", "GPT-4o", "React 18", "PostgreSQL" — whatever the app actually uses.
2. **Reference specific files and line numbers** from the source code provided. Every finding MUST include a \`filePath\` and, when possible, a \`lineNumber\` and \`snippet\`.
3. **Describe concrete attack scenarios**: e.g., "An attacker can POST a crafted filename to /api/upload that traverses to ../../etc/passwd" — not "file uploads may be insecure".
4. **Provide specific remediation**: e.g., "Add \`flask-limiter\` with a 100 req/min default, and apply \`@limiter.limit('10/minute')\` to the /api/analyze endpoint" — not "add rate limiting".

Generic, vague, or hypothetical findings will be rejected. Every finding must be grounded in the actual code you are reviewing.

## Output format

Respond with ONLY a JSON object — no markdown fences, no preamble, no commentary:

{
  "findings": [
    {
      "title": "Short descriptive title naming the technology",
      "severity": "critical|high|medium|low|info",
      "category": "Authentication|Secrets Management|Input Validation|Injection|File Upload|API Security|Dependencies|Error Handling|Transport Security|Configuration",
      "description": "Detailed explanation of the vulnerability with concrete attack scenario",
      "filePath": "relative/path/to/file.py",
      "lineNumber": 42,
      "snippet": "the offending code snippet from the provided source",
      "remediation": "Specific, actionable fix with exact library names and code changes",
      "framework": "CWE-XXX"
    }
  ],
  "summary": "2-3 sentence security posture summary naming the application and its key technologies",
  "recommendation": "Top priority remediation actions (max 3), each tied to a specific finding",
  "score": 0,
  "riskLevel": "critical|high|medium|low"
}

## Scoring rubric (security-domain specific)

Start at 100. Deduct points based on security impact:

| Finding severity | Deduction | Typical examples |
|---|---|---|
| critical | -20 | Hardcoded secrets, no authentication on sensitive endpoints, RCE vectors, debug mode exposing internals |
| high | -12 | Missing rate limiting on public APIs, unrestricted file uploads, SQL injection vectors |
| medium | -5 | Missing CSRF tokens, overly permissive CORS, weak error handling |
| low | -2 | Missing security headers, HTTP-only cookies not set, info leakage in comments |
| info | 0 | Best-practice recommendations, defence-in-depth suggestions |

- \`riskLevel\` = severity of the highest-severity finding.
- If no source code is provided, return score 50 with an info finding explaining insufficient data.
- Do NOT invent file paths or line numbers. Only reference code that was actually provided.`;

// ─── User Prompt Builder ─────────────────────────────────────

export function buildSentinelUserPrompt(
  app: ApplicationProfile,
  codeSnippets: Record<string, string>,
): string {
  const sections: string[] = [];

  // Application context — rich detail for specificity
  sections.push(`## Application under analysis: "${app.name}"

- **Name**: ${app.name}
- **Description**: ${app.description}
- **Framework**: ${app.framework}
- **Language**: ${app.language}
- **Entry points**: ${app.entryPoints.join(", ") || "none identified"}
- **Total files**: ${app.totalFiles}
- **Total lines**: ${app.totalLines}
- **Dependencies** (${app.dependencies.length}): ${app.dependencies.slice(0, 50).join(", ")}${app.dependencies.length > 50 ? " …" : ""}`);

  // AI integrations — important for Sentinel to flag API key exposure
  if (app.aiIntegrations.length > 0) {
    sections.push(`## AI / external API integrations (security-relevant)

These integrations involve API keys, external network calls, and user-data processing. Evaluate them for **credential exposure, missing authentication, and insecure transport** — NOT for AI-specific risks (Watchdog handles those).

${app.aiIntegrations
  .map(
    (ai) =>
      `- **${ai.type}**: ${ai.description} (files: ${ai.files.join(", ")})`,
  )
  .join("\n")}`);
  }

  // Detected models
  if (app.detectedModels && app.detectedModels.length > 0) {
    sections.push(`## Specific AI models in use

${app.detectedModels.map((m) => `- \`${m}\``).join("\n")}

Check for model name/version exposure in responses, logs, or client-side code.`);
  }

  // Security profile from intake
  if (app.securityProfile) {
    const sp = app.securityProfile;
    sections.push(`## Intake security profile (pre-scan findings)

- **Authentication**: ${sp.hasAuthentication ? "Detected" : "⚠️ NOT DETECTED — flag as critical"}
- **File upload**: ${sp.hasFileUpload ? "Detected — check for unrestricted upload types, path traversal, size limits" : "Not detected"}
- **Rate limiting**: ${sp.hasRateLimiting ? "Detected" : "⚠️ NOT DETECTED"}
- **CSRF protection**: ${sp.hasCSRFProtection ? "Detected" : "⚠️ NOT DETECTED"}
- **Input validation library**: ${sp.hasInputValidation ? "Detected" : "⚠️ NOT DETECTED"}
- **CORS**: ${sp.hasCORS ? "Configured" : "Not configured"}
- **Debug mode**: ${sp.debugModeEnabled ? "⚠️ ENABLED — flag as high severity" : "Not detected"}
${sp.findings.length > 0 ? `\nPre-scan findings:\n${sp.findings.map((f) => `- ${f}`).join("\n")}` : ""}`);
  }

  // Routes
  if (app.routes && app.routes.length > 0) {
    sections.push(`## API routes / endpoints (${app.routes.length} detected)

Check each endpoint for authentication requirements, input validation, and authorization:

${app.routes.slice(0, 40).map((r) => `- \`${r.method} ${r.path}\` → ${r.handler ? `${r.handler}()` : r.file}`).join("\n")}`);
  }

  // Environment variables
  if (app.environmentVariables && app.environmentVariables.length > 0) {
    sections.push(`## Environment variables referenced

Check for hardcoded defaults, missing validation, and secrets management:

${app.environmentVariables.map((v) => `- \`${v}\``).join("\n")}`);
  }

  // Data handling patterns
  if (app.dataHandling && app.dataHandling.length > 0) {
    sections.push(`## Data handling patterns

${app.dataHandling.map((d) => `- **${d.type}**: ${d.description} (files: ${d.files.join(", ")})`).join("\n")}`);
  }

  // Source code with specific analysis directives
  const files = Object.entries(codeSnippets);
  if (files.length > 0) {
    sections.push(`## Source code (${files.length} files)

Analyse EVERY file below. For each finding you report, you MUST:
- Quote the exact code snippet that constitutes the vulnerability
- Name the specific technology (e.g., "Flask's \`app.run(debug=True)\`", "OpenAI API key in \`os.environ\`")
- Describe a concrete attack vector an adversary could exploit

Focus your analysis on these security domains:
1. **Authentication & authorisation** — Missing auth middleware, no session management, unprotected endpoints
2. **Secrets & credential management** — API keys in source, weak SECRET_KEY, .env files committed, debug mode
3. **Input validation** — User input passed to file operations, DB queries, or shell commands without sanitisation
4. **File upload security** — Unrestricted file types, no size limits, path traversal in filenames
5. **API security** — No rate limiting, missing CORS configuration, overly permissive endpoints
6. **Error handling** — Debug mode enabled, stack traces in responses, verbose error messages
7. **Dependency vulnerabilities** — Known vulnerable versions in requirements.txt / package.json
8. **Transport security** — HTTP-only endpoints, missing HSTS, insecure cookie flags

${files
  .map(
    ([path, content]) =>
      `### \`${path}\`\n\`\`\`\n${content}\n\`\`\``,
  )
  .join("\n\n")}`);
  } else {
    sections.push(
      "## Source code\n\nNo source files were available for analysis. Provide an info-level finding about insufficient data.",
    );
  }

  // Code excerpts from large files (e.g., monolithic app.py)
  if (app.codeExcerpts && Object.keys(app.codeExcerpts).length > 0) {
    const excerptEntries = Object.entries(app.codeExcerpts);
    sections.push(`## Code excerpts from large files (${excerptEntries.length} files)

These are key sections (route handlers, AI calls, security-relevant code) extracted from files too large to include in full. Analyse them with the same rigour as full source files:

${excerptEntries
  .map(([filePath, content]) => `### \`${filePath}\` (key sections)\n\`\`\`\n${content}\n\`\`\``)
  .join("\n\n")}`);
  }

  sections.push(
    "Respond with ONLY the JSON object described in your system instructions. No markdown fences, no preamble, no extra text.",
  );

  return sections.join("\n\n");
}
