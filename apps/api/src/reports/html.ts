import type {
  EvaluationReport,
  ExpertModuleId,
  Finding,
  ModuleReportSection,
  Severity,
  Verdict,
  RiskSummaryEntry,
  ActionableRecommendation,
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

const PRIORITY_COLOURS: Record<string, { bg: string; fg: string }> = {
  immediate: { bg: "#b91c1c", fg: "#ffffff" },
  "short-term": { bg: "#b45309", fg: "#ffffff" },
  "long-term": { bg: "#4d7c0f", fg: "#ffffff" },
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

function renderRiskSummaryTable(entries: RiskSummaryEntry[]): string {
  if (entries.length === 0) return "";

  const rows = entries
    .map((e) => {
      const sevColour = SEVERITY_COLOURS[e.riskLevel] ?? SEVERITY_COLOURS.info;
      const totalFindings = e.criticalCount + e.highCount + e.mediumCount + e.lowCount + e.infoCount;
      return `
        <tr>
          <td><strong>${esc(e.moduleName)}</strong></td>
          <td class="score-cell">${e.score}/100</td>
          <td><span class="badge" style="background:${sevColour}">${esc(e.riskLevel)}</span></td>
          <td class="count critical-count">${e.criticalCount || "—"}</td>
          <td class="count high-count">${e.highCount || "—"}</td>
          <td class="count medium-count">${e.mediumCount || "—"}</td>
          <td class="count low-count">${e.lowCount || "—"}</td>
          <td>${totalFindings}</td>
          <td>${e.topFinding ? esc(e.topFinding) : "—"}</td>
        </tr>`;
    })
    .join("\n");

  return `
    <table class="risk-table">
      <thead>
        <tr>
          <th>Module</th>
          <th>Score</th>
          <th>Risk Level</th>
          <th style="color:${SEVERITY_COLOURS.critical}">Crit</th>
          <th style="color:${SEVERITY_COLOURS.high}">High</th>
          <th style="color:${SEVERITY_COLOURS.medium}">Med</th>
          <th style="color:${SEVERITY_COLOURS.low}">Low</th>
          <th>Total</th>
          <th>Top Finding</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRecommendations(recommendations: ActionableRecommendation[]): string {
  if (recommendations.length === 0) {
    return `<p class="no-findings">No actionable recommendations.</p>`;
  }

  const groups: Record<string, ActionableRecommendation[]> = {
    immediate: [],
    "short-term": [],
    "long-term": [],
  };

  for (const r of recommendations) {
    groups[r.priority]?.push(r);
  }

  const sections: string[] = [];

  for (const [priority, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    const colours = PRIORITY_COLOURS[priority] ?? PRIORITY_COLOURS["long-term"];
    const label = priority === "immediate"
      ? "🔴 Immediate (before deployment)"
      : priority === "short-term"
        ? "🟠 Short-term (within 2 weeks)"
        : "🟢 Long-term (next iteration)";

    sections.push(`<h4>${label}</h4>`);
    sections.push("<ol>");
    for (const item of items) {
      sections.push(`
        <li class="recommendation-item">
          <span class="badge" style="background:${colours.bg};color:${colours.fg}">${esc(priority)}</span>
          <strong>${esc(item.title)}</strong>
          <br><span class="rec-desc">${esc(item.description)}</span>
          <br><span class="rec-meta">Module: ${esc(item.module)} | Findings: ${item.relatedFindings.join(", ")}</span>
        </li>`);
    }
    sections.push("</ol>");
  }

  return sections.join("\n");
}

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
          <td><strong>${esc(f.id)}</strong></td>
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
          <th style="width:80px">Severity</th>
          <th style="width:80px">ID</th>
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
        <strong>Module recommendation:</strong> ${nl2br(section.recommendation)}
      </div>
    </section>`;
}

function renderCouncilDeliberation(report: EvaluationReport): string {
  const d = report.councilDeliberation;
  if (!d) return "";

  const sections: string[] = [];

  if (d.arbitrationProcess) {
    sections.push(`
      <div class="deliberation-section">
        <h4>Arbitration Process</h4>
        <pre class="arb-process">${esc(d.arbitrationProcess)}</pre>
      </div>`);
  }

  if (d.corroborations.length > 0) {
    sections.push(`
      <div class="deliberation-section">
        <h4>✓ Cross-Module Corroborations (${d.corroborations.length})</h4>
        <ul>${d.corroborations.map((c) => `<li class="corroboration">${esc(c)}</li>`).join("\n")}</ul>
      </div>`);
  }

  if (d.disagreements.length > 0) {
    sections.push(`
      <div class="deliberation-section">
        <h4>⚠ Disagreement Resolution (${d.disagreements.length})</h4>
        <ul>${d.disagreements.map((d2) => `<li class="disagreement">${esc(d2)}</li>`).join("\n")}</ul>
      </div>`);
  }

  if (d.crossReferences.length > 0) {
    sections.push(`
      <div class="deliberation-section">
        <h4>Cross-References</h4>
        <ul>${d.crossReferences.map((c) => `<li>${esc(c)}</li>`).join("\n")}</ul>
      </div>`);
  }

  if (d.confidenceFactors.length > 0) {
    sections.push(`
      <div class="deliberation-section">
        <h4>Confidence Calibration</h4>
        <ul>${d.confidenceFactors.map((f) => `<li>${esc(f)}</li>`).join("\n")}</ul>
      </div>`);
  }

  return sections.join("\n");
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
    h4 { font-size: 0.95rem; margin-top: 0.75rem; margin-bottom: 0.4rem; color: #374151; }
    p { margin-bottom: 0.75rem; }

    /* ── Header ────────────────────────────────────────── */
    .header { margin-bottom: 2rem; }
    .header .logo { font-size: 2rem; font-weight: 800; letter-spacing: 0.1em; color: #111827; }
    .header .subtitle { font-size: 1rem; color: #6b7280; }
    .header .org { font-size: 0.85rem; color: #9ca3af; margin-top: 0.15rem; }

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

    /* ── Risk summary table ────────────────────────────── */
    .risk-table .score-cell { font-weight: 700; font-size: 1rem; }
    .risk-table .count { text-align: center; font-weight: 600; }
    .risk-table .critical-count { color: ${SEVERITY_COLOURS.critical}; }
    .risk-table .high-count { color: ${SEVERITY_COLOURS.high}; }
    .risk-table .medium-count { color: ${SEVERITY_COLOURS.medium}; }
    .risk-table .low-count { color: ${SEVERITY_COLOURS.low}; }

    /* ── Module sections ───────────────────────────────── */
    .module-section { margin-bottom: 2rem; page-break-inside: avoid; }
    .module-meta { margin-bottom: 0.75rem; }
    .module-meta .score { margin-right: 1rem; }
    .recommendation { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin-top: 0.75rem; }

    .no-findings { color: #6b7280; font-style: italic; }

    /* ── Recommendations ──────────────────────────────── */
    .recommendations ol { margin-left: 1.5rem; margin-bottom: 1rem; }
    .recommendation-item { margin-bottom: 0.75rem; line-height: 1.5; }
    .recommendation-item .badge { margin-right: 0.5rem; font-size: 0.7rem; }
    .rec-desc { color: #4b5563; font-size: 0.85rem; }
    .rec-meta { color: #9ca3af; font-size: 0.75rem; font-family: monospace; }

    /* ── Council deliberation ─────────────────────────── */
    .council-analysis { white-space: pre-wrap; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; font-size: 0.9rem; line-height: 1.5; }
    .deliberation-section { margin-bottom: 1rem; padding: 0.75rem; background: #fefce8; border: 1px solid #fde68a; border-radius: 6px; }
    .deliberation-section h4 { margin-top: 0; }
    .deliberation-section ul { margin-left: 1.25rem; }
    .deliberation-section li { margin-bottom: 0.4rem; font-size: 0.85rem; }
    .deliberation-section li.corroboration { color: #15803d; }
    .deliberation-section li.disagreement { color: #b91c1c; }
    .arb-process { white-space: pre-wrap; background: #1f2937; color: #e5e7eb; padding: 0.75rem; border-radius: 4px; font-size: 0.8rem; line-height: 1.5; overflow-x: auto; }

    /* ── Footer ─────────────────────────────────────────── */
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.8rem; color: #9ca3af; text-align: center; }

    /* ── Print styles ──────────────────────────────────── */
    @media print {
      body { padding: 1rem; }
      .module-section { page-break-inside: avoid; }
      .verdict-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .arb-process { background: #f3f4f6 !important; color: #1f2937 !important; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="logo">AEGIS</div>
    <div class="subtitle">AI Safety Evaluation Report</div>
    <div class="org">UNICC AI Safety Lab — Council of Experts Assessment</div>
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

  <!-- Risk summary heatmap -->
  <h2>Risk summary</h2>
  ${renderRiskSummaryTable(report.riskSummary ?? [])}

  <!-- Module sections -->
  ${moduleSections}

  <!-- Actionable recommendations -->
  <h2>Actionable recommendations</h2>
  <div class="recommendations">
    ${renderRecommendations(report.recommendations ?? [])}
  </div>

  <!-- Council deliberation -->
  <h2>Council deliberation</h2>
  ${renderCouncilDeliberation(report)}

  <!-- Council analysis (full reasoning) -->
  <h2>Council analysis — full reasoning</h2>
  <div class="council-analysis">${esc(report.councilAnalysis)}</div>

  <!-- Footer -->
  <div class="footer">
    Generated by AEGIS AI Safety Lab &middot; UNICC &middot; ${generatedDate}
  </div>

</body>
</html>`;
}
