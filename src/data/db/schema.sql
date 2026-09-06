-- ASPIRE-GAC canonical store.
-- SQLite is used because the aggregate volumes involved fit comfortably in a
-- single embedded database and the platform must run without external
-- infrastructure. All access goes through the repositories in
-- `src/data/repositories`, so moving to Postgres is a driver change.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_units (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL,
  parent_id   TEXT REFERENCES org_units(id),
  path        TEXT NOT NULL,
  lon         REAL,
  lat         REAL,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_level ON org_units(level);

CREATE TABLE IF NOT EXISTS periods (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  label       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  indicator_id    TEXT NOT NULL,
  org_unit_id     TEXT NOT NULL,
  period_id       TEXT NOT NULL,
  disaggregation  TEXT NOT NULL DEFAULT '',
  value           REAL NOT NULL,
  numerator       REAL,
  denominator     REAL,
  PRIMARY KEY (indicator_id, org_unit_id, period_id, disaggregation)
);
CREATE INDEX IF NOT EXISTS idx_obs_org_period ON observations(org_unit_id, period_id);
CREATE INDEX IF NOT EXISTS idx_obs_indicator_period ON observations(indicator_id, period_id);

CREATE TABLE IF NOT EXISTS reporting (
  org_unit_id   TEXT NOT NULL,
  dataset_id    TEXT NOT NULL,
  period_id     TEXT NOT NULL,
  expected      INTEGER NOT NULL,
  reported      INTEGER NOT NULL,
  submitted_at  TEXT,
  due_date      TEXT NOT NULL,
  PRIMARY KEY (org_unit_id, dataset_id, period_id)
);
CREATE INDEX IF NOT EXISTS idx_reporting_period ON reporting(period_id);

CREATE TABLE IF NOT EXISTS targets (
  indicator_id  TEXT NOT NULL,
  org_unit_id   TEXT NOT NULL DEFAULT '',
  period_id     TEXT NOT NULL DEFAULT '',
  value         REAL NOT NULL,
  PRIMARY KEY (indicator_id, org_unit_id, period_id)
);

-- Indicator definitions and methodologies are stored as JSON documents so that
-- the registry and the scoring methodology remain configuration rather than
-- schema. Both are validated on read.
CREATE TABLE IF NOT EXISTS indicator_config (
  id          TEXT PRIMARY KEY,
  definition  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_config (
  id          TEXT PRIMARY KEY,
  definition  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS methodologies (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  status      TEXT NOT NULL,
  document    TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_findings (
  id             TEXT PRIMARY KEY,
  dimension      TEXT NOT NULL,
  severity       TEXT NOT NULL,
  org_unit_id    TEXT NOT NULL,
  org_unit_name  TEXT NOT NULL,
  indicator_id   TEXT,
  indicator_name TEXT,
  period_id      TEXT NOT NULL,
  title          TEXT NOT NULL,
  reason         TEXT NOT NULL,
  evidence       TEXT NOT NULL,
  status         TEXT NOT NULL,
  detected_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_org ON quality_findings(org_unit_id, period_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON quality_findings(status);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,
  -- Empty scope means national access. Otherwise a comma-separated list of
  -- org unit ids the user may see, including their descendants.
  scope          TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS actions (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  org_unit_id   TEXT,
  indicator_id  TEXT,
  period_id     TEXT,
  source        TEXT NOT NULL,
  source_ref    TEXT,
  priority      TEXT NOT NULL,
  status        TEXT NOT NULL,
  assignee_id   TEXT REFERENCES users(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  due_date      TEXT,
  outcome       TEXT,
  -- Score for the action's org unit at creation time, so outcome can be measured.
  baseline_score REAL
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,
  org_units     INTEGER NOT NULL DEFAULT 0,
  observations  INTEGER NOT NULL DEFAULT 0,
  findings      INTEGER NOT NULL DEFAULT 0,
  message       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_runs(started_at DESC);
