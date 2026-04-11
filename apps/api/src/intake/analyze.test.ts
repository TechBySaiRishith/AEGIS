import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyzeApplication,
  detectFrameworkFromPackageJson,
  detectFrameworkFromRequirementsTxt,
  parseRequirementsTxt,
  extractAIIntegrationsFromSources,
  aggregateFileCounts,
} from "./analyze";

// These tests exercise pure helpers carved out of analyze.ts so we can drive
// them with in-memory fixtures (no filesystem). The async top-level
// `analyzeApplication` is exercised by the real-pipeline block at the bottom
// of this file, which writes a synthetic repo into a temp directory.

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

// ─── analyzeApplication (real filesystem) ────────────────────

describe("analyzeApplication (real filesystem)", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), "aegis-intake-"));
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  async function writeFileAt(rel: string, content: string): Promise<void> {
    const full = path.join(repoDir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
  }

  it("profiles a synthetic Flask+OpenAI repo end-to-end", async () => {
    await writeFileAt(
      "requirements.txt",
      ["Flask==2.3.2", "openai==1.14.0", "requests>=2.31"].join("\n"),
    );
    await writeFileAt(
      "app.py",
      [
        "from flask import Flask, request",
        "from openai import OpenAI",
        "",
        "app = Flask(__name__)",
        "client = OpenAI()",
        "",
        "@app.route('/chat', methods=['POST'])",
        "def chat():",
        "    prompt = request.json['prompt']",
        "    resp = client.chat.completions.create(",
        "        model='gpt-4o',",
        "        messages=[{'role': 'user', 'content': prompt}],",
        "    )",
        "    return resp.choices[0].message.content",
      ].join("\n"),
    );
    await writeFileAt("README.md", "# SyntheticApp\n\nTest fixture.");

    const profile = await analyzeApplication(repoDir);

    expect(profile.framework).toBe("Flask");
    expect(profile.language.toLowerCase()).toContain("python");
    expect(profile.dependencies).toEqual(
      expect.arrayContaining(["flask", "openai", "requests"]),
    );
    expect(profile.totalFiles).toBeGreaterThanOrEqual(2);
    expect(profile.totalLines).toBeGreaterThan(5);

    // AI integration detected by dependency + source scan
    expect(profile.aiIntegrations.length).toBeGreaterThanOrEqual(1);
    expect(profile.aiIntegrations.some((ai) => /openai/i.test(ai.type))).toBe(
      true,
    );

    // File structure surfaces app.py
    expect(
      profile.fileStructure.some(
        (f) => f.type === "file" && f.path.endsWith("app.py"),
      ),
    ).toBe(true);
  });

  it("profiles a synthetic Next.js+Anthropic repo end-to-end", async () => {
    await writeFileAt(
      "package.json",
      JSON.stringify(
        {
          name: "synthetic-next",
          version: "0.0.1",
          dependencies: {
            next: "15.0.0",
            react: "19.0.0",
            "@anthropic-ai/sdk": "0.39.0",
          },
        },
        null,
        2,
      ),
    );
    await writeFileAt(
      "app/api/chat/route.ts",
      [
        "import Anthropic from '@anthropic-ai/sdk';",
        "const client = new Anthropic();",
        "export async function POST(req: Request) {",
        "  const { prompt } = await req.json();",
        "  const msg = await client.messages.create({",
        "    model: 'claude-sonnet-4-5',",
        "    max_tokens: 1024,",
        "    messages: [{ role: 'user', content: prompt }],",
        "  });",
        "  return Response.json(msg);",
        "}",
      ].join("\n"),
    );
    await writeFileAt("README.md", "# SyntheticNext");

    const profile = await analyzeApplication(repoDir);

    expect(profile.framework).toBe("Next.js");
    expect(profile.language.toLowerCase()).toMatch(/type ?script|javascript/);
    expect(profile.dependencies).toEqual(
      expect.arrayContaining(["next", "react", "@anthropic-ai/sdk"]),
    );
    expect(
      profile.aiIntegrations.some((ai) => /anthropic/i.test(ai.type)),
    ).toBe(true);
  });

  it("returns a zero-ish profile for a completely empty repo", async () => {
    const profile = await analyzeApplication(repoDir);
    expect(profile.totalFiles).toBe(0);
    expect(profile.dependencies).toEqual([]);
    expect(profile.aiIntegrations).toEqual([]);
    expect(profile.fileStructure).toEqual([]);
  });
});
