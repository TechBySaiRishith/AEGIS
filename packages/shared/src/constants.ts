import type { Severity, Verdict, ExpertModuleId, RiskDomain, Tier } from "./types.js";

// ─── Risk Domain Labels ────────────────────────────────────

export const RISK_DOMAIN_LABELS: Record<RiskDomain, string> = {
  data_sovereignty: "Data sovereignty",
  agent_autonomy: "Agent autonomy",
  content_safety: "Content safety",
  operational_integrity: "Operational integrity",
  supply_chain_trust: "Supply chain trust",
};

// ─── Severity Styles ───────────────────────────────────────

export const SEVERITY_STYLES: Record<Severity, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "#ef44441a", label: "Critical" },
  high: { color: "#f59e0b", bg: "#f59e0b1a", label: "High" },
  medium: { color: "#3b82f6", bg: "#3b82f61a", label: "Medium" },
  low: { color: "#6b7280", bg: "#6b72801a", label: "Low" },
  info: { color: "#8b5cf6", bg: "#8b5cf61a", label: "Info" },
};

// ─── Verdict Styles ────────────────────────────────────────

export const VERDICT_STYLES: Record<Verdict, { color: string; bg: string; icon: string; label: string }> = {
  APPROVE: { color: "#22c55e", bg: "#22c55e1a", icon: "✓", label: "Approved" },
  REVIEW: { color: "#f59e0b", bg: "#f59e0b1a", icon: "⚠", label: "Review Required" },
  REJECT: { color: "#ef4444", bg: "#ef44441a", icon: "✗", label: "Rejected" },
};

// ─── Expert Module Metadata ────────────────────────────────

export const EXPERT_MODULES: Record<ExpertModuleId, { name: string; framework: string; description: string; icon: string }> = {
  sentinel: {
    name: "Sentinel",
    framework: "CWE/OWASP Web Application Security",
    description: "Code & security static analysis — identifies vulnerabilities, unsafe patterns, and data handling risks",
    icon: "🛡️",
  },
  watchdog: {
    name: "Watchdog",
    framework: "OWASP LLM Top 10 / Cisco AI Threat Taxonomy",
    description: "Adversarial & LLM safety analysis — evaluates prompt injection, jailbreak, and data exfiltration risks",
    icon: "🔍",
  },
  guardian: {
    name: "Guardian",
    framework: "NIST AI RMF / EU AI Act / UNICC Responsible AI",
    description: "Governance & compliance analysis — evaluates bias, fairness, privacy, transparency, and regulatory alignment",
    icon: "⚖️",
  },
};

// ─── Evaluation Status Labels ──────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  cloning: "Cloning repository...",
  analyzing: "Analyzing application...",
  sentinel_running: "Sentinel analyzing security...",
  watchdog_running: "Watchdog analyzing LLM safety...",
  guardian_running: "Guardian analyzing governance...",
  synthesizing: "Council synthesizing verdict...",
  completed: "Evaluation complete",
  failed: "Evaluation failed",
};

export const APP_VERSION = "0.1.0";

// ─── OWASP LLM Top 10 (2025) ───────────────────────────────
// Canonical category IDs used by Watchdog when tagging findings via
// `framework: "OWASP-LLM0N"`. Shared here so the web UI can render
// per-category breakdowns without depending on the API source tree.

export const OWASP_LLM_CATEGORIES = {
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

export type OwaspLlmCategoryId = keyof typeof OWASP_LLM_CATEGORIES;

/** Ordered list of OWASP LLM Top-10 category IDs (LLM01…LLM10). */
export const OWASP_LLM_CATEGORY_IDS = Object.keys(
  OWASP_LLM_CATEGORIES,
) as OwaspLlmCategoryId[];

/**
 * Extract the OWASP LLM category code (e.g. "LLM01") from a finding's
 * `framework` field. Watchdog tags findings as `"OWASP-LLM01"`, but we
 * match any `LLM\d{2}` token to be resilient to prefix drift. Returns
 * `null` when the finding is not LLM-tagged.
 */
export function extractOwaspLlmId(
  framework: string | undefined,
): OwaspLlmCategoryId | null {
  if (!framework) return null;
  const match = framework.match(/LLM(\d{2})/);
  if (!match) return null;
  const id = `LLM${match[1]}` as OwaspLlmCategoryId;
  return id in OWASP_LLM_CATEGORIES ? id : null;
}
