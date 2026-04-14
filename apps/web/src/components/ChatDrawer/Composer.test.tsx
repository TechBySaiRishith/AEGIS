import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";

// uploadChatFile is called only when files are attached; not needed for these tests
vi.mock("@/lib/chat", () => ({
  uploadChatFile: vi.fn(),
  fetchChatHistory: vi.fn(() => Promise.resolve([])),
  sendChatMessage: vi.fn(),
}));

// CHAT_LIMITS is used for file type accept + count; mock with sensible values
vi.mock("@aegis/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aegis/shared")>();
  return {
    ...actual,
    CHAT_LIMITS: {
      maxFilesPerMessage: 3,
      maxFileBytes: 10 * 1024 * 1024,
      maxPdfPages: 20,
      maxImagePixels: 4096,
      maxMessagesPerMinute: 30,
      maxMessagesPerThread: 500,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"],
    },
  };
});

describe("Composer", () => {
  it("calls onSubmit on ⌘↵", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <Composer
        evaluationId="e1"
        draft="hello"
        onDraftChange={() => {}}
        streaming={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText(/ask anything/i), {
      key: "Enter",
      metaKey: true,
    });
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("disables send while streaming", () => {
    render(
      <Composer
        evaluationId="e1"
        draft="x"
        onDraftChange={() => {}}
        streaming
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /…/ })).toBeDisabled();
  });
});
