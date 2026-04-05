import type {
  EvaluationReport,
  ExpertModuleId,
  Finding,
  ModuleReportSection,
  Severity,
  Verdict,
} from "@aegis/shared";

// ─── Colour palette ────────────────────────────────────────

const VERDICT_COLOURS: Record<Verdict, { bg: string; fg: string }> = {
  APPROVE: { bg: "#15803d", fg: "#ffffff" },
  REVIEW: { bg: "#b45309", fg: "#ffffff" },
  REJECT: { bg: "#b91c1c", fg: "#ffffff" },
};

const SEVERITY_COLOURS: Record<Severity, string> = {
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#b45309",
  low: "#4d7c0f",
  info: "#6b7280",
};

// ─── Escape helpers ────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(text: string): string {
  return esc(text).replace(/\n/g, "<br>");
}

// ─── Sub-renderers ─────────────────────────────────────────

function renderFindingsTable(findings: Finding[]): string {
  if (findings.length === 0) {
    return `<p class="no-findings">No findings reported.</p>`;
  }

  const rows = findings
    .map((f) => {
      const sevColour = SEVERITY_COLOURS[f.severity] ?? SEVERITY_COLOURS.info;
      const file =
        f.evidence.length > 0 ? f.evidence[0].filePath : "—";
      return `
        <tr>
          <td><span class="badge" style="background:${sevColour}">${esc(f.severity)}</span></td>
          <td>${esc(f.title)}</td>
          <td>${esc(f.description)}</td>
          <td class="mono">${esc(file)}</td>
          <td>${f.remediation ? esc(f.remediation) : "—"}</td>
        </tr>`;
    })
    .join("\n");

  return `
    <table>
      <thead>
        <tr>
          <th style="width:90px">Severity</th>
          <th>Title</th>
          <th>Description</th>
          <th>File</th>
          <th>Remediation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderModuleSection(moduleId: ExpertModuleId, section: ModuleReportSection): string {
  return `
    <section class="module-section">
      <h2>${esc(section.moduleName)} — ${esc(section.framework)}</h2>
      <div class="module-meta">
        <span class="score">Score: <strong>${section.score}</strong>/100</span>
        <span class="badge" style="background:${SEVERITY_COLOURS[section.riskLevel] ?? SEVERITY_COLOURS.info}">${esc(section.riskLevel)} risk</span>
      </div>
      <p>${nl2br(section.summary)}</p>
      <h3>Findings (${section.findings.length})</h3>
      ${renderFindingsTable(section.findings)}
      <div class="recommendation">
        <strong>Recommendation:</strong> ${nl2br(section.recommendation)}
      </div>
    </section>`;
}

// ─── Main HTML renderer ────────────────────────────────────

export function renderHTMLReport(report: EvaluationReport): string {
  const verdictColours = VERDICT_COLOURS[report.verdict] ?? VERDICT_COLOURS.REVIEW;

  const moduleIds: ExpertModuleId[] = ["sentinel", "watchdog", "guardian"];
  const moduleSections = moduleIds
    .filter((id) => report.moduleSummaries[id])
    .map((id) => renderModuleSection(id, report.moduleSummaries[id]))
    .join("\n");

  const generatedDate = new Date(report.generatedAt).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEGIS Report — ${esc(report.applicationName)}</title>
  <style>
    /* ── Reset & base ──────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      background: #ffffff;
      line-height: 1.6;
      padding: 2rem 3rem;
      max-width: 1000px;
      margin: 0 auto;
    }

    /* ── Typography ────────────────────────────────────── */
    h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.3rem; margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.25rem; }
    h3 { font-size: 1.05rem; margin-top: 1rem; margin-bottom: 0.5rem; }
    p { margin-bottom: 0.75rem; }

    /* ── Header ────────────────────────────────────────── */
    .header { margin-bottom: 2rem; }
    .header .logo { font-size: 2rem; font-weight: 800; letter-spacing: 0.1em; color: #111827; }
    .header .subtitle { font-size: 1rem; color: #6b7280; }

    /* ── App info ──────────────────────────────────────── */
    .app-info { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
    .app-info dt { font-weight: 600; display: inline; }
    .app-info dd { display: inline; margin-left: 0.25rem; margin-right: 1.5rem; }

    /* ── Verdict banner ────────────────────────────────── */
    .verdict-banner {
      padding: 1rem 1.5rem;
      border-radius: 6px;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .verdict-banner .verdict-label { font-size: 1.5rem; font-weight: 700; }
    .verdict-banner .confidence { font-size: 1rem; opacity: 0.9; }

    /* ── Badges ─────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    /* ── Tables ─────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.85rem; }
    th, td { text-align: left; padding: 6px 10px; border: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.8rem; word-break: break-all; }

    /* ── Module sections ───────────────────────────────── */
    .module-section { margin-bottom: 2rem; page-break-inside: avoid; }
    .module-meta { margin-bottom: 0.75rem; }
    .module-meta .score { margin-right: 1rem; }
    .recommendation { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin-top: 0.75rem; }

    .no-findings { color: #6b7280; font-style: italic; }

    /* ── Council analysis ──────────────────────────────── */
    .council-analysis { white-space: pre-wrap; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; font-size: 0.9rem; line-height: 1.5; }

    /* ── Footer ─────────────────────────────────────────── */
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.8rem; color: #9ca3af; text-align: center; }

    /* ── Print styles ──────────────────────────────────── */
    @media print {
      body { padding: 1rem; }
      .module-section { page-break-inside: avoid; }
      .verdict-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="logo">AEGIS</div>
    <div class="subtitle">AI Safety Evaluation Report</div>
  </div>

  <!-- Application info -->
  <div class="app-info">
    <dl>
      <dt>Application:</dt><dd>${esc(report.applicationName)}</dd>
      <dt>Description:</dt><dd>${esc(report.applicationDescription || "—")}</dd>
      <dt>Evaluation date:</dt><dd>${generatedDate}</dd>
      <dt>Report ID:</dt><dd class="mono">${esc(report.id)}</dd>
    </dl>
  </div>

  <!-- Verdict banner -->
  <div class="verdict-banner" style="background:${verdictColours.bg};color:${verdictColours.fg}">
    <span class="verdict-label">${esc(report.verdict)}</span>
    <span class="confidence">Confidence: ${(report.confidence * 100).toFixed(0)}%</span>
  </div>

  <!-- Executive summary -->
  <h2>Executive summary</h2>
  <div class="executive-summary">
    <p>${nl2br(report.executiveSummary)}</p>
  </div>

  <!-- Module sections -->
  ${moduleSections}

  <!-- Council analysis -->
  <h2>Council analysis</h2>
  <div class="council-analysis">${esc(report.councilAnalysis)}</div>

  <!-- Footer -->
  <div class="footer">
    Generated by AEGIS AI Safety Lab &middot; ${generatedDate}
  </div>

</body>
</html>`;
}
