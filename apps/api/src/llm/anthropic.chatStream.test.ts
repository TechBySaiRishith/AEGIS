import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "./anthropic.js";

describe("AnthropicProvider.chatStream", () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });

  it("yields delta chunks and final done with token usage", async () => {
    const mockStream = (async function* () {
      yield { type: "message_start", message: { usage: { input_tokens: 5 } } };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "world" } };
      yield { type: "message_delta", usage: { output_tokens: 2 } };
      yield { type: "message_stop" };
    })();

    const provider = new AnthropicProvider("claude-sonnet-4-5-20250514");
    // @ts-expect-error — inject client
    provider.client = { messages: { stream: vi.fn().mockReturnValue(mockStream), create: vi.fn() } };

    const chunks: string[] = [];
    let usage: { prompt: number; completion: number } | undefined;
    for await (const c of provider.chatStream!([{ role: "user", content: "hi" }])) {
      if (c.delta) chunks.push(c.delta);
      if (c.done) usage = c.tokenUsage;
    }
    expect(chunks.join("")).toBe("Hello world");
    expect(usage?.prompt).toBe(5);
    expect(usage?.completion).toBe(2);
  });

  it("supportsVision returns true", () => {
    expect(new AnthropicProvider("claude-sonnet-4-5-20250514").supportsVision?.()).toBe(true);
  });
});
