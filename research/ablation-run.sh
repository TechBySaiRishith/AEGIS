#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ablation-run.sh — Run a single AEGIS ablation evaluation
#
# Calls the AEGIS API with per-request model overrides, polls
# until completion, and saves structured results to JSON.
#
# Usage:
#   ./scripts/ablation-run.sh <RUN_ID> <SENTINEL_MODEL> <WATCHDOG_MODEL> <GUARDIAN_MODEL> <SYNTHESIZER_MODEL>
#
# Example:
#   ./scripts/ablation-run.sh run-01-baseline \
#     copilot/claude-sonnet-4.5 \
#     copilot/claude-sonnet-4.5 \
#     copilot/claude-sonnet-4.5 \
#     copilot/claude-sonnet-4.5
#
# Environment:
#   AEGIS_API_URL  — API base URL (default: http://localhost:3001)
#   AEGIS_TARGET   — GitHub URL to evaluate (default: verimediaai)
#   AEGIS_DESC     — Application description for the evaluation
#   POLL_INTERVAL  — Seconds between status polls (default: 15)
#   POLL_TIMEOUT   — Max seconds to wait for completion (default: 300)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ─── Color helpers ───────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[ablation]${NC} $*"; }
warn() { echo -e "${YELLOW}[ablation]${NC} $*" >&2; }
err()  { echo -e "${RED}[ablation]${NC} $*" >&2; }

