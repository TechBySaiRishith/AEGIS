import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "./page";
import type { ProviderId } from "@/lib/api";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/ProviderStatusBadge", () => ({
  default: () => <div data-testid="provider-status-badge" />,
}));

vi.mock("@/lib/api", () => ({
  submitEvaluation: vi.fn(),
  getHealth: vi.fn(),
}));

import { getHealth } from "@/lib/api";

type MockHealth = {
  status: string;
  providers: Record<string, { available: boolean; model?: string }>;
  modules: {
    sentinel: { ready: boolean };
    watchdog: { ready: boolean };
    guardian: { ready: boolean };
  };
};

function makeHealth(availableProviders: ProviderId[] = []): MockHealth {
  const providerIds: ProviderId[] = ["anthropic", "openai", "copilot", "github", "custom"];

  return {
    status: "ok",
    providers: Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        { available: availableProviders.includes(providerId) },
      ]),
    ),
    modules: {
      sentinel: { ready: true },
      watchdog: { ready: true },
      guardian: { ready: true },
    },
  };
}

describe("Home onboarding banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the warning banner when no providers are configured", async () => {
    vi.mocked(getHealth).mockResolvedValue(makeHealth());

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText(/No AI provider configured/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Evaluations will use automated checks only with reduced depth/i),
    ).toBeInTheDocument();
  });

  it("hides the warning banner when at least one provider is available", async () => {
    vi.mocked(getHealth).mockResolvedValue(makeHealth(["copilot"]));

    render(<Home />);

    await waitFor(() => {
      expect(getHealth).toHaveBeenCalled();
    });

    expect(screen.queryByText(/No AI provider configured/i)).not.toBeInTheDocument();
  });

  it("discloses that API endpoint intake is metadata-only", async () => {
    vi.mocked(getHealth).mockResolvedValue(makeHealth(["copilot"]));

    render(<Home />);

    await waitFor(() => {
      expect(getHealth).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /API endpoint/i }));

    expect(
      screen.getByText(
        /Live endpoint — evaluates security headers, API surface, and OpenAPI specs \(source code not analyzed\)/i,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /API endpoint mode checks your live endpoint for security headers, CORS settings, and OpenAPI\/Swagger specs\. For full source code analysis, use GitHub URL instead\./i,
      ),
    ).toBeInTheDocument();
  });
});
