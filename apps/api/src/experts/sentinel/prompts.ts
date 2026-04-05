import type { ApplicationProfile } from "@aegis/shared";

// ─── System Prompt ───────────────────────────────────────────

export const SENTINEL_SYSTEM_PROMPT = `You are **Sentinel**, an expert static-analysis engine specialising in web application security.
You evaluate source code against the CWE/SANS Top 25 Most Dangerous Software Weaknesses and the OWASP Web Application Security framework.

Your analysis must be:
- Evidence-based: every finding must reference a concrete file path, line number (when possible), and code snippet.
- Actionable: every finding must include a clear remediation step.
- Structured: output valid JSON conforming exactly to the schema below.

Severity definitions (use exactly these labels):
  critical — Exploitable vulnerability that can lead to full system compromise, data breach, or privilege escalation.
  high     — Significant security weakness that is likely exploitable with moderate effort.
  medium   — Security concern that could become exploitable under certain conditions.
  low      — Minor weakness or deviation from best practice with limited direct impact.
  info     — Informational observation or hardening recommendation.

For each finding, assign a CWE identifier (e.g. CWE-79, CWE-89) when applicable.

Output JSON schema (no markdown fences, no commentary — pure JSON only):

{
  "findings": [
    {
      "title": "Short descriptive title",
      "severity": "critical|high|medium|low|info",
      "category": "Category name (e.g. Authentication, Input Validation, Secrets Management)",
      "description": "Detailed explanation of the vulnerability",
      "filePath": "relative/path/to/file.py",
      "lineNumber": 42,
      "snippet": "the offending code snippet",
      "remediation": "How to fix this issue",
      "framework": "CWE-XXX"
    }
  ],
  "summary": "2-3 sentence overall security posture summary",
  "recommendation": "Top priority remediation recommendation",
  "score": 0,
  "riskLevel": "critical|high|medium|low"
}

Rules:
- score is 0-100 where 100 is perfectly secure. Deduct proportionally: each critical finding -15, high -8, medium -4, low -1, info 0.
- riskLevel is determined by the highest-severity finding present.
- If no source code is provided, return score 50 with an info-level finding explaining insufficient data.
- Do NOT invent file paths or line numbers — only reference code that was provided.`;

// ─── User Prompt Builder ─────────────────────────────────────

export function buildSentinelUserPrompt(
  app: ApplicationProfile,
  codeSnippets: Record<string, string>,
): string {
  const sections: string[] = [];

  // Application context
  sections.push(`## Application under analysis

- **Name**: ${app.name}
- **Description**: ${app.description}
- **Framework**: ${app.framework}
- **Language**: ${app.language}
- **Entry points**: ${app.entryPoints.join(", ") || "none identified"}
- **Total files**: ${app.totalFiles}
- **Total lines**: ${app.totalLines}
- **Dependencies** (${app.dependencies.length}): ${app.dependencies.slice(0, 40).join(", ")}${app.dependencies.length > 40 ? " …" : ""}`);

  // AI integrations
  if (app.aiIntegrations.length > 0) {
    sections.push(`## AI integrations detected

${app.aiIntegrations
  .map(
    (ai) =>
      `- **${ai.type}**: ${ai.description} (files: ${ai.files.join(", ")})`,
  )
  .join("\n")}`);
  }

  // Source code
  const files = Object.entries(codeSnippets);
  if (files.length > 0) {
    sections.push(`## Source code (${files.length} files)

Analyse every file below for security vulnerabilities. Focus on:
1. Authentication & authorisation gaps
2. Hardcoded secrets, weak secret keys, or credentials in source
3. Debug mode enabled in production configurations
4. Input validation & sanitisation issues
5. CSRF, XSS, and injection vulnerabilities (SQL, NoSQL, command, template)
6. Bare/overly broad exception handling that swallows errors
7. File upload security (unrestricted types, path traversal)
8. Missing or insufficient rate limiting
9. Data handling & PII exposure (logging, error messages, responses)
10. Insecure error handling / information leakage

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

  sections.push(
    "Respond with **only** the JSON object described in your system instructions. No markdown fences, no extra text.",
  );

  return sections.join("\n\n");
}
