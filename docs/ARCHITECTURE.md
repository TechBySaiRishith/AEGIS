# AEGIS Architecture

Deep-dive into the internal architecture of the AEGIS Council of Experts AI Safety Lab.

---

## Table of Contents

- [System Overview](#system-overview)
- [Module Communication Patterns](#module-communication-patterns)
- [LLM Abstraction Layer](#llm-abstraction-layer)
- [Database Schema](#database-schema)
- [Evaluation Pipeline](#evaluation-pipeline)
- [Intake System](#intake-system)
- [Expert Module Architecture](#expert-module-architecture)
- [Council Synthesis Pipeline](#council-synthesis-pipeline)
- [SSE Event System](#sse-event-system)
- [Report Generation](#report-generation)
- [Error Handling & Graceful Degradation](#error-handling--graceful-degradation)

---

## System Overview

AEGIS is a TypeScript monorepo with three workspace packages:

| Package | Path | Purpose |
|---|---|---|
| `@aegis/api` | `apps/api/` | Hono-based API server — evaluation pipeline, experts, council |
| `@aegis/web` | `apps/web/` | Next.js 16 frontend — dashboard, evaluation forms, report viewer |
| `@aegis/shared` | `packages/shared/` | Shared TypeScript types, constants, and expert metadata |

The API server is the core — it orchestrates the full evaluation pipeline from intake through verdict.

```
@aegis/shared  ◄──── imported by ────┐
     │                                │
     ▼                                │
@aegis/api ──── HTTP/SSE ───► @aegis/web
```

---

## Module Communication Patterns

### Request Flow

```
Browser / curl
      │
      ▼
┌──────────────────────────────────────┐
│  Hono Router (apps/api/src/index.ts) │
│                                      │
│  app.route("/api/health", health)    │
│  app.route("/api/evaluate", evaluate)│
│  app.route("/api/evaluations", eval) │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Route Handler (routes/evaluate.ts)  │
│                                      │
│  POST /  → createEvaluation + fire   │
│  GET /   → listEvaluations           │
│  GET /:id → getEvaluation            │
│  GET /:id/events → SSE stream        │
│  GET /:id/report → JSON report       │
│  GET /:id/report/html → HTML report  │
└──────────┬───────────────────────────┘
           │
    runEvaluation() — fire-and-forget
           │
           ▼
   [Pipeline stages...]
```

### Inter-Module Communication

Modules communicate through **shared types** (`@aegis/shared`) and **function calls** — there is no message bus, event system, or RPC layer between modules. The pipeline is orchestrated procedurally in `runEvaluation()`:

```
handleIntake() → ApplicationProfile
       │
       ├──► SentinelAnalyzer.analyze() ──┐
       ├──► WatchdogAnalyzer.analyze() ──┼──► ExpertAssessment[]
       └──► GuardianAnalyzer.analyze() ──┘
                                          │
                              computeAlgorithmicVerdict()
                                          │
                                  synthesize() → CouncilVerdict
                                          │
                               generateReport() → EvaluationReport
```

All persistence happens through `db/queries.ts` — the pipeline writes to the database at each stage transition.

---

## LLM Abstraction Layer

### Provider Interface

Every LLM provider implements the `LLMProvider` interface defined in `apps/api/src/llm/provider.ts`:

```typescript
interface LLMProvider {
  readonly id: LLMProviderType;       // "anthropic" | "copilot" | "openai" | "github" | "custom"
  readonly displayName: string;        // Human-readable name
  readonly model: string;              // Model identifier (e.g. "claude-sonnet-4-5-20250514")
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;
  isAvailable(): boolean;
}

interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}
```

### Provider Implementations

| File | Provider | SDK |
|---|---|---|
| `anthropic.ts` | Anthropic Claude | `@anthropic-ai/sdk` |
| `copilot.ts` | GitHub Copilot Enterprise | `openai` (OpenAI SDK) — token exchange via `api.github.com/copilot_internal/v2/token`, completions via `api.githubcopilot.com/chat/completions`. Auto-refreshes short-lived tokens. |
| `openai-compat.ts` | OpenAI, GitHub Models, Custom | `openai` (OpenAI SDK) |

The `openai-compat.ts` file exports three factory functions:
- `createOpenAIProvider(model)` — standard OpenAI endpoint
- `createGitHubModelsProvider(model)` — GitHub Models endpoint (`https://models.inference.ai.azure.com`)
- `createCustomProvider(model)` — any OpenAI-compatible endpoint (Ollama, vLLM, etc.)

### LLM Registry

The `LLMRegistry` class (`apps/api/src/llm/registry.ts`) is a singleton that:

1. **Auto-discovers** providers by scanning environment variables at startup
2. **Resolves** the correct provider for each expert module using a three-level fallback:
   - Per-module env var (`SENTINEL_MODEL`, `WATCHDOG_MODEL`, etc.)
   - Global default (`AEGIS_DEFAULT_MODEL`)
   - First available provider (Anthropic → Copilot → OpenAI → GitHub → Custom)
3. **Creates ad-hoc instances** when a per-module override specifies a different model than the registered default

```
SENTINEL_MODEL=anthropic/claude-sonnet-4-5-20250514
                  │              │
                  ▼              ▼
             provider        model name
```

### Error Handling

The `LLMError` class provides structured error information:

```typescript
class LLMError extends Error {
  provider: LLMProviderType;
  code: "auth" | "timeout" | "rate_limit" | "unknown";
  cause?: unknown;
}
```

Constants: `DEFAULT_TIMEOUT_MS = 30_000`, `MAX_RETRIES = 3`, `RETRY_BASE_DELAY_MS = 1_000`.

---

## Database Schema

AEGIS uses **SQLite** with **Drizzle ORM**. The database file lives at `data/aegis.db`.

### Tables

#### `evaluations`

| Column | Type | Description |
|---|---|---|
| `id` | `TEXT PK` | Unique evaluation identifier (nanoid) |
| `status` | `TEXT` | Current pipeline status (see status enum below) |
| `input_type` | `TEXT` | `"github_url"`, `"conversation_json"`, or `"api_endpoint"` |
| `source_url` | `TEXT` | The submitted URL or path |
| `application_name` | `TEXT` | Detected or provided application name |
| `application_description` | `TEXT` | Optional description |
| `application_profile` | `TEXT` | JSON-serialised `ApplicationProfile` |
| `created_at` | `TEXT` | ISO 8601 timestamp |
| `updated_at` | `TEXT` | ISO 8601 timestamp |
| `completed_at` | `TEXT` | ISO 8601 timestamp (null until complete) |
| `error` | `TEXT` | Error message if failed |

**Status values:**
```
pending → cloning → analyzing → sentinel_running → synthesizing → completed
                                 watchdog_running                   failed
                                 guardian_running
```

#### `assessments`

| Column | Type | Description |
|---|---|---|
| `id` | `TEXT PK` | Unique assessment identifier |
| `evaluation_id` | `TEXT FK` | References `evaluations.id` (cascade delete) |
| `module_id` | `TEXT` | `"sentinel"`, `"watchdog"`, or `"guardian"` |
| `status` | `TEXT` | `"completed"`, `"failed"`, or `"partial"` |
| `score` | `REAL` | 0–100 safety score |
| `risk_level` | `TEXT` | `"critical"`, `"high"`, `"medium"`, `"low"`, `"info"` |
| `findings` | `TEXT` | JSON-serialised `Finding[]` |
| `summary` | `TEXT` | Human-readable analysis summary |
| `recommendation` | `TEXT` | Recommended actions |
| `model` | `TEXT` | LLM model used for analysis |
| `completed_at` | `TEXT` | ISO 8601 timestamp |
| `error` | `TEXT` | Error message if failed |

#### `verdicts`

| Column | Type | Description |
|---|---|---|
| `id` | `TEXT PK` | Unique verdict identifier |
| `evaluation_id` | `TEXT FK` | References `evaluations.id` (cascade delete) |
| `verdict` | `TEXT` | `"APPROVE"`, `"REVIEW"`, or `"REJECT"` |
| `confidence` | `REAL` | 0.0–1.0 confidence score |
| `reasoning` | `TEXT` | Full reasoning text (algorithmic + optional LLM narrative) |
| `critiques` | `TEXT` | JSON-serialised `CritiquePoint[]` |
| `per_module_summary` | `TEXT` | JSON-serialised per-module summary map |
| `algorithmic_verdict` | `TEXT` | The deterministic verdict (always computed) |
| `llm_enhanced` | `INTEGER` | Boolean — whether LLM critique round ran successfully |
| `created_at` | `TEXT` | ISO 8601 timestamp |

### Entity Relationships

```
evaluations (1) ──── (N) assessments
evaluations (1) ──── (1) verdicts
```

---

## Evaluation Pipeline

The full pipeline is orchestrated in `runEvaluation()` in `apps/api/src/routes/evaluate.ts`:

### Stage 1: Intake

```
Status: pending → cloning → analyzing
```

The intake handler (`apps/api/src/intake/handler.ts`) routes based on input type:

| Input Type | Handler | Process |
|---|---|---|
| `github_url` | `handleGitHub()` | Clone repo → `analyzeApplication()` → `ApplicationProfile` |
| `conversation_json` | `handleConversationJSON()` | Parse JSON → extract system prompts → build profile |
| `api_endpoint` | `handleAPIEndpoint()` | Create metadata-only profile from URL |

**Application profiling** (`intake/analyze.ts`) performs:
- Framework detection (Next.js, Flask, Django, FastAPI, Express, Rails, Streamlit, etc.)
- Language detection
- Dependency parsing
- Entry point discovery
- AI integration detection (OpenAI, Anthropic, LangChain, etc.)
- File structure tree building

### Stage 2: Expert Analysis (Parallel)

```
Status: sentinel_running / watchdog_running / guardian_running
```

All three experts run via `Promise.allSettled()`:

```typescript
const results = await Promise.allSettled(
  experts.map(async (expert) => {
    const assessment = await expert.runner();
    saveAssessment({ evaluationId, ... });
    pushEvent(evaluationId, "progress", { ... });
    return assessment;
  }),
);
```

If a promise rejects, a failed assessment shell is created with `score: 0` and `status: "failed"`. The pipeline continues regardless.

### Stage 3: Synthesis

```
Status: synthesizing
```

The synthesizer computes the algorithmic verdict, optionally runs the LLM critique round, and saves the `CouncilVerdict`.

### Stage 4: Completion

```
Status: completed | failed
```

The evaluation is marked complete, and final SSE events are emitted.

---

## Intake System

### Git Clone

`intake/clone.ts` clones repositories using `git clone --depth 1` (shallow clone) into `data/repos/<evaluationId>/`. It uses `GITHUB_TOKEN` for authentication when available.

### Application Analysis

`intake/analyze.ts` walks the cloned repository and produces an `ApplicationProfile`:

```typescript
interface ApplicationProfile {
  id: string;
  inputType: InputType;
  sourceUrl?: string;
  name: string;
  description: string;
  framework: string;         // "Next.js", "FastAPI", "Django", etc.
  language: string;           // "typescript", "python", etc.
  entryPoints: string[];      // Main files (index.ts, app.py, etc.)
  dependencies: string[];     // Package names from manifests
  aiIntegrations: AIIntegration[];  // Detected AI SDK usage
  fileStructure: FileNode[];  // Full file tree
  totalFiles: number;
  totalLines: number;
}
```

**AI Integration Detection** scans for:
- Package dependencies: `openai`, `@anthropic-ai/sdk`, `langchain`, `@ai-sdk/*`, etc.
- Import patterns in source code
- API key references in environment files
- System prompt definitions

---

## Expert Module Architecture

### Base Interface

Every expert implements `ExpertModule` from `apps/api/src/experts/base.ts`:

```typescript
interface ExpertModule {
  readonly id: string;
  readonly name: string;
  analyze(app: ApplicationProfile, llm: LLMProvider): Promise<ExpertAssessment>;
}
```

### Common Pattern

All three experts follow the same four-step pattern:

1. **File Selection** — Read key source files from the cloned repo using a module-specific strategy
2. **Prompt Construction** — Build a structured prompt with the application profile and code snippets
3. **LLM Call** — Send to the LLM with a module-specific system prompt
4. **Response Parsing** — Parse the JSON response, validate fields, derive score/risk if not provided

### File Selection Strategies

| Module | Strategy | Budget |
|---|---|---|
| **Sentinel** | Priority: entry points → AI files → config files → source files (by line count) | 50 KB total, 20 KB per file |
| **Watchdog** | AI-relevance scoring: path patterns (0–10) + content patterns (0–20) + `aiIntegrations` boost (+15) | 100K chars total, 15K per file |
| **Guardian** | Governance-relevance scoring: docs (100) → manifests (80) → config (60) → AI code (40) → data code (30) | 120K chars total, 50K per file, max 40 files |

### Score Computation (Fallback)

When the LLM doesn't return a numeric score, each expert derives one from findings:

**Sentinel scoring:**
```
Start at 100
  critical: −15
  high:     −8
  medium:   −4
  low:      −1
  info:      0
```

**Watchdog scoring:**
```
Start at 100
  critical: −25
  high:     −15
  medium:   −8
  low:      −3
  info:     −1
```

### LLM Response Format

All experts expect JSON from the LLM:

```json
{
  "findings": [
    {
      "title": "...",
      "severity": "critical|high|medium|low|info",
      "category": "...",
      "description": "...",
      "filePath": "...",
      "lineNumber": 42,
      "snippet": "...",
      "remediation": "...",
      "framework": "CWE-79"
    }
  ],
  "summary": "...",
  "recommendation": "...",
  "score": 72,
  "riskLevel": "medium"
}
```

The parser strips markdown code fences if the LLM wraps its response.

---

## Council Synthesis Pipeline

Located in `apps/api/src/council/`, the synthesis pipeline has three files:

### `algorithmic.ts` — Deterministic Verdict

```
Thresholds:
  REJECT_SCORE_THRESHOLD = 30
  REVIEW_SCORE_THRESHOLD = 60
  HIGH_FINDING_MODULE_THRESHOLD = 2
```

**Decision tree:**

```
For each assessment:
  ├── score < 30 OR has critical finding? → REJECT
  └── (not REJECT) score < 60 OR high findings in ≥2 modules? → REVIEW
  └── else → APPROVE

Confidence = mean(all scores) / 100
```

The algorithmic verdict is **always** computed and is **never** overridden by the LLM.

### `critique.ts` — LLM Critique Round

When an LLM provider is available, the critique round:

1. Sends all assessments to the "Council Arbiter" LLM
2. Expects a JSON response with:
   - `critiques[]` — typed as `agreement`, `conflict`, or `addition`
   - `narrative` — 2–3 paragraph synthesis

The response is validated: module IDs must be `sentinel`, `watchdog`, or `guardian`; critique types must be `agreement`, `conflict`, or `addition`.

### `synthesizer.ts` — Full Pipeline

```typescript
async function synthesize(
  assessments: ExpertAssessment[],
  llm?: LLMProvider,
): Promise<CouncilVerdict>
```

1. **Algorithmic verdict** — always runs
2. **Per-module summary** — extracts summary from each assessment
3. **Disagreement detection** — flags score differences ≥ 30 between any two modules
4. **LLM enhancement** (if available):
   - Run critique round
   - Merge LLM critiques with score-based disagreements (deduplicated)
   - Append LLM narrative to algorithmic reasoning
   - If critique succeeds but has no narrative, generate one via a separate synthesis prompt
5. **Fallback** — if LLM fails at any point, use algorithmic-only result

---

## SSE Event System

### Architecture

SSE events are managed with an in-memory pub/sub system in `routes/evaluate.ts`:

```typescript
// Per-evaluation event log (replay buffer)
const eventLogs = new Map<string, EvalEvent[]>();

// Live listener sets (for connected SSE clients)
const eventListeners = new Map<string, Set<(event: EvalEvent) => void>>();
```

### Event Interface

```typescript
interface EvalEvent {
  type: string;          // "status" | "progress" | "verdict" | "error" | "complete"
  evaluationId: string;
  timestamp: string;     // ISO 8601
  data: Record<string, unknown>;
}
```

### Client Connection

When a client connects to `GET /api/evaluations/:id/events`:

1. **Replay** — all past events for this evaluation are sent immediately
2. **Check terminal** — if the evaluation is already `completed` or `failed`, close the stream
3. **Subscribe** — register a live listener callback
4. **Keep-alive** — poll every 1 second until `complete` or `error` event fires
5. **Cleanup** — remove listener on disconnect

### Wire Format

Events are sent as standard SSE:

```
event: status
data: {"type":"status","evaluationId":"abc","timestamp":"2025-...","data":{"status":"cloning","message":"Cloning repository..."}}

event: progress
data: {"type":"progress","evaluationId":"abc","timestamp":"2025-...","data":{"module":"sentinel","status":"completed","score":72,"findingsCount":5}}
```

---

## Report Generation

### JSON Report (`reports/generator.ts`)

The report generator produces an `EvaluationReport` from the database state — **no LLM calls** during report generation:

```typescript
interface EvaluationReport {
  id: string;                    // rpt_<nanoid>
  evaluationId: string;
  executiveSummary: string;      // Multi-paragraph narrative
  verdict: Verdict;
  confidence: number;
  applicationName: string;
  applicationDescription: string;
  moduleSummaries: Record<ExpertModuleId, ModuleReportSection>;
  councilAnalysis: string;       // Formatted council synthesis
  generatedAt: string;
}
```

The executive summary includes:
- Application overview and framework detection
- Verdict-specific paragraph (different text for APPROVE/REVIEW/REJECT)
- Per-module score breakdown with finding counts by severity
- Disagreement analysis (if modules conflict)

### HTML Report (`reports/html.ts`)

The HTML renderer produces a self-contained, printable HTML page with:
- Styled verdict badge (colour-coded: green/amber/red)
- Executive summary
- Per-module sections with findings tables (sortable by severity)
- Severity badges with colour coding
- Council analysis narrative

---

## Error Handling & Graceful Degradation

AEGIS is designed to produce useful results even when components fail:

### Pipeline-Level

| Failure | Behavior |
|---|---|
| **Repository clone fails** | Pipeline aborts with `status: "failed"` and error message |
| **One expert fails** | Other experts continue; failed expert creates `status: "failed"` assessment with `score: 0` |
| **All experts fail** | Algorithmic verdict returns `REJECT` with `confidence: 0` |
| **LLM critique round fails** | Falls back to algorithmic-only verdict (no LLM enhancement) |
| **Synthesis prompt fails** | Falls back to critique-only or algorithmic-only reasoning |
| **Report generation fails** | Returns `500` with error message; evaluation data remains accessible |

### Expert-Level

Each expert catches all errors and returns a structured `ExpertAssessment` with `status: "failed"`:

```typescript
try {
  // ... analysis logic
} catch (error) {
  return {
    moduleId: "sentinel",
    status: "failed",
    score: 0,
    riskLevel: "info",  // Not "critical" — we don't penalise for analysis failure
    findings: [],
    error: error.message,
    ...
  };
}
```

### LLM-Level

The `LLMError` class distinguishes between:
- `auth` — invalid credentials
- `timeout` — request exceeded `DEFAULT_TIMEOUT_MS` (30 seconds)
- `rate_limit` — provider rate limit hit
- `unknown` — any other error

### Confidence Adjustment

When modules fail, the algorithmic verdict reduces confidence:

```typescript
if (failedModules > 0) {
  confidence = Math.max(0.2, confidence - 0.15 * failedModules);
}
```

This ensures that verdicts with missing data are flagged as lower-confidence.
