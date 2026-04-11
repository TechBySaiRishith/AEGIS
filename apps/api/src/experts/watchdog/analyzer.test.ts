import { describe, it, expect } from "vitest";
import { parseFindings } from "./analyzer.js";

// `parseFindings` produces one Evidence entry per RawFinding (pulled from
// `filePath`/`snippet`), so to exercise the filter across multiple snippet
// shapes we provide multiple findings — one per case.
const multiLineRealCode = [
  "def run(prompt):",
  "    resp = client.chat.completions.create(",
  '        model="gpt-4",',
  "        messages=[{\"role\": \"user\", \"content\": prompt}],",
  "    )",
  "    return resp",
].join("\n");

const multiLineStartingWithComment = [
  "# Wrapper around the raw LLM call — retained for audit logging.",
  "def run(prompt):",
  "    return client.responses.create(model=MODEL, input=prompt)",
].join("\n");

function buildRawFindings() {
  return [
    {
      title: "Real multi-line code",
      severity: "high",
      category: "ai-integration",
      description: "Direct call to LLM without guardrails.",
      filePath: "src/llm.py",
      lineNumber: 10,
      snippet: multiLineRealCode,
    },
    {
      title: "Real single-line code",
      severity: "medium",
      category: "ai-integration",
      description: "Model id is hard-coded.",
      filePath: "src/config.py",
      lineNumber: 3,
      snippet: 'MODEL = "gpt-4-turbo"',
    },
    {
      title: "Synthesized comment-only snippet",
      severity: "high",
      category: "ai-integration",
      description: "LLM hallucinated an explanation instead of code.",
      filePath: "src/hallucinated.py",
      lineNumber: 1,
      snippet: "# LLM response returned without schema validation",
    },
    {
      title: "Empty snippet",
      severity: "low",
      category: "ai-integration",
      description: "LLM returned nothing for snippet.",
      filePath: "src/empty.py",
      lineNumber: 1,
      snippet: "",
    },
    {
      title: "Multi-line snippet starting with a comment",
      severity: "medium",
      category: "ai-integration",
      description: "Real code that documents itself via a leading comment.",
      filePath: "src/documented.py",
      lineNumber: 20,
      snippet: multiLineStartingWithComment,
    },
  ];
}

describe("watchdog parseFindings", () => {
  it("filters evidence: keeps real code, rejects empty and comment-only", () => {
    const findings = parseFindings(buildRawFindings());

    expect(findings).toHaveLength(5);

    const [
      realMulti,
      realSingle,
      commentOnly,
      empty,
      docCommentedCode,
    ] = findings;

    // Real multi-line code is preserved verbatim.
    expect(realMulti.evidence).toHaveLength(1);
    expect(realMulti.evidence?.[0]?.snippet).toBe(multiLineRealCode);

    // Real single-line code that isn't a comment is preserved.
    expect(realSingle.evidence).toHaveLength(1);
    expect(realSingle.evidence?.[0]?.snippet).toBe('MODEL = "gpt-4-turbo"');

    // Synthesized single-line comment and empty snippet are both dropped,
    // leaving the Finding present with an empty evidence array.
    expect(commentOnly.evidence).toEqual([]);
    expect(empty.evidence).toEqual([]);

    // Multi-line snippet that *starts* with a comment but contains real
    // code below must NOT be filtered — the heuristic should be precise.
    expect(docCommentedCode.evidence).toHaveLength(1);
    expect(docCommentedCode.evidence?.[0]?.snippet).toBe(
      multiLineStartingWithComment,
    );
  });

  it("rejects //-style and /*-style single-line comment snippets", () => {
    const findings = parseFindings([
      {
        title: "JS-style line comment",
        severity: "low",
        category: "ai-integration",
        description: "",
        filePath: "src/a.ts",
        snippet: "// TODO: validate schema",
      },
      {
        title: "Block-comment fragment",
        severity: "low",
        category: "ai-integration",
        description: "",
        filePath: "src/b.ts",
        snippet: "/* no schema validation */",
      },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.evidence).toEqual([]);
    expect(findings[1]?.evidence).toEqual([]);
  });
});
