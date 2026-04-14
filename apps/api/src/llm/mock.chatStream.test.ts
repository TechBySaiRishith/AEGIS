// apps/api/src/llm/mock.chatStream.test.ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock.js";

describe("MockProvider.chatStream", () => {
  it("streams deterministic mock output", async () => {
    const chunks: string[] = [];
    for await (const c of new MockProvider().chatStream!([{ role: "user", content: "hello" }])) {
      if (c.delta) chunks.push(c.delta);
    }
    expect(chunks.join("")).toContain("Mock reply to: hello");
  });
});
