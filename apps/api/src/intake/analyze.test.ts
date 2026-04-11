import { describe, it, expect } from "vitest";
import {
  detectFrameworkFromPackageJson,
  detectFrameworkFromRequirementsTxt,
  parseRequirementsTxt,
  extractAIIntegrationsFromSources,
  aggregateFileCounts,
} from "./analyze";

// These tests exercise pure helpers carved out of analyze.ts so we can drive
// them with in-memory fixtures (no filesystem). The async top-level
// `analyzeApplication` still uses fs — that's covered by integration tests.

describe("detectFrameworkFromRequirementsTxt", () => {
  it("detects Flask from a classic requirements.txt", () => {
    const content = ["Flask==2.3.2", "requests>=2.31", "# test comment"].join(
      "\n",
    );
    expect(detectFrameworkFromRequirementsTxt(content)).toBe("Flask");
  });

  it("detects FastAPI, Django, Streamlit case-insensitively", () => {
    expect(detectFrameworkFromRequirementsTxt("fastapi==0.110")).toBe(
      "FastAPI",
    );
    expect(detectFrameworkFromRequirementsTxt("Django>=4.2")).toBe("Django");
    expect(detectFrameworkFromRequirementsTxt("streamlit==1.30")).toBe(
      "Streamlit",
    );
  });

  it("returns null when no recognised framework is present", () => {
    expect(detectFrameworkFromRequirementsTxt("numpy\npandas\nscipy")).toBe(
      null,
    );
  });
});

describe("detectFrameworkFromPackageJson", () => {
  it("detects Next.js from a Next dependency", () => {
    expect(
      detectFrameworkFromPackageJson({
        name: "example",
        dependencies: { next: "14.0.0", react: "18.0.0" },
      }),
    ).toBe("Next.js");
  });

  it("detects Express from a dev dependency", () => {
    expect(
      detectFrameworkFromPackageJson({
        devDependencies: { express: "^4.19" },
      }),
    ).toBe("Express");
  });

  it("falls back through React when no server framework is present", () => {
    expect(
      detectFrameworkFromPackageJson({
        dependencies: { react: "18.0.0" },
      }),
    ).toBe("React");
  });

  it("returns null for empty / malformed input", () => {
    expect(detectFrameworkFromPackageJson(null)).toBe(null);
    expect(detectFrameworkFromPackageJson({})).toBe(null);
    expect(detectFrameworkFromPackageJson({ dependencies: {} })).toBe(null);
    expect(detectFrameworkFromPackageJson("not an object")).toBe(null);
  });
});

describe("parseRequirementsTxt", () => {
  it("strips version specifiers, comments, and flags", () => {
    const content = [
      "# top-level comment",
      "flask==2.3.2",
      "openai>=1.0.0",
      "requests",
      "-e git+https://example.com/foo.git",
      "numpy[all]>=1.20",
      "",
    ].join("\n");
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual(["flask", "openai", "requests", "numpy"]);
  });
});

describe("extractAIIntegrationsFromSources", () => {
  it("detects OpenAI integration from import patterns", () => {
    const integrations = extractAIIntegrationsFromSources(
      [],
      [
        {
          path: "app.py",
          content: "from openai import OpenAI\nclient = OpenAI()\n",
        },
      ],
    );
    const openai = integrations.find((i) => i.type === "openai");
    expect(openai).toBeDefined();
    expect(openai!.files).toContain("app.py");
  });

  it("detects integrations from dependency names alone", () => {
    const integrations = extractAIIntegrationsFromSources(
      ["anthropic"],
      [],
    );
    expect(integrations.some((i) => i.type === "anthropic")).toBe(true);
  });

  it("detects multiple integrations across files", () => {
    const integrations = extractAIIntegrationsFromSources(
      [],
      [
        { path: "a.py", content: "import openai" },
        { path: "b.py", content: "from anthropic import Anthropic" },
        { path: "c.py", content: "from langchain.chat_models import ChatOpenAI" },
      ],
    );
    const types = integrations.map((i) => i.type).sort();
    expect(types).toEqual(expect.arrayContaining(["openai", "anthropic", "langchain"]));
  });

  it("returns an empty list when nothing matches", () => {
    const integrations = extractAIIntegrationsFromSources(
      ["requests"],
      [{ path: "util.py", content: "import requests\n" }],
    );
    expect(integrations).toEqual([]);
  });
});

describe("aggregateFileCounts", () => {
  it("counts files and sums lines across recognised source + text files", () => {
    const entries = [
      { name: "app.py", content: "print('hi')\nprint('bye')\n" }, // 3 lines
      { name: "README.md", content: "# hello\n\nworld\n" }, // 4 lines
      { name: "image.bin", content: "ignored" }, // counted as file but lines skipped
    ];
    const result = aggregateFileCounts(entries);
    expect(result.totalFiles).toBe(3);
    // app.py -> 3, README.md -> 4 (image.bin is unknown ext -> not counted)
    expect(result.totalLines).toBe(7);
  });

  it("skips dot-prefixed / ignored names", () => {
    const entries = [
      { name: ".git", content: "garbage" },
      { name: "node_modules", content: "garbage" },
      { name: "main.py", content: "x = 1\n" },
    ];
    const result = aggregateFileCounts(entries);
    expect(result.totalFiles).toBe(1);
    expect(result.totalLines).toBe(2);
  });

  it("returns zeros for an empty repo", () => {
    expect(aggregateFileCounts([])).toEqual({ totalFiles: 0, totalLines: 0 });
  });
});
