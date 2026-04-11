import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ProviderStatusBadge from "./ProviderStatusBadge";

/**
 * Component-level tests for the four ProviderStatusBadge states.
 * These run under jsdom and stub window.fetch so we can exercise the
 * effect + state machine without a real API.
 *
 * End-to-end visual verification (real dev server, real browser, real
 * network intercept) lives in `e2e/provider-status-badge.spec.ts`.
 */

function mockHealthResponse(body: unknown, ok = true): void {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("ProviderStatusBadge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the loading state on first paint", () => {
    // Fetch is a Promise that never resolves during this render tick.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    render(<ProviderStatusBadge />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Polling provider mesh/i)).toBeInTheDocument();
  });

  it("renders the ready state when at least one provider is available", async () => {
    mockHealthResponse({
      status: "ok",
      version: "0.1.0",
      providers: {
        anthropic: { available: true, model: "claude-sonnet-4-5" },
        openai: { available: false },
        copilot: { available: true, model: "claude-opus-4.6" },
        github: { available: false },
        custom: { available: false },
      },
      modules: {
        sentinel: { ready: true },
        watchdog: { ready: true },
        guardian: { ready: true },
      },
    });

    render(<ProviderStatusBadge />);

    await waitFor(() => {
      expect(screen.getByText(/Providers online/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Copilot")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
    // Providers that aren't available must not render as chips
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
  });

  it("renders the zero-providers warning when none are available", async () => {
    mockHealthResponse({
      status: "ok",
      version: "0.1.0",
      providers: {
        anthropic: { available: false },
        openai: { available: false },
        copilot: { available: false },
        github: { available: false },
        custom: { available: false },
      },
      modules: {
        sentinel: { ready: false },
        watchdog: { ready: false },
        guardian: { ready: false },
      },
    });

    render(<ProviderStatusBadge />);

    await waitFor(() => {
      expect(
        screen.getByText(/No AI providers configured/i),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Configure at least one AI\s+provider/i),
    ).toBeInTheDocument();
  });

  it("renders the unreachable state when /api/health rejects with a non-OK status", async () => {
    mockHealthResponse({}, false);

    render(<ProviderStatusBadge />);

    await waitFor(() => {
      expect(screen.getByText(/Control plane unreachable/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Health check failed \(503\)/i)).toBeInTheDocument();
  });

  it("renders the unreachable state when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    render(<ProviderStatusBadge />);

    await waitFor(() => {
      expect(screen.getByText(/Control plane unreachable/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });
});
