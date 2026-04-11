# AEGIS — Evaluator Guide

Guide for capstone evaluators and graders. This document explains how to run AEGIS, what to expect, and how the implementation maps to the grading rubric.

> **Course:** NYU SPS MASY GC-4100 — Spring 2026
>
> **Project:** AEGIS — Council of Experts AI Safety Lab (UNICC)

---

## Table of Contents

- [Quick Start (5 Minutes)](#quick-start-5-minutes)
- [What to Expect](#what-to-expect)
- [Running with Real LLM Analysis](#running-with-real-llm-analysis)
- [Submitting VeriMedia for Evaluation](#submitting-verimedia-for-evaluation)
- [Reading the Report](#reading-the-report)
- [Understanding the Verdict](#understanding-the-verdict)
- [Web Dashboard Walkthrough](#web-dashboard-walkthrough)
- [Rubric Mapping](#rubric-mapping)
- [Troubleshooting](#troubleshooting)

---

## Quick Start (5 Minutes)

### Prerequisites

- **Docker** and **Docker Compose** installed
- (Optional) An Anthropic API key for real LLM analysis

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-org/aegis.git
cd aegis

# 2. Create environment file
cp .env.example .env

# 3. Build and start
docker compose up --build
```

Wait ~30 seconds for health checks to pass. You'll see log output from both the API and web services.

> **Port note:** Docker exposes a single port — **5555** — where the Next.js web server serves the UI and proxies `/api/*` to the internal API. All URLs in this guide use `5555`. If you are running in local-dev mode (`pnpm dev`) instead of Docker, substitute `5555` → `3001` for API calls and `5555` → `3000` for the web UI.

### Verify It's Running

```bash
# Health check
curl http://localhost:5555/api/health
```

Expected output:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "providers": { "anthropic": { "available": true, "model": "claude-sonnet-4-5-20250514" }, ... },
  "modules": { "sentinel": { "ready": true }, "watchdog": { "ready": true }, "guardian": { "ready": true } }
}
```

### Open the Dashboard

Navigate to **[http://localhost:5555](http://localhost:5555)** in your browser.

---

## What to Expect

### With Real LLM Analysis

When an API key is configured (e.g., `ANTHROPIC_API_KEY`), AEGIS sends actual code and prompts to the LLM:

- Expert modules send **structured prompts** with the application's source code to the LLM
- Each module receives a JSON response with findings, scores, and recommendations
- The Council Synthesizer optionally runs a **cross-expert critique round** using the LLM
- Evaluations take 30–120 seconds depending on repository size and LLM latency

---

## Running with Real LLM Analysis

To use real AI-powered analysis:

```bash
# Edit .env
nano .env
```

Set your Anthropic API key:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

Restart the services:

```bash
docker compose down
docker compose up --build
```

Verify that the health check shows `anthropic: { "available": true }`.

> **Copilot Enterprise alternative:** If you have GitHub Copilot Enterprise, you can skip the Anthropic key entirely. Run `copilot-api auth` (one-time browser login), then set `COPILOT_GITHUB_TOKEN` in `.env`. This gives AEGIS access to premium models such as `copilot/gpt-5.4` and `copilot/claude-opus-4.6` at no additional per-token cost.

---

## Submitting VeriMedia for Evaluation

### Via the Web Dashboard

1. Open **[http://localhost:5555](http://localhost:5555)**
2. Enter a GitHub repository URL (e.g., `https://github.com/FlashCarrot/VeriMedia`)
3. Optionally add a description
4. Click **Evaluate**
5. Watch the real-time progress on the evaluation page
6. View the results when complete

### Via curl

```bash
# Start an evaluation
curl -X POST http://localhost:5555/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "inputType": "github_url",
    "source": "https://github.com/FlashCarrot/VeriMedia",
    "description": "VeriMedia — multimodal media-verification LLM pipeline"
  }'
```

Save the `evaluationId` from the response, then:

```bash
# Check status (poll until status is "completed")
curl http://localhost:5555/api/evaluations/<evaluationId>

# Get JSON report
curl http://localhost:5555/api/evaluations/<evaluationId>/report

# View HTML report in browser
open "http://localhost:5555/api/evaluations/<evaluationId>/report/html"
```

### Suggested Test Repositories

| Repository | Why It's a Good Test |
|---|---|
| `vercel/ai-chatbot` | Production Next.js app with AI SDK integration — exercises all three modules |
| `langchain-ai/langchain` | Large Python LLM framework — tests Watchdog's AI integration detection |
| `open-webui/open-webui` | Complex web UI with multiple AI providers — tests Sentinel and Guardian |

---

## Reading the Report

### JSON Report Structure

The report (`/api/evaluations/:id/report`) contains:

| Section | Description |
|---|---|
| `executiveSummary` | Multi-paragraph overview: what was evaluated, what was found, verdict explanation |
| `verdict` | `"APPROVE"`, `"REVIEW"`, or `"REJECT"` |
| `confidence` | 0.0–1.0 — how confident the system is in the verdict |
| `moduleSummaries` | Per-module breakdown: score, risk level, findings, recommendations |
| `councilAnalysis` | Council synthesis narrative — verdict reasoning, cross-module observations |

### HTML Report

The HTML report (`/api/evaluations/:id/report/html`) renders the same data as a printable, styled page with:
- Colour-coded verdict badge (green/amber/red)
- Per-module findings tables sorted by severity
- Council analysis narrative

---

## Understanding the Verdict

### How the Verdict is Computed

The verdict is computed **algorithmically** via a deterministic 5-pass arbitration — no LLM is needed for the final decision:

```
Pass 1 — REJECT scan   Any completed module score < 30 OR any critical finding
Pass 2 — REVIEW scan   Any completed module score < 60 OR high findings in ≥ 2 modules
Coverage floor         Only 1 of 3 modules completed?  → downgrade APPROVE → REVIEW
                       (cap confidence at 0.5; REJECT is never downgraded)
Pass 3 — Cross-ref     Corroborate findings whose category appears in ≥ 2 modules
Pass 4 — Disagreement  Score Δ ≥ 30 or risk-level Δ ≥ 2 → defer to the stricter module
Pass 5 — Confidence    Baseline from verdict unanimity, ± boosts/penalties
```

Failed modules carry a placeholder `score: 0` but are **excluded from Pass 1/Pass 2** so a single crashed expert cannot drag the council to REJECT. Their coverage loss is accounted for in Pass 5 (−0.15 per failure) and, when fewer than two modules complete, by the coverage floor.

### What Each Module Scores

| Module | Framework | Focus |
|---|---|---|
| **Sentinel** (🛡️) | CWE/OWASP Web Application Security | Injection, auth flaws, hardcoded secrets, unsafe operations |
| **Watchdog** (🔍) | OWASP LLM Top 10 / Cisco AI Threat Taxonomy | Prompt injection, jailbreak vectors, data exfiltration, excessive agency |
| **Guardian** (⚖️) | NIST AI RMF / EU AI Act / UNICC Responsible AI | Transparency, bias, privacy, regulatory compliance, documentation |

Watchdog additionally tags every finding with an OWASP LLM Top-10 category ID (`OWASP-LLM01` … `OWASP-LLM10`). The results page renders a **per-category breakdown panel** under the Watchdog card, grouping findings by category and showing coverage (`N/10 categories flagged`), the worst severity per bucket, and the raw count — making it easy to see which parts of the LLM Top-10 surface the application touches.

### Confidence

Confidence measures conviction in the verdict, not app quality:

- **Baseline** — `modules_agreeing_with_verdict / completed_modules × 0.9`
- **+ tight-σ boost** — 3 modules agree, score dispersion σ < 10 → `+0.05`
- **+ corroboration boost** — `+0.02` per corroborated finding (cap `+0.05`)
- **− disagreement penalty** — `−0.10` per flagged disagreement
- **− coverage penalty** — `−0.15` per failed module
- **coverage-floor cap** — when only 1 of 3 modules completed, confidence is capped at `0.5`

Final confidence is clamped to `[0.1, 0.98]`.

---

## Web Dashboard Walkthrough

### Home Page
- New evaluation form (enter GitHub URL or conversation JSON path)
- List of past evaluations with status badges

### Evaluation Page (In Progress)
- Real-time status updates via SSE
- Progress indicators for each expert module
- Live status: `cloning → analyzing → sentinel/watchdog/guardian → synthesizing → completed`

### Results Page (Completed)
- Verdict badge with confidence score
- Per-module cards showing score, risk level, and finding counts
- Expandable findings with severity badges, evidence, and remediation
- Council analysis narrative
- Links to JSON and HTML reports

---

## Rubric Mapping

### D1 — Architecture & Design

| Criterion | AEGIS Implementation |
|---|---|
| **Modular architecture** | Monorepo with three workspace packages (`@aegis/api`, `@aegis/web`, `@aegis/shared`). Expert modules implement a common `ExpertModule` interface. |
| **Design patterns** | Council of Experts (MoE), Strategy pattern (LLM providers), Observer pattern (SSE events), Dependency injection (LLM registry resolves providers per module). |
| **Separation of concerns** | Intake, experts, council, reports, LLM, and database are separate directories with clean interfaces. Shared types prevent coupling. |
| **Error handling** | Multi-level graceful degradation: individual experts catch errors, pipeline continues on partial failures, LLM critique round falls back to algorithmic verdict. |

### D2 — Implementation Quality

| Criterion | AEGIS Implementation |
|---|---|
| **TypeScript throughout** | Strict TypeScript across all packages. Shared types (`@aegis/shared`) ensure type safety across API, experts, and frontend. |
| **Clean code** | Consistent naming, no magic numbers (thresholds are named constants), JSDoc on key interfaces, well-structured modules. |
| **Database** | SQLite with Drizzle ORM — typed schema, relational integrity (foreign keys with cascade), clean query layer. |
| **Async patterns** | `Promise.allSettled()` for parallel expert execution; SSE for real-time streaming; fire-and-forget with error propagation. |

### D3 — Functionality & Features

| Criterion | AEGIS Implementation |
|---|---|
| **Core feature** | End-to-end AI safety evaluation: submit repo → parallel expert analysis → synthesized verdict → structured report |
| **Multi-input support** | GitHub URLs (with clone), conversation JSON, API endpoints |
| **Real-time updates** | SSE event stream with replay, status progression, per-module progress |
| **Report generation** | JSON and HTML report formats from structured data (no LLM for reports) |
| **Multi-provider LLM** | Anthropic, Copilot (GitHub Copilot Enterprise), OpenAI, GitHub Models, custom endpoints (Ollama, vLLM) |
| **Configurable** | Per-module model configuration, environment-driven |

### D4 — Documentation & Presentation

| Criterion | AEGIS Implementation |
|---|---|
| **README** | Comprehensive (~650 lines): architecture diagrams, expert module details, API reference, quick start guides, LLM configuration |
| **Architecture doc** | `docs/ARCHITECTURE.md`: deep-dive into module communication, LLM layer, database schema, synthesis pipeline, SSE system |
| **API reference** | `docs/API.md`: every endpoint with curl examples, request/response schemas, SSE event format, type reference |
| **Evaluator guide** | `docs/EVALUATION.md` (this file): step-by-step setup, test scenarios, rubric mapping |
| **Code documentation** | JSDoc on key interfaces, inline comments on non-obvious logic, well-named functions |

---

## Troubleshooting

### Docker Compose Fails to Start

```bash
# Check for port conflicts
lsof -i :5555

# Rebuild from scratch
docker compose down -v
docker compose up --build
```

### API Returns "No LLM provider available"

Ensure at least one provider is configured in `.env`:

```bash
# Option A: Set a real API key
ANTHROPIC_API_KEY=sk-ant-api03-...

# Option B: Use GitHub Copilot Enterprise (run `copilot-api auth` first)
# Provides access to premium models like copilot/gpt-5.4, copilot/claude-opus-4.6, etc.
COPILOT_GITHUB_TOKEN=ghu_...
```

### Evaluation Stuck in "cloning" Status

- Check that the repository URL is valid and accessible
- For private repos, set `GITHUB_TOKEN` in `.env`
- Check Docker logs: `docker compose logs api`

### Frontend Shows Blank Page

- Verify the container is running: `docker compose ps`
- In Docker the web server proxies `/api/*` internally, so you should not need to set `NEXT_PUBLIC_API_URL`. If you customized it, make sure it points at `http://localhost:5555`.
- Check browser console for CORS errors

### "Evaluation is not completed" When Requesting Report

Reports are only available after the evaluation reaches `"completed"` status. Check the evaluation status first:

```bash
curl http://localhost:5555/api/evaluations/<id>
```

If `status` is `"failed"`, check the `error` field for the reason.

---

## Shutting Down

```bash
# Stop all services
docker compose down

# Stop and remove volumes (resets database)
docker compose down -v
```
