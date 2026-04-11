/**
 * Post-LLM scope enforcement — algorithmically filters findings that
 * fall outside a module's defined responsibility. This prevents LLM
 * drift from producing out-of-scope results, hardening the module
 * independence guarantee beyond prompt-level instructions alone.
 */
import type { Finding, ExpertModuleId } from "@aegis/shared";

/** Canonical scope boundaries for each expert module */
const MODULE_SCOPE: Record<ExpertModuleId, {
  /** Framework prefixes this module may legitimately reference */
  allowedFrameworks: RegExp[];
  /** Category keywords that belong to other modules */
  excludedKeywords: RegExp[];
}> = {
  sentinel: {
    allowedFrameworks: [/^CWE-/i, /^OWASP(?!-LLM)/i, /^CVE-/i, /^SANS/i],
    excludedKeywords: [/\bLLM\s*safety\b/i, /\bmodel\s*card\b/i, /\bAI\s*governance\b/i, /\bNIST\s*AI\s*RMF\b/i, /\bEU\s*AI\s*Act\b/i],
  },
  watchdog: {
    allowedFrameworks: [/^OWASP-LLM/i, /^LLM/i, /^CISCO/i, /^MITRE.*ATLAS/i],
    excludedKeywords: [/\bSQL\s*injection\b/i, /\bXSS\b/i, /\bbuffer\s*overflow\b/i, /\bmodel\s*card\b/i, /\bNIST\s*AI\s*RMF\b/i],
  },
  guardian: {
    allowedFrameworks: [/^NIST/i, /^EU\s*AI/i, /^ISO/i, /^UNICC/i, /^IEEE/i],
    excludedKeywords: [/\bSQL\s*injection\b/i, /\bXSS\b/i, /\bprompt\s*injection\b/i, /\bjailbreak\b/i],
  },
};

/**
 * Returns true if a finding is within the module's defined scope.
 * A finding is in-scope if:
 * 1. Its framework matches at least one allowed pattern, OR has no framework
 * 2. Its category/title does NOT match any excluded keyword
 */
function isInScope(finding: Finding, moduleId: ExpertModuleId): boolean {
  const scope = MODULE_SCOPE[moduleId];
  if (!scope) return true;

  // Check excluded keywords in title + category
  const text = `${finding.title} ${finding.category}`;
  if (scope.excludedKeywords.some(re => re.test(text))) {
    return false;
  }

  // If finding has a framework reference, verify it's in the allowed set
  if (finding.framework) {
    const hasAllowedFramework = scope.allowedFrameworks.some(re => re.test(finding.framework!));
    if (!hasAllowedFramework) return false;
  }

  return true;
}

/**
 * Filter findings to only those within the module's scope.
 * Out-of-scope findings are silently dropped — they represent LLM drift.
 * Pure function — does not mutate input.
 */
export function enforceModuleScope(findings: Finding[], moduleId: ExpertModuleId): Finding[] {
  return findings.filter(f => isInScope(f, moduleId));
}
