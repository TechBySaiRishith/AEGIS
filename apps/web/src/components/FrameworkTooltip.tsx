const FRAMEWORK_GLOSSARY: Record<string, string> = {
  "CWE-78": "Command Injection — user input executed as OS commands",
  "CWE-79": "Cross-Site Scripting (XSS) — injecting scripts into web pages",
  "CWE-89": "SQL Injection — user input interpreted as database commands",
  "CWE-200": "Information Exposure — sensitive data leaked to unauthorized parties",
  "CWE-215": "Information Exposure Through Debug Info",
  "CWE-256": "Plaintext Storage of Passwords",
  "CWE-295": "Improper Certificate Validation",
  "CWE-327": "Use of Broken Cryptographic Algorithm",
  "CWE-502": "Deserialization of Untrusted Data",
  "CWE-770": "Allocation of Resources Without Limits",
  "CWE-798": "Hardcoded Credentials — secrets embedded in source code",
  "CWE-918": "Server-Side Request Forgery (SSRF)",
  "OWASP-LLM01": "Prompt Injection — manipulating LLM behavior through crafted input",
  "OWASP-LLM02": "Insecure Output Handling — LLM output used unsafely",
  "OWASP-LLM03": "Training Data Poisoning — corrupted training data",
  "OWASP-LLM04": "Model Denial of Service — exhausting LLM resources",
  "OWASP-LLM05": "Supply Chain Vulnerabilities in LLM components",
  "OWASP-LLM06": "Sensitive Information Disclosure via LLM",
  "OWASP-LLM07": "Insecure Plugin Design for LLM tools",
  "OWASP-LLM08": "Excessive Agency — LLM given too much autonomous power",
  "OWASP-LLM09": "Overreliance on LLM output without validation",
  "OWASP-LLM10": "Model Theft — unauthorized access to LLM models",
  "NIST-MAP-1": "AI Risk Mapping — identifying and documenting AI system risks",
  "NIST-GOVERN-1": "AI Governance — organizational policies for responsible AI",
  "NIST-MEASURE-1": "AI Risk Measurement — quantifying AI system risks",
  "EUAI-OVERSIGHT": "EU AI Act — human oversight requirements for AI systems",
  "UNICC-FAIRNESS": "UNICC Responsible AI — fairness and bias evaluation",
};

export default function FrameworkTooltip({ framework }: { framework: string }) {
  const explanation = FRAMEWORK_GLOSSARY[framework];

  if (!explanation) {
    return (
      <span className="inline-flex flex-col gap-1 align-top normal-case">
        <span className="underline decoration-dotted underline-offset-4">{framework}</span>
        <span className="text-[0.62rem] tracking-normal text-[var(--text-muted)]">
          Framework reference — click to learn more
        </span>
      </span>
    );
  }

  return (
    <span className="group relative inline-flex cursor-help align-top normal-case">
      <span className="underline decoration-dotted underline-offset-4">{framework}</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-3 hidden w-72 -translate-x-1/2 group-hover:block">
        <span className="relative block rounded-xl border border-white/10 bg-gray-900 px-3 py-2 text-left text-[0.7rem] leading-5 tracking-normal text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
          <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-white/10 bg-gray-900" />
          {explanation}
        </span>
      </span>
    </span>
  );
}