# ─── Arguments ───────────────────────────────────────────────
if [[ $# -lt 5 ]]; then
  echo "Usage: $0 <RUN_ID> <SENTINEL_MODEL> <WATCHDOG_MODEL> <GUARDIAN_MODEL> <SYNTHESIZER_MODEL>"
  echo ""
  echo "Models use provider/model format, e.g. copilot/claude-sonnet-4.5"
  exit 1
fi

RUN_ID="$1"
SENTINEL_MODEL="$2"
WATCHDOG_MODEL="$3"
GUARDIAN_MODEL="$4"
SYNTHESIZER_MODEL="$5"

# ─── Configuration ───────────────────────────────────────────
API_URL="${AEGIS_API_URL:-http://localhost:3001}"
TARGET_NAME="${AEGIS_TARGET:-VeriMedia AI}"
DEFAULT_DESC="VeriMedia AI is an AI-powered media verification platform built with Flask and Python. It uses deep learning models (ResNet, BERT) to detect manipulated images and videos, verify news article authenticity, and provide real-time fact-checking across social media platforms.

Key technical components:
- Computer vision pipeline for deepfake detection using convolutional neural networks
- NLP module for claim extraction and fact verification against knowledge bases
- Social media monitoring API integration (Twitter, Facebook, Reddit)
- Automated content moderation system with minimal human oversight
- User-uploaded content processing pipeline with no content filtering
- Autonomous decision-making about content authenticity affecting public discourse
- REST API serving predictions to downstream consumers
- PostgreSQL database storing user data, content fingerprints, and moderation decisions
- No explicit bias testing or fairness evaluation in the ML pipeline
- No governance documentation or model cards
- Deploys on AWS with public-facing endpoints"
DESCRIPTION="${AEGIS_DESC:-${DEFAULT_DESC}}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
POLL_TIMEOUT="${POLL_TIMEOUT:-300}"

# Resolve output directory relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/ablation-results"
RESULT_FILE="${RESULTS_DIR}/${RUN_ID}.json"

mkdir -p "${RESULTS_DIR}"

# ─── Preflight: check API is reachable ───────────────────────
log "Checking API health at ${API_URL}..."
if ! curl -sf "${API_URL}/api/health" > /dev/null 2>&1; then
  err "API not reachable at ${API_URL}/api/health — is the server running?"
  exit 1
fi
log "API is healthy ✓"

# ─── Record start time ──────────────────────────────────────
START_TS=$(date +%s)
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ─── Submit evaluation with per-request model overrides ──────
log "Submitting evaluation ${BOLD}${RUN_ID}${NC}"
log "  sentinel:    ${SENTINEL_MODEL}"
log "  watchdog:    ${WATCHDOG_MODEL}"
log "  guardian:    ${GUARDIAN_MODEL}"
log "  synthesizer: ${SYNTHESIZER_MODEL}"

SUBMIT_BODY=$(python3 -c "
import json, sys
print(json.dumps({
    'inputType': 'text',
    'source': sys.argv[1],
    'description': sys.argv[2],
    'models': {
        'sentinel': sys.argv[3],
        'watchdog': sys.argv[4],
        'guardian': sys.argv[5],
        'synthesizer': sys.argv[6],
    }
}))
" "${TARGET_NAME}" "${DESCRIPTION}" "${SENTINEL_MODEL}" "${WATCHDOG_MODEL}" "${GUARDIAN_MODEL}" "${SYNTHESIZER_MODEL}")

SUBMIT_RESPONSE=$(curl -sf -X POST "${API_URL}/api/evaluate" \
  -H "Content-Type: application/json" \
  -d "${SUBMIT_BODY}" 2>&1) || {
  err "Failed to submit evaluation. Response: ${SUBMIT_RESPONSE}"
  # Save error result
  cat > "${RESULT_FILE}" <<ERRJSON
{
  "run_id": "${RUN_ID}",
  "models": {
    "sentinel": "${SENTINEL_MODEL}",
    "watchdog": "${WATCHDOG_MODEL}",
    "guardian": "${GUARDIAN_MODEL}",
    "synthesizer": "${SYNTHESIZER_MODEL}"
  },
  "status": "submit_failed",
  "error": "Failed to submit evaluation to API",
  "started_at": "${START_ISO}",
  "completed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "duration_seconds": $(( $(date +%s) - START_TS ))
}
ERRJSON
  exit 1
}

EVAL_ID=$(echo "${SUBMIT_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['evaluationId'])" 2>/dev/null) || {
  err "Could not parse evaluationId from response: ${SUBMIT_RESPONSE}"
  exit 1
}

log "Evaluation started: ${BOLD}${EVAL_ID}${NC}"

# ─── Poll for completion ─────────────────────────────────────
ELAPSED=0
STATUS="pending"

while [[ "${STATUS}" != "completed" && "${STATUS}" != "failed" ]]; do
  if [[ ${ELAPSED} -ge ${POLL_TIMEOUT} ]]; then
    err "Timeout after ${POLL_TIMEOUT}s — evaluation ${EVAL_ID} still in status: ${STATUS}"
    cat > "${RESULT_FILE}" <<TMOJSON
{
  "run_id": "${RUN_ID}",
  "evaluation_id": "${EVAL_ID}",
  "models": {
    "sentinel": "${SENTINEL_MODEL}",
    "watchdog": "${WATCHDOG_MODEL}",
    "guardian": "${GUARDIAN_MODEL}",
    "synthesizer": "${SYNTHESIZER_MODEL}"
  },
  "status": "timeout",
  "last_status": "${STATUS}",
  "error": "Timed out after ${POLL_TIMEOUT}s",
  "started_at": "${START_ISO}",
  "completed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "duration_seconds": ${ELAPSED}
}
TMOJSON
    exit 1
  fi

  sleep "${POLL_INTERVAL}"
  ELAPSED=$(( $(date +%s) - START_TS ))

  POLL_RESPONSE=$(curl -sf "${API_URL}/api/evaluate/${EVAL_ID}" 2>&1) || {
    warn "Poll request failed (elapsed ${ELAPSED}s) — retrying..."
    continue
  }

  STATUS=$(echo "${POLL_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null) || {
    warn "Could not parse status from poll response — retrying..."
    continue
  }

  log "  [${ELAPSED}s] status: ${STATUS}"
done

# ─── Record end time ─────────────────────────────────────────
END_TS=$(date +%s)
END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DURATION=$(( END_TS - START_TS ))

# ─── Extract and save results ────────────────────────────────
log "Evaluation ${STATUS}. Extracting results..."

# Fetch the full evaluation data
FULL_RESPONSE=$(curl -sf "${API_URL}/api/evaluate/${EVAL_ID}" 2>&1) || {
  err "Failed to fetch final evaluation data"
  exit 1
}

# Use Python to extract structured results and write JSON
python3 << 'PYEOF' - "${FULL_RESPONSE}" "${RUN_ID}" "${SENTINEL_MODEL}" "${WATCHDOG_MODEL}" "${GUARDIAN_MODEL}" "${SYNTHESIZER_MODEL}" "${START_ISO}" "${END_ISO}" "${DURATION}" "${RESULT_FILE}" "${STATUS}"
import sys, json

raw = sys.argv[1]
run_id = sys.argv[2]
sentinel_model = sys.argv[3]
watchdog_model = sys.argv[4]
guardian_model = sys.argv[5]
synthesizer_model = sys.argv[6]
started_at = sys.argv[7]
ended_at = sys.argv[8]
duration = int(sys.argv[9])
out_path = sys.argv[10]
final_status = sys.argv[11]

data = json.loads(raw)

# Extract verdict info
verdict_data = data.get("verdict") or {}
verdict = verdict_data.get("verdict", "UNKNOWN")
confidence = verdict_data.get("confidence", 0)
reasoning = verdict_data.get("reasoning", "")

# Extract per-module results
assessments = data.get("assessments", [])
modules = {}
for a in assessments:
    mid = a.get("moduleId", "unknown")
    findings = a.get("findings", [])
    # Top 3 finding summaries
    top_findings = []
    for f in findings[:3]:
        if isinstance(f, dict):
            top_findings.append(f.get("title", f.get("description", str(f)))[:200])
        else:
            top_findings.append(str(f)[:200])

    modules[mid] = {
        "model": a.get("model", "unknown"),
        "status": a.get("status", "unknown"),
        "score": a.get("score", 0),
        "risk_level": a.get("riskLevel", "unknown"),
        "findings_count": len(findings),
        "top_findings": top_findings,
        "summary": (a.get("summary") or "")[:500],
        "recommendation": (a.get("recommendation") or "")[:500],
    }

result = {
    "run_id": run_id,
    "evaluation_id": data.get("id", ""),
    "status": final_status,
    "models": {
        "sentinel": sentinel_model,
        "watchdog": watchdog_model,
        "guardian": guardian_model,
        "synthesizer": synthesizer_model,
    },
    "verdict": verdict,
    "confidence": confidence,
    "reasoning": reasoning,
    "modules": modules,
    "started_at": started_at,
    "completed_at": ended_at,
    "duration_seconds": duration,
    "error": data.get("error"),
}

with open(out_path, "w") as f:
    json.dump(result, f, indent=2)

# Print one-line summary to stdout
module_scores = " | ".join(
    f"{mid}={m['score']}" for mid, m in sorted(modules.items())
)
print(f"[{run_id}] {verdict} (confidence={confidence:.2f}) — {module_scores} — {duration}s")
PYEOF

log "Results saved to ${GREEN}${RESULT_FILE}${NC}"
