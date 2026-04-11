import { describe, expect, it } from "vitest";
import type { Evaluation } from "@aegis/shared";
import { displayName } from "./display-name";

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: "V1StGXR8_Z5jdHi6B-myT",
    status: "completed",
    application: {
      id: "app-1",
      inputType: "github_url",
      sourceUrl: "https://github.com/FlashCarrot/VeriMedia",
      name: "VeriMedia AI",
      description: "",
      framework: "Next.js",
      language: "TypeScript",
      entryPoints: [],
      dependencies: [],
      aiIntegrations: [],
      fileStructure: [],
      totalFiles: 0,
      totalLines: 0,
    },
    assessments: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("displayName", () => {
  it("extracts owner and repo when the application name is a GitHub URL", () => {
    const evaluation = makeEvaluation({
      application: {
        ...makeEvaluation().application,
        name: "https://github.com/FlashCarrot/VeriMedia",
      },
    });

    expect(displayName(evaluation)).toBe("FlashCarrot/VeriMedia");
  });

  it("falls back to the source URL when the name looks like an opaque id", () => {
    const evaluation = makeEvaluation({
      application: {
        ...makeEvaluation().application,
        name: "V1StGXR8_Z5jdHi6B-myT",
      },
    });

    expect(displayName(evaluation)).toBe("FlashCarrot/VeriMedia");
  });

  it("returns a friendly fallback instead of the evaluation id", () => {
    const evaluation = makeEvaluation({
      application: {
        ...makeEvaluation().application,
        name: "",
        sourceUrl: undefined,
      },
    });

    expect(displayName(evaluation)).toBe("Untitled evaluation");
  });
});
