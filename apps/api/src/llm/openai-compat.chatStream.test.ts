import { describe, it, expect, vi } from "vitest";
import { createOpenAIProvider } from "./openai-compat.js";

describe("openai-compat chatStream", () => {
  it("yields deltas from chat.completions.stream", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: "Hi " } }] };
      yield { choices: [{ delta: { content: "there" } }] };
      yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      yield { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } };
    })();
    const provider = createOpenAIProvider("gpt-4o");
    // @ts-expect-error — inject client
    provider.client = { chat: { completions: { stream: vi.fn().mockResolvedValue(mockStream), create: vi.fn() } } };

    const out: string[] = [];
    let usage: { prompt: number; completion: number } | undefined;
    for await (const c of provider.chatStream!([{ role: "user", content: "hi" }])) {
      if (c.delta) out.push(c.delta);
      if (c.done) usage = c.tokenUsage;
    }
    expect(out.join("")).toBe("Hi there");
    expect(usage?.prompt).toBe(5);
    expect(usage?.completion).toBe(2);
  });
});
