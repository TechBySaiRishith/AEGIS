import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const DATA_DIR = process.env.AEGIS_DATA_DIR || join(process.cwd(), ".data");

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = join(DATA_DIR, "aegis.db");
const sqlite = new Database(dbPath);

// WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Auto-create tables on first connection
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS evaluations (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'pending',
    input_type      TEXT NOT NULL,
    source_url      TEXT,
    application_name        TEXT NOT NULL,
    application_description TEXT,
    application_profile     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    completed_at    TEXT,
    error           TEXT
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id              TEXT PRIMARY KEY,
    evaluation_id   TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    module_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    score           REAL,
    risk_level      TEXT,
    findings        TEXT,
    summary         TEXT,
    recommendation  TEXT,
    model           TEXT,
    completed_at    TEXT,
    error           TEXT
  );

  CREATE TABLE IF NOT EXISTS verdicts (
    id                  TEXT PRIMARY KEY,
    evaluation_id       TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    verdict             TEXT NOT NULL,
    confidence          REAL NOT NULL,
    reasoning           TEXT NOT NULL,
    critiques           TEXT,
    per_module_summary  TEXT,
    algorithmic_verdict TEXT NOT NULL,
    llm_enhanced        INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite, { schema });
export { sqlite };
