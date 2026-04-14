// apps/api/src/chat/uploads.test.ts
import { describe, it, expect } from "vitest";
import { validateUpload, CHAT_LIMITS } from "./uploads.js";

describe("validateUpload", () => {
  it("rejects oversized files", async () => {
    const buf = Buffer.alloc(CHAT_LIMITS.maxFileBytes + 1);
    const result = await validateUpload(buf, "big.pdf", "application/pdf");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("file_too_large");
  });

  it("rejects disguised mime", async () => {
    const buf = Buffer.from("not a pdf");
    const result = await validateUpload(buf, "fake.pdf", "application/pdf");
    expect(result.ok).toBe(false);
  });
});
