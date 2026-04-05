# AEGIS — AI Safety Lab

Adversarial evaluation and governance platform for AI systems. Built for the UNICC AI Safety Lab.

AEGIS evaluates AI repositories against safety frameworks using a council of specialized expert agents (Sentinel, Watchdog, Guardian) that analyze code, surface risks, and produce actionable safety reports.

## Quick start

```bash
# 1. Clone and enter the project
git clone <repo-url> && cd aegis

# 2. Create your environment file
cp .env.example .env
# Works out of the box in mock mode — edit .env to add real API keys later

# 3. Start everything
docker compose up --build
```

Once running:

- **Web UI** — [http://localhost:3000](http://localhost:3000)
- **API** — [http://localhost:3001](http://localhost:3001)
- **Health check** — [http://localhost:3001/health](http://localhost:3001/health)

## What it does

```
┌─────────┐    ┌──────────────────────────────────────────┐
│  Web UI │───▶│  API Server (Hono + Node.js)             │
│ Next.js │    │                                          │
└─────────┘    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
               │  │ Sentinel │ │ Watchdog │ │ Guardian │ │
               │  │ (CWE/    │ │ (Supply  │ │ (Policy  │ │
               │  │  OWASP)  │ │  Chain)  │ │  Compl.) │ │
               │  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
               │       └────────────┼─────────────┘       │
               │              ┌─────▼─────┐               │
               │              │Synthesizer│               │
               │              │ (Verdict) │               │
               │              └───────────┘               │
               └──────────────────────────────────────────┘
```

1. Submit a repository URL for evaluation
2. Expert agents analyze the code in parallel using LLMs
3. A synthesizer agent produces a final verdict: **APPROVE**, **REVIEW**, or **REJECT**
4. View detailed findings, risk scores, and remediation guidance in the dashboard

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | One of these | Anthropic Claude API key |
| `OPENAI_API_KEY` | or `MOCK_MODE=1` | OpenAI API key |
| `GITHUB_TOKEN` | Recommended | GitHub PAT for cloning private repos |
| `MOCK_MODE` | No | Set to `1` to skip LLM calls (demo mode) |
| `PORT` | No | API port (default: `3001`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `http://localhost:3000`) |
| `SENTINEL_MODEL` | No | Model for Sentinel agent (e.g. `anthropic/claude-sonnet-4-5-20250514`) |
| `WATCHDOG_MODEL` | No | Model for Watchdog agent |
| `GUARDIAN_MODEL` | No | Model for Guardian agent |
| `SYNTHESIZER_MODEL` | No | Model for Synthesizer agent |
| `AEGIS_DEFAULT_MODEL` | No | Fallback model for all agents |
| `CUSTOM_LLM_BASE_URL` | No | OpenAI-compatible endpoint (Ollama, vLLM) |
| `CUSTOM_LLM_API_KEY` | No | API key for custom endpoint |

## Development setup (without Docker)

Prerequisites: Node.js ≥ 20, pnpm

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Start both API and Web in development mode
pnpm dev
```

The API runs on `http://localhost:3001` and the web UI on `http://localhost:3000`.

### Useful commands

```bash
pnpm dev            # Start all services in dev mode
pnpm build          # Build all packages
pnpm lint           # Lint all packages
pnpm docker:up      # Build and start Docker containers
pnpm docker:down    # Stop Docker containers
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/status` | Service status and version |
| `POST` | `/api/v1/evaluations` | Start a new evaluation |
| `GET` | `/api/v1/evaluations/:id` | Get evaluation status and results |
| `GET` | `/api/v1/evaluations` | List all evaluations |

## Project structure

```
aegis/
├── apps/
│   ├── api/                # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts    # Server entrypoint
│   │   │   ├── routes/     # API route handlers
│   │   │   ├── experts/    # Sentinel, Watchdog, Guardian agents
│   │   │   ├── council/    # Synthesizer + verdict logic
│   │   │   ├── intake/     # Repo cloning + file extraction
│   │   │   ├── llm/        # LLM provider abstraction
│   │   │   ├── db/         # SQLite + Drizzle ORM
│   │   │   └── reports/    # Report generation
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                # Next.js frontend
│       ├── src/app/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   └── shared/             # Shared types and constants
├── data/                   # Runtime data (gitignored)
│   ├── aegis.db            # SQLite database
│   └── repos/              # Cloned repositories
├── docker-compose.yml
├── .env.example
└── package.json            # Workspace root
```

## License

MIT
