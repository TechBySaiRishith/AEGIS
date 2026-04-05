# AEGIS API Reference

Complete API reference for the AEGIS AI Safety Lab backend.

**Base URL:** `http://localhost:3001`

All endpoints are prefixed with `/api/`. The API uses JSON for request and response bodies except where noted (SSE, HTML).

---

## Table of Contents

- [Authentication](#authentication)
- [Health Check](#health-check)
- [Evaluations](#evaluations)
  - [Start Evaluation](#start-evaluation)
  - [List Evaluations](#list-evaluations)
  - [Get Evaluation](#get-evaluation)
  - [SSE Event Stream](#sse-event-stream)
  - [Get JSON Report](#get-json-report)
  - [Get HTML Report](#get-html-report)
- [Type Reference](#type-reference)
- [Error Handling](#error-handling)
- [SSE Event Format](#sse-event-format)

---

## Authentication

AEGIS does not currently require authentication for API access. All endpoints are open.

The `GITHUB_TOKEN` environment variable is used server-side for cloning private repositories — it is not exposed to API clients.

---

## Health Check

### `GET /api/health`

Returns server status, LLM provider availability, and expert module readiness.

**Request:**

```bash
curl http://localhost:3001/api/health
```

**Response (`200 OK`):**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "providers": {
    "anthropic": { "available": true, "model": "claude-sonnet-4-5-20250514" },
    "copilot": { "available": false },
    "openai": { "available": false },
    "github": { "available": false },
    "custom": { "available": false },
    "mock": { "available": false }
  },
  "modules": {
    "sentinel": { "ready": true },
    "watchdog": { "ready": true },
    "guardian": { "ready": true }
  }
}
```

**Response Schema: `HealthResponse`**

| Field | Type | Description |
|---|---|---|
| `status` | `"ok"` | Always `"ok"` if the server is running |
| `version` | `string` | API version |
| `providers` | `Record<LLMProvider, { available: boolean; model?: string }>` | Availability of each LLM provider |
| `modules` | `Record<ExpertModuleId, { ready: boolean }>` | Readiness of each expert module (requires at least one provider) |

---

## Evaluations

### Start Evaluation

### `POST /api/evaluate`

Starts a new evaluation. The pipeline runs asynchronously in the background — the response returns immediately.

**Request:**

```bash
curl -X POST http://localhost:3001/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "inputType": "github_url",
    "source": "https://github.com/vercel/ai-chatbot",
    "description": "Vercel AI Chatbot — a Next.js chatbot using the AI SDK"
  }'
```

**Request Body: `EvaluateRequest`**

| Field | Type | Required | Description |
|---|---|---|---|
| `inputType` | `InputType` | Yes | Type of input: `"github_url"`, `"conversation_json"`, or `"api_endpoint"` |
| `source` | `string` | Yes | URL to evaluate (GitHub URL, file path, or API endpoint) |
| `description` | `string` | No | Human-readable description of the application |

**Response (`201 Created`): `EvaluateResponse`**

```json
{
  "evaluationId": "V1StGXR8_Z5jdHi6B-myT",
  "status": "pending"
}
```

| Field | Type | Description |
|---|---|---|
| `evaluationId` | `string` | Unique identifier for tracking the evaluation |
| `status` | `EvaluationStatus` | Initial status (always `"pending"`) |

**Error Responses:**

| Status | Condition |
|---|---|
| `400` | Missing `inputType` or `source` |

---

### List Evaluations

### `GET /api/evaluations`

Returns all evaluations ordered by creation time.

**Request:**

```bash
curl http://localhost:3001/api/evaluations
```

**Response (`200 OK`):**

```json
[
  {
    "id": "V1StGXR8_Z5jdHi6B-myT",
    "status": "completed",
    "inputType": "github_url",
    "sourceUrl": "https://github.com/vercel/ai-chatbot",
    "applicationName": "ai-chatbot",
    "applicationDescription": "Vercel AI Chatbot",
    "createdAt": "2025-06-01T12:00:00.000Z",
    "updatedAt": "2025-06-01T12:05:00.000Z",
    "completedAt": "2025-06-01T12:05:00.000Z",
    "assessments": [...],
    "verdict": {...}
  }
]
```

---

### Get Evaluation

### `GET /api/evaluations/:id`

Returns a single evaluation with its current status, assessments, and verdict.

**Request:**

```bash
curl http://localhost:3001/api/evaluations/V1StGXR8_Z5jdHi6B-myT
```

**Response (`200 OK`):**

The response includes the full evaluation object. When `status` is `"completed"`, the `assessments` array and `verdict` object are populated.

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "status": "completed",
  "inputType": "github_url",
  "sourceUrl": "https://github.com/vercel/ai-chatbot",
  "applicationName": "ai-chatbot",
  "applicationDescription": "Vercel AI Chatbot",
  "applicationProfile": {
    "framework": "Next.js",
    "language": "typescript",
    "totalFiles": 42,
    "totalLines": 3200,
    "aiIntegrations": [...]
  },
  "createdAt": "2025-06-01T12:00:00.000Z",
  "updatedAt": "2025-06-01T12:05:00.000Z",
  "completedAt": "2025-06-01T12:05:00.000Z",
  "assessments": [
    {
      "moduleId": "sentinel",
      "status": "completed",
      "score": 72,
      "riskLevel": "medium",
      "findings": [
        {
          "id": "sentinel-1-a3f8b2c1",
          "title": "Hardcoded API key in configuration",
          "severity": "high",
          "category": "Credentials",
          "description": "API key found in source control",
          "evidence": [
            {
              "filePath": "src/config.ts",
              "lineNumber": 12,
              "snippet": "const API_KEY = \"sk-...\"",
              "description": "Hardcoded secret"
            }
          ],
          "remediation": "Move to environment variable",
          "framework": "CWE-798"
        }
      ],
      "summary": "Security analysis completed with 5 findings.",
      "recommendation": "Address high-severity credential exposure.",
      "model": "claude-sonnet-4-5-20250514",
      "completedAt": "2025-06-01T12:03:00.000Z"
    },
    {
      "moduleId": "watchdog",
      "status": "completed",
      "score": 65,
      "riskLevel": "medium",
      "findings": [...],
      "summary": "...",
      "recommendation": "...",
      "model": "claude-sonnet-4-5-20250514",
      "completedAt": "2025-06-01T12:04:00.000Z"
    },
    {
      "moduleId": "guardian",
      "status": "completed",
      "score": 80,
      "riskLevel": "low",
      "findings": [...],
      "summary": "...",
      "recommendation": "...",
      "model": "claude-sonnet-4-5-20250514",
      "completedAt": "2025-06-01T12:04:30.000Z"
    }
  ],
  "verdict": {
    "verdict": "REVIEW",
    "confidence": 0.72,
    "reasoning": "Verdict: REVIEW\nModule scores — Sentinel (CWE/OWASP Web): 72/100 [Medium]; ...",
    "critiques": [
      {
        "fromModule": "sentinel",
        "aboutModule": "guardian",
        "type": "conflict",
        "description": "Score disagreement: Sentinel scored 72/100 while Guardian scored 80/100..."
      }
    ],
    "perModuleSummary": {
      "sentinel": "Security analysis completed with 5 findings.",
      "watchdog": "LLM safety analysis completed.",
      "guardian": "Governance analysis completed."
    },
    "algorithmicVerdict": "REVIEW",
    "llmEnhanced": false
  }
}
```

**Error Responses:**

| Status | Condition |
|---|---|
| `404` | Evaluation not found |

---

### SSE Event Stream

### `GET /api/evaluations/:id/events`

Server-Sent Events stream for real-time evaluation progress. Replays past events on connect, then streams live updates.

**Request:**

```bash
curl -N http://localhost:3001/api/evaluations/V1StGXR8_Z5jdHi6B-myT/events
```

**Response (`200 OK`, `Content-Type: text/event-stream`):**

```
event: status
data: {"type":"status","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:00:01.000Z","data":{"status":"cloning","message":"Cloning repository and profiling application…"}}

event: status
data: {"type":"status","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:01:00.000Z","data":{"status":"analyzing","message":"Application profiled. Starting expert analysis…"}}

event: progress
data: {"type":"progress","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:03:00.000Z","data":{"module":"sentinel","status":"completed","score":72,"findingsCount":5}}

event: progress
data: {"type":"progress","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:04:00.000Z","data":{"module":"watchdog","status":"completed","score":65,"findingsCount":3}}

event: progress
data: {"type":"progress","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:04:30.000Z","data":{"module":"guardian","status":"completed","score":80,"findingsCount":2}}

event: verdict
data: {"type":"verdict","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:05:00.000Z","data":{"verdict":"REVIEW","confidence":0.72,"reasoning":"..."}}

event: complete
data: {"type":"complete","evaluationId":"V1StGXR8_Z5jdHi6B-myT","timestamp":"2025-06-01T12:05:00.000Z","data":{"message":"Evaluation finished."}}
```

**Behavior:**
- Past events are replayed immediately on connect
- If the evaluation is already terminal (`completed` or `failed`), the stream closes after replay
- The stream stays open until `complete` or `error` event fires
- Keep-alive polling at 1-second intervals

**Error Responses:**

| Status | Condition |
|---|---|
| `404` | Evaluation not found |

---

### Get JSON Report

### `GET /api/evaluations/:id/report`

Returns a structured JSON safety report for a completed evaluation.

**Request:**

```bash
curl http://localhost:3001/api/evaluations/V1StGXR8_Z5jdHi6B-myT/report
```

**Response (`200 OK`): `EvaluationReport`**

```json
{
  "id": "rpt_a1b2c3d4e5f6",
  "evaluationId": "V1StGXR8_Z5jdHi6B-myT",
  "executiveSummary": "AEGIS evaluated ai-chatbot, a Next.js application, through three independent expert modules...",
  "verdict": "REVIEW",
  "confidence": 0.72,
  "applicationName": "ai-chatbot",
  "applicationDescription": "Vercel AI Chatbot",
  "moduleSummaries": {
    "sentinel": {
      "moduleName": "Sentinel",
      "framework": "CWE/OWASP Web",
      "score": 72,
      "riskLevel": "medium",
      "summary": "Security analysis completed with 5 findings.",
      "findings": [...],
      "recommendation": "Address high-severity credential exposure."
    },
    "watchdog": { ... },
    "guardian": { ... }
  },
  "councilAnalysis": "Council Synthesis\n────────────────────────────────────────\n\nVerdict: REVIEW (confidence: 72%)\n\nReasoning:\n...",
  "generatedAt": "2025-06-01T12:05:30.000Z"
}
```

**Error Responses:**

| Status | Condition |
|---|---|
| `400` | Evaluation is not completed |
| `404` | Evaluation not found |
| `500` | Report generation failed |

---

### Get HTML Report

### `GET /api/evaluations/:id/report/html`

Returns a self-contained, styled, printable HTML safety report.

**Request:**

```bash
# Open in browser:
open "http://localhost:3001/api/evaluations/V1StGXR8_Z5jdHi6B-myT/report/html"
```

**Response (`200 OK`, `Content-Type: text/html`):**

A self-contained HTML document with:
- Color-coded verdict badge
- Executive summary
- Per-module sections with findings tables
- Severity badges
- Council analysis

**Error Responses:**

| Status | Condition |
|---|---|
| `400` | Evaluation is not completed |
| `404` | Evaluation not found |
| `500` | Report generation failed |

---

## Type Reference

### Input Types

```typescript
type InputType = "github_url" | "conversation_json" | "api_endpoint";
```

### Evaluation Status

```typescript
type EvaluationStatus =
  | "pending"           // Just created
  | "cloning"           // Cloning repository
  | "analyzing"         // Profiling application
  | "sentinel_running"  // Sentinel expert active
  | "watchdog_running"  // Watchdog expert active
  | "guardian_running"  // Guardian expert active
  | "synthesizing"      // Computing verdict
  | "completed"         // Done — results available
  | "failed";           // Pipeline error
```

### Verdict

```typescript
type Verdict = "APPROVE" | "REVIEW" | "REJECT";
```

### Severity

```typescript
type Severity = "critical" | "high" | "medium" | "low" | "info";
```

### Expert Module IDs

```typescript
type ExpertModuleId = "sentinel" | "watchdog" | "guardian";
```

### LLM Providers

```typescript
type LLMProvider = "anthropic" | "copilot" | "openai" | "github" | "custom" | "mock";
```

### Finding

```typescript
interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  description: string;
  evidence: Evidence[];
  remediation?: string;
  framework?: string;  // CWE-79, OWASP-LLM01, NIST-MAP-1.1, etc.
}

interface Evidence {
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  description: string;
}
```

### Expert Assessment

```typescript
interface ExpertAssessment {
  moduleId: ExpertModuleId;
  moduleName: string;
  framework: string;
  status: "completed" | "failed" | "partial";
  score: number;           // 0-100
  riskLevel: Severity;
  findings: Finding[];
  summary: string;
  recommendation: string;
  completedAt: string;
  model: string;
  error?: string;
}
```

### Council Verdict

```typescript
interface CouncilVerdict {
  verdict: Verdict;
  confidence: number;      // 0-1
  reasoning: string;
  critiques: CritiquePoint[];
  perModuleSummary: Record<ExpertModuleId, string>;
  algorithmicVerdict: Verdict;
  llmEnhanced: boolean;
}

interface CritiquePoint {
  fromModule: ExpertModuleId;
  aboutModule: ExpertModuleId;
  type: "agreement" | "conflict" | "addition";
  description: string;
}
```

### Evaluation Report

```typescript
interface EvaluationReport {
  id: string;
  evaluationId: string;
  executiveSummary: string;
  verdict: Verdict;
  confidence: number;
  applicationName: string;
  applicationDescription: string;
  moduleSummaries: Record<ExpertModuleId, ModuleReportSection>;
  councilAnalysis: string;
  generatedAt: string;
}

interface ModuleReportSection {
  moduleName: string;
  framework: string;
  score: number;
  riskLevel: Severity;
  summary: string;
  findings: Finding[];
  recommendation: string;
}
```

### SSE Event

```typescript
interface SSEEvent {
  type: "status" | "progress" | "finding" | "verdict" | "error" | "complete";
  evaluationId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
```

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created (new evaluation started) |
| `400` | Bad request (missing fields, evaluation not completed for reports) |
| `404` | Resource not found |
| `500` | Internal server error |

### Pipeline Errors

Pipeline errors are captured in the evaluation record and emitted via SSE:

```json
{
  "type": "error",
  "evaluationId": "abc123",
  "timestamp": "2025-06-01T12:05:00.000Z",
  "data": {
    "error": "Failed to clone repository: authentication required"
  }
}
```

The evaluation's `status` field will be set to `"failed"` and the `error` field will contain the error message.

---

## SSE Event Format

### Event Types

| Type | When | Data Fields |
|---|---|---|
| `status` | Pipeline stage changes | `status`, `message` |
| `progress` | Expert module completes | `module`, `status`, `score`, `findingsCount` |
| `verdict` | Final verdict computed | `verdict`, `confidence`, `reasoning` |
| `error` | Pipeline failure | `error` |
| `complete` | Evaluation finished | `message` |

### JavaScript Client Example

```javascript
const source = new EventSource(
  "http://localhost:3001/api/evaluations/abc123/events"
);

source.addEventListener("status", (e) => {
  const event = JSON.parse(e.data);
  console.log(`Status: ${event.data.status} — ${event.data.message}`);
});

source.addEventListener("progress", (e) => {
  const event = JSON.parse(e.data);
  console.log(`${event.data.module}: score ${event.data.score}, ${event.data.findingsCount} findings`);
});

source.addEventListener("verdict", (e) => {
  const event = JSON.parse(e.data);
  console.log(`Verdict: ${event.data.verdict} (confidence: ${event.data.confidence})`);
});

source.addEventListener("complete", () => {
  console.log("Evaluation complete");
  source.close();
});

source.addEventListener("error", (e) => {
  if (e.data) {
    const event = JSON.parse(e.data);
    console.error(`Error: ${event.data.error}`);
  }
  source.close();
});
```
