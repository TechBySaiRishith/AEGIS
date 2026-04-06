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

type HTMLReportOptions = {
  autoPrint?: boolean;
};

export function renderHTMLReport(report: EvaluationReport, options: HTMLReportOptions = {}): string {
  const verdictColours = VERDICT_COLOURS[report.verdict] ?? VERDICT_COLOURS.REVIEW;
  const autoPrint = options.autoPrint ?? false;

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
     :root {
       --ink: #0f172a;
       --muted: #475569;
       --line: #dbe3ef;
       --panel: #f8fafc;
       --panel-strong: #eef2f7;
       --brand: #111827;
       --accent: #2563eb;
     }
     body {
       font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       color: var(--ink);
       background: #ffffff;
       line-height: 1.6;
       padding: 2rem 2.25rem 3rem;
       max-width: 1080px;
       margin: 0 auto;
     }

     /* ── Typography ────────────────────────────────────── */
     h1 { font-size: 2rem; margin-bottom: 0.25rem; letter-spacing: -0.03em; }
     h2 { font-size: 1.18rem; margin-top: 2rem; margin-bottom: 0.75rem; border-bottom: 2px solid var(--line); padding-bottom: 0.35rem; }
     h3 { font-size: 1.05rem; margin-top: 1rem; margin-bottom: 0.5rem; }
     h4 { font-size: 0.95rem; margin-top: 0.75rem; margin-bottom: 0.4rem; color: #334155; }
     p { margin-bottom: 0.75rem; }
     a { color: inherit; }
 
     /* ── Layout helpers ────────────────────────────────── */
     .section { margin-top: 1.75rem; }
     .section-card {
       background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
       border: 1px solid var(--line);
       border-radius: 16px;
       padding: 1.2rem 1.3rem;
       box-shadow: 0 14px 40px rgba(15, 23, 42, 0.05);
     }
     .section-card + .section-card { margin-top: 1rem; }
     .muted { color: var(--muted); }
     .eyebrow {
       font-size: 0.72rem;
       font-weight: 700;
       letter-spacing: 0.18em;
       text-transform: uppercase;
       color: #64748b;
     }

     /* ── Header ────────────────────────────────────────── */
     .header {
       position: relative;
       margin-bottom: 2rem;
       padding: 1.5rem;
       border: 1px solid var(--line);
       border-radius: 22px;
       background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.1), transparent 34%), linear-gradient(180deg, #ffffff, #f8fafc);
       overflow: hidden;
     }
     .header-row {
       display: flex;
       flex-wrap: wrap;
       justify-content: space-between;
       gap: 1rem;
       align-items: flex-start;
     }
     .brand-block {
       display: flex;
       gap: 1rem;
       align-items: flex-start;
     }
     .crest {
       width: 3rem;
       height: 3rem;
       border-radius: 14px;
       display: inline-flex;
       align-items: center;
       justify-content: center;
       font-size: 1.35rem;
       font-weight: 800;
       color: #fff;
       background: linear-gradient(135deg, #0f172a, #2563eb);
       box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
     }
     .header .logo { font-size: 1.9rem; font-weight: 800; letter-spacing: 0.08em; color: var(--brand); }
     .header .subtitle { font-size: 1rem; color: var(--muted); }
     .header .org { font-size: 0.83rem; color: #64748b; margin-top: 0.2rem; }
     .document-meta {
       min-width: 260px;
       display: grid;
       gap: 0.75rem;
       grid-template-columns: repeat(2, minmax(0, 1fr));
     }
     .document-meta .meta-tile {
       border: 1px solid var(--line);
       background: rgba(255,255,255,0.8);
       border-radius: 14px;
       padding: 0.85rem 0.95rem;
     }
     .document-meta .meta-label {
       font-size: 0.72rem;
       font-weight: 700;
       letter-spacing: 0.16em;
       text-transform: uppercase;
       color: #64748b;
     }
     .document-meta .meta-value {
       margin-top: 0.35rem;
       font-size: 0.95rem;
       color: var(--ink);
       word-break: break-word;
     }
 
     /* ── Toolbar ───────────────────────────────────────── */
     .toolbar {
       display: flex;
       justify-content: flex-end;
       gap: 0.75rem;
       margin-bottom: 1rem;
     }
     .toolbar button {
       appearance: none;
       border: 1px solid #cbd5e1;
       background: #ffffff;
       color: var(--brand);
       padding: 0.72rem 1rem;
       border-radius: 999px;
       font-size: 0.8rem;
       font-weight: 700;
       letter-spacing: 0.1em;
       text-transform: uppercase;
       cursor: pointer;
       transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
       box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
     }
     .toolbar button:hover {
       transform: translateY(-1px);
       border-color: #94a3b8;
       box-shadow: 0 14px 30px rgba(37, 99, 235, 0.14);
     }

     /* ── App info ──────────────────────────────────────── */
     .app-info {
       background: var(--panel);
       border: 1px solid var(--line);
       border-radius: 18px;
       padding: 1.1rem 1.25rem;
       margin-bottom: 1.5rem;
     }
     .app-info-grid {
       display: grid;
       gap: 0.9rem 1.25rem;
       grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
     }
     .app-info dt {
       font-size: 0.72rem;
       font-weight: 700;
       letter-spacing: 0.14em;
       text-transform: uppercase;
       color: #64748b;
     }
     .app-info dd {
       margin-top: 0.35rem;
       color: var(--ink);
       word-break: break-word;
     }

     /* ── Verdict banner ────────────────────────────────── */
     .verdict-banner {
       padding: 1.15rem 1.35rem;
       border-radius: 18px;
       margin-bottom: 1.5rem;
       display: flex;
       flex-wrap: wrap;
       gap: 0.75rem;
       align-items: center;
       justify-content: space-between;
       box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
     }
     .verdict-banner .verdict-label { font-size: 1.5rem; font-weight: 700; }
     .verdict-banner .confidence { font-size: 1rem; opacity: 0.9; }
     .verdict-banner .verdict-support {
       font-size: 0.82rem;
       letter-spacing: 0.12em;
       text-transform: uppercase;
       opacity: 0.82;
     }

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
     th, td { text-align: left; padding: 8px 10px; border: 1px solid var(--line); vertical-align: top; }
     th { background: var(--panel-strong); font-weight: 600; }
     .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.8rem; word-break: break-all; }

     /* ── Risk summary table ────────────────────────────── */
     .risk-table .score-cell { font-weight: 700; font-size: 1rem; }
    .risk-table .count { text-align: center; font-weight: 600; }
    .risk-table .critical-count { color: ${SEVERITY_COLOURS.critical}; }
    .risk-table .high-count { color: ${SEVERITY_COLOURS.high}; }
    .risk-table .medium-count { color: ${SEVERITY_COLOURS.medium}; }
    .risk-table .low-count { color: ${SEVERITY_COLOURS.low}; }

     /* ── Module sections ───────────────────────────────── */
     .module-section {
       margin-bottom: 2rem;
       page-break-inside: avoid;
       border: 1px solid var(--line);
       border-radius: 18px;
       padding: 1.15rem 1.2rem;
       background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
     }
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
     .council-analysis { white-space: pre-wrap; background: #f8fafc; border: 1px solid var(--line); border-radius: 16px; padding: 1rem; font-size: 0.9rem; line-height: 1.5; }
     .deliberation-section { margin-bottom: 1rem; padding: 0.75rem; background: #fefce8; border: 1px solid #fde68a; border-radius: 6px; }
     .deliberation-section h4 { margin-top: 0; }
     .deliberation-section ul { margin-left: 1.25rem; }
     .deliberation-section li { margin-bottom: 0.4rem; font-size: 0.85rem; }
    .deliberation-section li.corroboration { color: #15803d; }
    .deliberation-section li.disagreement { color: #b91c1c; }
    .arb-process { white-space: pre-wrap; background: #1f2937; color: #e5e7eb; padding: 0.75rem; border-radius: 4px; font-size: 0.8rem; line-height: 1.5; overflow-x: auto; }

     /* ── Footer ─────────────────────────────────────────── */
     .footer {
       margin-top: 3rem;
       padding-top: 1rem;
       border-top: 1px solid var(--line);
       font-size: 0.8rem;
       color: #64748b;
       text-align: center;
     }

     /* ── Print styles ──────────────────────────────────── */
     @page { margin: 1cm; size: A4; }
     @media print {
       body {
         padding: 0;
         max-width: none;
         color: #000000;
         background: #ffffff;
       }
       .no-print { display: none !important; }
       .header,
       .app-info,
       .section-card,
       .module-section,
       .council-analysis {
         box-shadow: none !important;
       }
       .section,
       .module-section { page-break-inside: avoid; }
       .verdict-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
       .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
       .arb-process { background: #f3f4f6 !important; color: #1f2937 !important; }
     }
   </style>
  ${autoPrint ? `<script>window.addEventListener("load", () => window.setTimeout(() => window.print(), 350));</script>` : ""}
</head>
<body>

  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <!-- Header -->
  <div class="header">
    <div class="header-row">
      <div class="brand-block">
        <div class="crest">A</div>
        <div>
          <div class="eyebrow">Official evaluation dossier</div>
          <div class="logo">AEGIS</div>
          <div class="subtitle">AI Safety Evaluation Report</div>
          <div class="org">UNICC AI Safety Lab — Council of Experts assessment</div>
        </div>
      </div>
      <div class="document-meta">
        <div class="meta-tile">
          <div class="meta-label">Generated</div>
          <div class="meta-value">${generatedDate}</div>
        </div>
        <div class="meta-tile">
          <div class="meta-label">Report ID</div>
          <div class="meta-value mono">${esc(report.id)}</div>
        </div>
        <div class="meta-tile">
          <div class="meta-label">Application</div>
          <div class="meta-value">${esc(report.applicationName)}</div>
        </div>
        <div class="meta-tile">
          <div class="meta-label">Verdict</div>
          <div class="meta-value">${esc(report.verdict)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Application info -->
  <div class="app-info">
    <dl class="app-info-grid">
      <div>
        <dt>Application</dt>
        <dd>${esc(report.applicationName)}</dd>
      </div>
      <div>
        <dt>Description</dt>
        <dd>${esc(report.applicationDescription || "—")}</dd>
      </div>
      <div>
        <dt>Evaluation date</dt>
        <dd>${generatedDate}</dd>
      </div>
      <div>
        <dt>Confidence</dt>
        <dd>${(report.confidence * 100).toFixed(0)}%</dd>
      </div>
    </dl>
  </div>

  <!-- Verdict banner -->
  <div class="verdict-banner" style="background:${verdictColours.bg};color:${verdictColours.fg}">
    <div>
      <div class="verdict-support">Council decision</div>
      <span class="verdict-label">${esc(report.verdict)}</span>
    </div>
    <span class="confidence">Confidence: ${(report.confidence * 100).toFixed(0)}%</span>
  </div>

  <!-- Executive summary -->
  <section class="section">
    <h2>Executive summary</h2>
    <div class="executive-summary section-card">
      <p>${nl2br(report.executiveSummary)}</p>
    </div>
  </section>

  <!-- Risk summary heatmap -->
  <section class="section">
    <h2>Risk summary</h2>
    <div class="section-card">
      ${renderRiskSummaryTable(report.riskSummary ?? [])}
    </div>
  </section>

  <!-- Module sections -->
  <section class="section">
    <h2>Expert module findings</h2>
  ${moduleSections}
  </section>

  <!-- Actionable recommendations -->
  <section class="section">
    <h2>Actionable recommendations</h2>
    <div class="recommendations section-card">
      ${renderRecommendations(report.recommendations ?? [])}
    </div>
  </section>

  <!-- Council deliberation -->
  <section class="section">
    <h2>Council deliberation</h2>
    <div class="section-card">
      ${renderCouncilDeliberation(report)}
    </div>
  </section>

  <!-- Council analysis (full reasoning) -->
  <section class="section">
    <h2>Council analysis — full reasoning</h2>
    <div class="council-analysis">${esc(report.councilAnalysis)}</div>
  </section>

  <!-- Footer -->
  <div class="footer">
    Generated by AEGIS AI Safety Lab &middot; UNICC &middot; ${generatedDate}<br>
    Prepared for institutional review and browser-based PDF export.
  </div>

</body>
</html>`;
}
