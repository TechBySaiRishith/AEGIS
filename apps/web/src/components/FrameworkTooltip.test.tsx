import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FrameworkTooltip from "./FrameworkTooltip";

describe("FrameworkTooltip", () => {
  it("renders glossary help for known framework references", () => {
    render(<FrameworkTooltip framework="CWE-79" />);

    expect(screen.getByText("CWE-79")).toBeInTheDocument();
    expect(
      screen.getByText(/Cross-Site Scripting \(XSS\) — injecting scripts into web pages/i),
    ).toBeInTheDocument();
  });

  it("renders fallback help text for unknown references without a glossary tooltip", () => {
    render(<FrameworkTooltip framework="CUSTOM-123" />);

    expect(screen.getByText("CUSTOM-123")).toBeInTheDocument();
    expect(screen.getByText(/Framework reference — click to learn more/i)).toBeInTheDocument();
  });
});
