# AEGIS — Council of Experts AI Safety Lab

**AEGIS** (Adversarial Evaluation & Governance Intelligence System) is an automated AI safety evaluation platform built for the [UNICC](https://www.unicc.org/) AI Safety Lab. It analyzes AI-integrated repositories, conversation logs, and API endpoints through a **Council of Experts** architecture — three independent, framework-grounded expert modules that run in parallel, followed by an algorithmic synthesis pipeline that produces a deterministic safety verdict: **APPROVE**, **REVIEW**, or **REJECT**.

> **NYU SPS MASY GC-4100 — Spring 2026 Capstone Project**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Expert Modules](#expert-modules)
  - [Sentinel — Code & Security Analysis](#sentinel--code--security-analysis)
  - [Watchdog — LLM Safety & Adversarial Analysis](#watchdog--llm-safety--adversarial-analysis)
  - [Guardian — Governance & Compliance](#guardian--governance--compliance)
- [Council of Experts Synthesis](#council-of-experts-synthesis)
- [Quick Start — Docker (Recommended)](#quick-start--docker-recommended)
- [Quick Start — Local Development](#quick-start--local-development)
- [API Reference](#api-reference)
  - [Health Check](#health-check)
  - [Start Evaluation](#start-evaluation)
  - [List Evaluations](#list-evaluations)
  - [Get Evaluation](#get-evaluation)
  - [SSE Event Stream](#sse-event-stream)
  - [JSON Report](#json-report)
  - [HTML Report](#html-report)
- [SSE Event System](#sse-event-system)
- [Environment Variables](#environment-variables)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [LLM Provider Configuration](#llm-provider-configuration)
- [UNICC Alignment](#unicc-alignment)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

### What AEGIS Does

AEGIS accepts three input types:

| Input Type | Description |
|---|---|
| **GitHub URL** | Clones the repository, profiles the application (language, framework, dependencies, AI integrations), and runs all three expert modules against the source code. |
| **Conversation JSON** | Parses an LLM conversation log (system prompts, user/assistant messages) and evaluates it for safety risks, prompt injection vectors, and governance gaps. |
| **API Endpoint** | Profiles a live API endpoint for safety analysis (planned — currently creates a metadata-only profile). |

### The Council of Experts Architecture

AEGIS implements a **Mixture of Experts (MoE)** pattern where three specialist modules evaluate every submission independently and in parallel. Each expert is grounded in a different industry-standard safety framework:

| Module | Focus | Framework |
|---|---|---|
| 🛡️ **Sentinel** | Code & security | CWE/OWASP Web Application Security |
| 🔍 **Watchdog** | LLM safety & adversarial | OWASP LLM Top 10 / Cisco AI Threat Taxonomy |
| ⚖️ **Guardian** | Governance & compliance | NIST AI RMF / EU AI Act / UNICC Responsible AI |

After all experts complete, the **Council Synthesizer** computes a deterministic verdict:

| Verdict | Meaning |
|---|---|
| ✓ **APPROVE** | All modules passed with acceptable scores; no critical or high-risk concerns |
| ⚠ **REVIEW** | Significant concerns identified; manual review required before deployment |
| ✗ **REJECT** | Critical safety issues detected; remediation mandatory |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Client (Browser / curl)                        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                    POST /api/evaluate
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                     API Server (Hono + Node.js)                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     INTAKE PIPELINE                             │    │
│  │  Clone repo → Profile application → Extract file structure      │    │
│  │  Detect: framework, language, AI integrations, entry points     │    │
│  └──────────────────────────┬──────────────────────────────────────┘    │
│                              │                                          │
│            ┌─────────────────┼─────────────────┐                       │
│            ▼                 ▼                  ▼                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │  🛡️ Sentinel  │  │  🔍 Watchdog  │  │  ⚖️ Guardian  │  ◄── parallel │
│  │  CWE / OWASP │  │  LLM Top 10  │  │  NIST AI RMF │                 │
│  │  Code &      │  │  Adversarial  │  │  Governance   │                │
│  │  Security    │  │  & LLM Safety │  │  & Compliance │                │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                  │                         │
│         └──────────────────┼──────────────────┘                        │
│                            ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   COUNCIL SYNTHESIZER                           │   │
│  │  1. Algorithmic verdict  (always — deterministic, no LLM)      │   │
│  │  2. LLM critique round   (optional — enriches narrative)       │   │
│  │  3. Disagreement detection (Δ ≥ 30 between module scores)      │   │
│  └──────────────────────────┬──────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    REPORT GENERATOR                             │   │
│  │  Executive summary, per-module sections, council analysis       │   │
│  │  Available as JSON (/report) or HTML (/report/html)             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────┐           │
│  │  SQLite DB   │  │  SSE Event Bus   │  │  LLM Registry  │           │
│  │  (Drizzle)   │  │  (per eval)      │  │  (multi-prov.) │           │
│  └─────────────┘  └──────────────────┘  └────────────────┘           │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Algorithmic verdict is authoritative** | The LLM critique round _never_ overrides the algorithmic verdict. LLMs enrich the narrative; deterministic rules decide the outcome. This ensures reproducibility and auditability. |
| **Experts run in parallel** | All three modules run via `Promise.allSettled()`. If one fails, the others still complete and the verdict adjusts confidence downward. |
| **Graceful degradation** | If no LLM is available or the critique round fails, AEGIS still produces a valid verdict from the algorithmic path. |
| **Multi-provider LLM registry** | Each module can use a different LLM provider. The registry auto-discovers available providers from environment variables at startup. |

---

## Expert Modules

### Sentinel — Code & Security Analysis

**Framework:** CWE/SANS Top 25, OWASP Web Application Security

Sentinel performs static security analysis on the application's source code. It reads prioritised source files (entry points, AI integration code, config files) up to a 50 KB context budget and sends them to the LLM with a structured prompt grounded in CWE identifiers.

**What it analyzes:**
- Injection vulnerabilities (SQL, command, XSS)
- Authentication and session management flaws
- Hardcoded secrets and credential exposure
- Insecure data handling and storage
- Dependency-level risks (known vulnerable packages)
- Unsafe deserialization and file operations

**Output:** Each finding includes a severity (critical/high/medium/low/info), CWE framework reference, evidence with file path and line number, and a remediation recommendation.

**Score computation:** If the LLM does not return a numeric score, Sentinel derives one: starting at 100, each critical finding deducts 15 points, high deducts 8, medium deducts 4, and low deducts 1.

<details>
<summary>Example finding (JSON)</summary>

```json
{
  "id": "sentinel-1-a3f8b2c1",
  "title": "Hardcoded API key in configuration",
  "severity": "high",
  "category": "Credentials",
  "description": "API key is committed to source control in config.ts",
  "evidence": [{
    "filePath": "src/config.ts",
    "lineNumber": 12,
    "snippet": "const API_KEY = \"sk-live-abc123...\"",
    "description": "Hardcoded secret in source"
  }],
  "remediation": "Move secret to environment variable and add to .gitignore",
  "framework": "CWE-798"
}
```
</details>

---

### Watchdog — LLM Safety & Adversarial Analysis

**Framework:** OWASP LLM Top 10, Cisco AI Threat Taxonomy

Watchdog specialises in AI/LLM-specific risks. It uses a content-aware file selection strategy that prioritises files matching AI-related path patterns (`/llm/`, `/openai/`, `/prompt/`, `/agent/`, etc.) and content patterns (`ChatCompletion`, `systemPrompt`, `tool_choice`, `@ai-sdk`, etc.), scoring each file for relevance before sending the most relevant code to the LLM.

**What it analyzes:**
- Prompt injection and jailbreak vectors (LLM01)
- Insecure output handling (LLM02)
- Training data poisoning risks (LLM03)
- Model denial of service (LLM04)
- Supply chain vulnerabilities in AI dependencies (LLM05)
- Sensitive information disclosure through prompts (LLM06)
- Insecure plugin/tool design (LLM07)
- Excessive agency and autonomy (LLM08)
- Overreliance on LLM outputs (LLM09)
- Model theft and exfiltration (LLM10)

**File prioritisation:** Watchdog scores every file in the repository by path relevance (0–10 based on AI path patterns) and content relevance (0–20 based on AI content patterns). Files explicitly listed in the application profile's `aiIntegrations` array get a +15 boost. The top-scored files are read up to a 100K character budget.

---

### Guardian — Governance & Compliance

**Framework:** NIST AI RMF, EU AI Act, UNICC Responsible AI Principles

Guardian reads governance-relevant files — documentation, dependency manifests, configuration, and data-handling code — rather than the full source tree. Its file selection strategy prioritises README files, LICENSE, SECURITY.md, model cards, privacy policies, and dependency manifests, then config files, then AI model code, then data-handling code.

**What it analyzes:**
- Transparency and documentation completeness
- Model card and data sheet availability
- Bias and fairness considerations
- Privacy and data protection (GDPR, data retention)
- Human oversight and escalation mechanisms
- Supply chain provenance (dependency licensing)
- Regulatory compliance (EU AI Act risk categories)
- Responsible AI principle adherence

**Relevance scoring:** Files are scored 0–100 for governance relevance: governance docs (100), dependency manifests (80), config files (60), AI/model code (40), data-handling code (30). Guardian reads up to 40 files within a 120K character budget.

---

## Council of Experts Synthesis

The synthesis pipeline runs in two stages. Stage 1 always runs; Stage 2 is optional.

### Stage 1: Algorithmic Verdict (Deterministic — No LLM Required)

The algorithmic verdict is computed from expert scores and findings using fixed thresholds:

| Condition | Result |
|---|---|
| Any module score < 30 **OR** any critical finding | **REJECT** |
| Any module score < 60 **OR** high findings across ≥ 2 modules | **REVIEW** |
| All modules pass | **APPROVE** |

**Confidence** = mean(module scores) / 100, rounded to two decimal places.

If any module failed to complete, confidence is reduced by 0.15 per failed module.

### Stage 2: LLM Critique Round (Optional — Enhances Narrative)

When an LLM provider is available for the synthesizer, AEGIS runs a **cross-expert critique round**:

1. All three assessments are sent to the LLM (the "Council Arbiter")
2. The LLM identifies **agreements** (reinforcing findings), **conflicts** (opposing conclusions), and **additions** (gaps no module covered)
3. The LLM produces a 2–3 paragraph narrative synthesis
4. Score disagreements (Δ ≥ 30 between any two modules) are automatically detected and merged with LLM critiques

**The LLM never overrides the algorithmic verdict.** It only enriches the reasoning and surfaces cross-expert insights.

If the critique round fails for any reason (LLM error, timeout, parsing failure), AEGIS gracefully falls back to the algorithmic-only result.

---

## Quick Start — Docker (Recommended)

**Prerequisites:** Docker and Docker Compose installed.

```bash
# 1. Clone the repository
git clone https://github.com/your-org/aegis.git
cd aegis

# 2. Create your environment file
cp .env.example .env
# Edit .env — add at least one API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)

# 3. Build and start all services
docker compose up -d
```

Wait for the health checks to pass (about 30 seconds), then:

| Service | URL |
|---|---|
| **Web UI** | [http://localhost:5555](http://localhost:5555) |
| **API** (proxied through the web server) | [http://localhost:5555/api](http://localhost:5555/api) |
| **Health** | [http://localhost:5555/api/health](http://localhost:5555/api/health) |

> In Docker mode a single container serves both the Next.js web UI and the Hono API on port **5555**. The API is exposed via the `/api/*` path prefix — the Next.js server proxies those requests to the internal API process. Use `5555` for every `curl` example in the API Reference below.

### Test with a real evaluation

```bash
curl -X POST http://localhost:5555/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "inputType": "github_url",
    "source": "https://github.com/vercel/ai-chatbot",
    "description": "Vercel AI Chatbot — a Next.js chatbot using the AI SDK"
  }'
```

Response:
```json
{
  "evaluationId": "abc123...",
  "status": "pending"
}
```

Then poll for results:
```bash
curl http://localhost:5555/api/evaluations/abc123...
```

### Use with a specific LLM provider

Set an API key in `.env`:

```bash
# Edit .env — uncomment and set your key:
ANTHROPIC_API_KEY=sk-ant-api03-...

# Restart
docker compose down && docker compose up --build
```

---

## Quick Start — Local Development

**Prerequisites:** Node.js ≥ 20, [pnpm](https://pnpm.io/) (if you don't have pnpm: `npm install -g pnpm`). On platforms without prebuilt `better-sqlite3` binaries, a C++ toolchain is also needed (`build-essential` on Debian/Ubuntu, Xcode CLT on macOS) — see the [better-sqlite3 note](#better-sqlite3-native-binary) below, or use Docker to skip this entirely.

```bash
# One-command setup (installs pnpm if needed, then dependencies + .env)
bash setup.sh

# Or manually:
pnpm install
cp .env.example .env

# Start API server and Web UI in development mode
pnpm dev
```

The API starts on `http://localhost:3001` and the web UI on `http://localhost:3000`.

### Available Commands

```bash
pnpm dev                              # Start all services in dev mode (parallel)
pnpm build                            # Build all packages
pnpm lint                             # Lint all packages
pnpm test                             # Run tests across all packages
pnpm --filter @aegis/api test:coverage  # Enforce api coverage thresholds (global + per-file)
pnpm --filter @aegis/web test         # Run web component tests (React Testing Library)
pnpm --filter @aegis/web test:e2e     # Run Playwright end-to-end suite
pnpm docker:up                        # Build and start Docker containers
pnpm docker:down                      # Stop Docker containers
```

### Testing & Coverage

The test pyramid enforced in CI:

| Layer | Command | What it covers |
|---|---|---|
| **API unit + integration** | `pnpm --filter @aegis/api test` | Council arbitration, intake profiling, report generator, LLM registry, full pipeline with a fake LLM provider |
| **API coverage gate** | `pnpm --filter @aegis/api test:coverage` | Global floor (74% lines, 67% branches, 85% functions) plus per-file floors for `algorithmic.ts` (95/92/98), `analyze.ts`, `generator.ts`, `registry.ts` |
| **Web components** | `pnpm --filter @aegis/web test` | React Testing Library with jsdom |
| **E2E** | `pnpm --filter @aegis/web test:e2e` | Playwright running `next dev` against intercepted `/api/health` routes |

CI wires all four into `.github/workflows/ci.yml` — regressions below any coverage floor fail the build.

---

## API Reference

All API endpoints are prefixed with `/api/`. For a detailed reference with full schemas, see [`docs/API.md`](docs/API.md).

> **Port note:** the examples below use `localhost:5555`, which is the Docker-mode port (the Next.js web server proxies `/api/*` to the internal API). In local-development mode (`pnpm dev`), the API binds directly to `localhost:3001` — substitute `5555` → `3001` in every example if you are not using Docker.

### Health Check

```
GET /api/health
```

Returns server status, LLM provider availability, and module readiness.

```bash
curl http://localhost:5555/api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "providers": {
    "anthropic": { "available": true, "model": "claude-sonnet-4-5-20250514" },
    "openai": { "available": false },
    "github": { "available": false },
    "custom": { "available": false }
  },
  "modules": {
    "sentinel": { "ready": true },
    "watchdog": { "ready": true },
    "guardian": { "ready": true }
  }
}
```

### Start Evaluation

```
POST /api/evaluate
```

Starts a new evaluation. The pipeline runs asynchronously — the response returns immediately with an evaluation ID.

```bash
curl -X POST http://localhost:5555/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "inputType": "github_url",
    "source": "https://github.com/owner/repo",
    "description": "Optional description of the application"
  }'
```

| Field | Type | Required | Description |
|---|---|---|---|
| `inputType` | `"github_url" \| "conversation_json" \| "api_endpoint"` | Yes | Type of input to evaluate |
| `source` | `string` | Yes | URL, file path, or endpoint |
| `description` | `string` | No | Human-readable description |

Response (`201 Created`):
```json
{
  "evaluationId": "V1StGXR8_Z5jdHi6B-myT",
  "status": "pending"
}
```

### List Evaluations

```
GET /api/evaluations
```

```bash
curl http://localhost:5555/api/evaluations
```

Returns an array of all evaluations with their current status.

### Get Evaluation

```
GET /api/evaluations/:id
```

```bash
curl http://localhost:5555/api/evaluations/V1StGXR8_Z5jdHi6B-myT
```

Returns the full evaluation object including status, assessments, and verdict (once completed).

### SSE Event Stream

```
GET /api/evaluations/:id/events
```

Real-time Server-Sent Events stream for an evaluation. Replays past events on connect, then streams live updates until the evaluation completes or fails.

```bash
curl -N http://localhost:5555/api/evaluations/V1StGXR8_Z5jdHi6B-myT/events
```

### JSON Report

```
GET /api/evaluations/:id/report
```

Returns a structured JSON report. Only available after the evaluation has completed.

```bash
curl http://localhost:5555/api/evaluations/V1StGXR8_Z5jdHi6B-myT/report
```

### HTML Report

```
GET /api/evaluations/:id/report/html
```

Returns a self-contained HTML safety report (styled, printable) for the completed evaluation.

```bash
# Open in browser:
open "http://localhost:5555/api/evaluations/V1StGXR8_Z5jdHi6B-myT/report/html"
```

---

## SSE Event System

AEGIS streams real-time progress via Server-Sent Events. Connect to `/api/evaluations/:id/events` to receive updates as the pipeline progresses.

| Event Type | Description | Example Data |
|---|---|---|
| `status` | Pipeline stage changed | `{ "status": "cloning", "message": "Cloning repository..." }` |
| `progress` | Expert module completed | `{ "module": "sentinel", "status": "completed", "score": 72, "findingsCount": 5 }` |
| `verdict` | Final verdict computed | `{ "verdict": "REVIEW", "confidence": 0.65, "reasoning": "..." }` |
| `error` | Pipeline failure | `{ "error": "Failed to clone repository" }` |
| `complete` | Evaluation finished | `{ "message": "Evaluation finished." }` |

### Status Progression

```
pending → cloning → analyzing → sentinel_running → synthesizing → completed
                                 watchdog_running
                                 guardian_running
```

All three expert modules run in parallel after the intake stage.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | One provider required | — | Anthropic Claude API key |
| `COPILOT_GITHUB_TOKEN` | | — | GitHub Copilot OAuth token (`ghu_*`). Run `copilot-api auth` to obtain one. Enables premium models via Copilot Enterprise. |
| `OPENAI_API_KEY` | | — | OpenAI API key |
| `GITHUB_TOKEN` | Recommended | — | GitHub PAT for cloning private repos and using GitHub Models |
| `CUSTOM_LLM_BASE_URL` | | — | OpenAI-compatible endpoint (Ollama, vLLM, etc.) |
| `CUSTOM_LLM_API_KEY` | | — | API key for the custom endpoint |
| `PORT` | | `3001` | API server port |
| `CORS_ORIGIN` | | `http://localhost:3000` | Allowed CORS origin for the web UI |
| `DATA_DIR` | | `./data` | Directory for SQLite database and cloned repos |
| `SENTINEL_MODEL` | | (auto) | Model for Sentinel (`provider/model`, e.g. `anthropic/claude-sonnet-4-5-20250514`) |
| `WATCHDOG_MODEL` | | (auto) | Model for Watchdog |
| `GUARDIAN_MODEL` | | (auto) | Model for Guardian |
| `SYNTHESIZER_MODEL` | | (auto) | Model for the Council Synthesizer |
| `AEGIS_DEFAULT_MODEL` | | (auto) | Fallback model for all modules |

**Note:** At least one LLM provider key must be configured. If none is set, the server will fail to start with an explicit error message.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm workspaces |
| **Backend** | [Hono](https://hono.dev/) + Node.js (via `@hono/node-server`) |
| **Frontend** | Next.js 16 + React 19 |
| **Database** | SQLite via [Drizzle ORM](https://orm.drizzle.team/) |
| **Shared types** | `@aegis/shared` workspace package (TypeScript) |
| **LLM providers** | Anthropic SDK, GitHub Copilot Enterprise, OpenAI-compatible (OpenAI, GitHub Models, Ollama, vLLM) |
| **Deployment** | Docker Compose (API + Web, health-checked) |
| **Language** | TypeScript throughout |

---

## Project Structure

```
aegis/
├── apps/
│   ├── api/                        # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts            # Server entrypoint, route mounting, CORS
│   │   │   ├── config.ts           # Environment parsing and validation
│   │   │   ├── routes/
│   │   │   │   ├── evaluate.ts     # POST /api/evaluate, GET /api/evaluations, SSE, reports
│   │   │   │   └── health.ts       # GET /api/health
│   │   │   ├── intake/
│   │   │   │   ├── handler.ts      # Input type routing (GitHub, conversation, API)
│   │   │   │   ├── clone.ts        # Git clone operations
│   │   │   │   └── analyze.ts      # Application profiling (framework, deps, AI detection)
│   │   │   ├── experts/
│   │   │   │   ├── base.ts         # ExpertModule interface
│   │   │   │   ├── sentinel/       # Code & security expert
│   │   │   │   │   ├── analyzer.ts # File reading, LLM call, response parsing
│   │   │   │   │   └── prompts.ts  # Sentinel system/user prompt templates
│   │   │   │   ├── watchdog/       # LLM safety & adversarial expert
│   │   │   │   │   ├── analyzer.ts # AI-aware file selection, analysis
│   │   │   │   │   └── prompts.ts  # Watchdog system/user prompt templates
│   │   │   │   └── guardian/       # Governance & compliance expert
│   │   │   │       ├── analyzer.ts # Governance file selection, analysis
│   │   │   │       └── prompts.ts  # Guardian system/user prompt templates
│   │   │   ├── council/
│   │   │   │   ├── algorithmic.ts  # Deterministic verdict computation
│   │   │   │   ├── critique.ts     # LLM critique round (optional)
│   │   │   │   ├── synthesizer.ts  # Full synthesis pipeline
│   │   │   │   └── prompts.ts      # Council Arbiter system/user prompts
│   │   │   ├── llm/
│   │   │   │   ├── provider.ts     # LLMProvider interface, LLMError, parseModelSpec
│   │   │   │   ├── registry.ts     # Auto-discovery, per-module resolution
│   │   │   │   ├── anthropic.ts    # Anthropic Claude provider
│   │   │   │   ├── copilot.ts      # GitHub Copilot Enterprise provider (token exchange + auto-refresh)
│   │   │   │   ├── openai-compat.ts# OpenAI, GitHub Models, custom endpoint providers
│   │   │   │   └── index.ts        # Barrel re-exports
│   │   │   ├── db/
│   │   │   │   ├── schema.ts       # Drizzle table definitions
│   │   │   │   ├── queries.ts      # CRUD operations
│   │   │   │   └── connection.ts   # SQLite connection setup
│   │   │   └── reports/
│   │   │       ├── generator.ts    # Structured report builder
│   │   │       └── html.ts         # Self-contained HTML report renderer
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                        # Next.js 16 frontend
│       ├── src/app/                # App router pages
│       ├── Dockerfile
│       └── package.json
├── packages/
│   └── shared/                     # @aegis/shared workspace package
│       └── src/
│           ├── types.ts            # All TypeScript types (Evaluation, Finding, Verdict, etc.)
│           ├── constants.ts        # Expert metadata, severity/verdict styles, status labels
│           └── index.ts            # Re-exports
├── data/                           # Runtime data (gitignored)
│   ├── aegis.db                    # SQLite database
│   └── repos/                      # Cloned repositories (per evaluation)
├── docker-compose.yml              # API + Web services with health checks
├── .env.example                    # Environment template
├── pnpm-workspace.yaml             # Workspace configuration
├── tsconfig.base.json              # Shared TypeScript config
└── package.json                    # Root workspace scripts
```

---

## LLM Provider Configuration

AEGIS supports multiple LLM providers simultaneously through its **LLM Registry**. The registry auto-discovers providers at startup by checking environment variables.

### Supported Providers

| Provider | Env Variable(s) | Default Model |
|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250514` |
| **Copilot** | `COPILOT_GITHUB_TOKEN` (or `copilot-api auth`) | `gpt-5.4` |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` |
| **GitHub Models** | `GITHUB_TOKEN` | `gpt-4o` |
| **Custom** (OpenAI-compatible) | `CUSTOM_LLM_BASE_URL` + `CUSTOM_LLM_API_KEY` | `default` |

> **`better-sqlite3` native binary:** Prebuilt binaries are published for **Node 18, 20, and 22** on Linux (x64, arm64), macOS (x64, arm64), and Windows (x64). The `pnpm.onlyBuiltDependencies` config in root `package.json` ensures `prebuild-install` runs automatically during `pnpm install` — no C++ toolchain is required on these platforms. If you're using a non-standard Node version or architecture, `prebuild-install` falls back to a source build, which requires build tools (`build-essential` on Debian/Ubuntu, Xcode CLT on macOS). For the smoothest experience on unsupported configurations, use Docker: `pnpm docker:up` — it ships with the toolchain baked in.

### Copilot Provider (GitHub Copilot Enterprise)

If your GitHub account has **Copilot Enterprise**, the `CopilotProvider` gives AEGIS access to premium models — including GPT-5.4 and Claude Opus 4.6 — at no additional per-token cost.

**Setup (one-time):**

```bash
# Browser-based login — writes a token to your config
copilot-api auth

# Or set the token directly:
export COPILOT_GITHUB_TOKEN=ghu_xxxxxxxxxxxx
```

**How it works:** The provider exchanges your GitHub OAuth token (`ghu_*`) for a short-lived Copilot token via `api.github.com/copilot_internal/v2/token`, then calls `api.githubcopilot.com/chat/completions`. Tokens are auto-refreshed before expiry.

**Available models:**

| Provider | Model ID | Notes |
|----------|----------|-------|
| copilot | gpt-5.4 | Top-tier GPT |
| copilot | gpt-5.2 | |
| copilot | gpt-5.1 | |
| copilot | gpt-5-mini | Fast |
| copilot | claude-opus-4.6-1m | 1M context |
| copilot | claude-opus-4.6 | Premium |
| copilot | claude-opus-4.5 | |
| copilot | claude-sonnet-4.6 | Latest Sonnet |
| copilot | claude-sonnet-4.5 | Good balance |
| copilot | claude-haiku-4.5 | Fastest Claude |
| copilot | gemini-2.5-pro | |

### Per-Module Model Configuration

Each expert module can use a different provider and model:

```bash
# In .env:
SENTINEL_MODEL=anthropic/claude-sonnet-4-5-20250514
WATCHDOG_MODEL=copilot/gpt-5.4
GUARDIAN_MODEL=copilot/claude-sonnet-4.5
SYNTHESIZER_MODEL=anthropic/claude-sonnet-4-5-20250514
```

### Resolution Order

For each module, the registry resolves the provider in this order:

1. **Per-module override** — e.g. `SENTINEL_MODEL=anthropic/claude-sonnet-4-5-20250514`
2. **Global default** — `AEGIS_DEFAULT_MODEL=anthropic/claude-sonnet-4-5-20250514`
3. **First available provider** — in preference order: Anthropic → Copilot → OpenAI → GitHub → Custom

### Using Ollama (Local Models)

```bash
# Start Ollama with a model:
ollama serve
ollama pull llama3.1

# In .env:
CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
CUSTOM_LLM_API_KEY=unused
AEGIS_DEFAULT_MODEL=custom/llama3.1
```

---

## UNICC Alignment

AEGIS is designed to evaluate AI systems against the UNICC's responsible AI principles. The expert modules map directly to UNICC concerns:

| UNICC Principle | AEGIS Coverage |
|---|---|
| **Trust** | Sentinel verifies code security; Council provides transparent, auditable verdicts with full reasoning chains |
| **Fairness** | Guardian evaluates bias considerations, model cards, and fairness documentation |
| **Privacy** | Guardian checks for data protection policies, PII handling, and GDPR compliance; Sentinel detects credential exposure |
| **Risk Management** | The full Council pipeline implements structured risk assessment aligned with NIST AI RMF |
| **Human Rights** | Guardian evaluates human oversight mechanisms and escalation procedures |

### Five UNICC Risk Domains

The shared type system defines five risk domains that map to UNICC's AI governance framework:

| Domain | Description |
|---|---|
| Data Sovereignty | Control over data storage, processing, and cross-border transfer |
| Agent Autonomy | Appropriate boundaries on AI decision-making authority |
| Content Safety | Prevention of harmful, biased, or misleading outputs |
| Operational Integrity | Reliability, availability, and resilience of AI systems |
| Supply Chain Trust | Provenance and security of models, data, and dependencies |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes, ensuring `pnpm lint` and `pnpm build` pass
4. Commit with a descriptive message
5. Open a pull request

### Development Notes

- The project uses **pnpm workspaces** — always run `pnpm install` from the root
- Shared types live in `packages/shared/` — import from `@aegis/shared`
- The API uses **Hono** (not Express) — see [Hono docs](https://hono.dev/)
- Database migrations are handled automatically by Drizzle on startup

---

## License

MIT
