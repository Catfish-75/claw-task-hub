import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });

const legacyDbPath = join(dataDir, "codex-task-hub.sqlite");
const clawDbPath = join(dataDir, "claw-task-hub.sqlite");
type SqliteDatabase = InstanceType<typeof Database>;

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env, legacyExists = existsSync(legacyDbPath)) {
  const defaultDbPath = legacyExists ? legacyDbPath : clawDbPath;
  return env.CLAW_TASK_HUB_DB ?? env.CODEX_TASK_HUB_DB ?? defaultDbPath;
}

export const dbPath = resolveDbPath();
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);

export function initializeDatabase(database: SqliteDatabase) {
  configureDatabase(database);
  createSchema(database);
  return runMigrations(database);
}

function configureDatabase(database: SqliteDatabase) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
}

function createSchema(database: SqliteDatabase) {
  database.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  key TEXT,
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Backlog',
  priority INTEGER NOT NULL DEFAULT 3,
  lead TEXT,
  source TEXT NOT NULL DEFAULT 'local',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  identifier TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Backlog',
  status_type TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER NOT NULL DEFAULT 3,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  assignee TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'local',
  url TEXT,
  archived_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT,
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  cursor TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  source TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  harness TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS issue_claims (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  force INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS issue_fts USING fts5(
  title,
  description,
  content='issues',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS issues_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issue_fts(rowid, title, description) VALUES (new.rowid, new.title, coalesce(new.description, ''));
END;
CREATE TRIGGER IF NOT EXISTS issues_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, coalesce(old.description, ''));
END;
CREATE TRIGGER IF NOT EXISTS issues_au AFTER UPDATE ON issues BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, coalesce(old.description, ''));
  INSERT INTO issue_fts(rowid, title, description) VALUES (new.rowid, new.title, coalesce(new.description, ''));
END;

CREATE INDEX IF NOT EXISTS idx_issues_team_updated ON issues(team_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_identifier ON issues(identifier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_identifier_unique ON issues(identifier) WHERE identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issues_assignee_status ON issues(assignee, status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_issue_created ON comments(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status_expires ON agent_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_issue_claims_issue_active ON issue_claims(issue_id, released_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_issue_claims_session ON issue_claims(session_id, released_at);
`);
}

const migrations: {
  id: string;
  description: string;
  up: (database: SqliteDatabase) => void;
}[] = [
  {
    id: "0001_baseline_schema",
    description: "Record the bootstrap schema managed by server/db.ts",
    up: (database) => {
      database.exec("INSERT INTO issue_fts(issue_fts) VALUES('rebuild')");
    },
  },
  {
    id: "0002_comments_issue_created_index",
    description: "Index comments by issue and creation time for agent acceptance lookups",
    up: (database) => {
      database.exec("CREATE INDEX IF NOT EXISTS idx_comments_issue_created ON comments(issue_id, created_at DESC)");
    },
  },
];

export function runMigrations(database: SqliteDatabase = db) {
  ensureSchemaMigrationsTable(database);
  const applied: string[] = [];
  const tx = database.transaction(() => {
    normalizeLegacyMigrationRows(database);
    const exists = database.prepare("SELECT 1 FROM schema_migrations WHERE id = @id");
    const record = prepareMigrationRecord(database);
    for (const migration of migrations) {
      if (exists.get({ id: migration.id })) continue;
      migration.up(database);
      record.run({
        id: migration.id,
        name: migration.description,
        description: migration.description,
        applied_at: nowIso(),
      });
      applied.push(migration.id);
    }
  });
  tx.immediate();
  return { applied, current: migrations.at(-1)?.id ?? null };
}

function ensureSchemaMigrationsTable(database: SqliteDatabase) {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
  `);
  const columns = database.prepare("PRAGMA table_info(schema_migrations)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "name")) {
    try {
      database.exec("ALTER TABLE schema_migrations ADD COLUMN name TEXT");
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
    if (columns.some((column) => column.name === "description")) {
      database.exec("UPDATE schema_migrations SET name = description WHERE name IS NULL");
    }
  }
}

function normalizeLegacyMigrationRows(database: SqliteDatabase) {
  database.prepare(`
    UPDATE schema_migrations
    SET id = '0001_baseline_schema',
        name = COALESCE(name, 'Record the bootstrap schema managed by server/db.ts')
    WHERE id = '0001_bootstrap_schema'
      AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0001_baseline_schema')
  `).run();
  database.prepare(`
    DELETE FROM schema_migrations
    WHERE id = '0001_bootstrap_schema'
      AND EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0001_baseline_schema')
  `).run();
}

function prepareMigrationRecord(database: SqliteDatabase) {
  const columns = database.prepare("PRAGMA table_info(schema_migrations)").all() as { name: string }[];
  if (columns.some((column) => column.name === "description")) {
    return database.prepare(`
      INSERT INTO schema_migrations (id, name, description, applied_at)
      VALUES (@id, @name, @description, @applied_at)
    `);
  }
  return database.prepare(`
    INSERT INTO schema_migrations (id, name, applied_at)
    VALUES (@id, @name, @applied_at)
  `);
}

function isDuplicateColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("duplicate column name");
}

initializeDatabase(db);

export function nowIso() {
  return new Date().toISOString();
}

export function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
