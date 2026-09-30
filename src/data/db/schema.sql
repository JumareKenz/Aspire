-- ASPIRE-GAC canonical store (PostgreSQL).
--
-- All access goes through the repositories in `src/data/repositories`, so the
-- rest of the platform is unaware of the engine. Statements are idempotent so
-- the schema can be applied on every boot without a migration runner.

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS org_units (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL,
  parent_id   TEXT,
  path        TEXT NOT NULL,
  lon         DOUBLE PRECISION,
  lat         DOUBLE PRECISION,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_level ON org_units(level);
-- Descendant lookups match on the materialised path, so it is indexed for the
-- prefix/containment scans `listDescendants` performs.
CREATE INDEX IF NOT EXISTS idx_org_units_path ON org_units(path text_pattern_ops);

CREATE TABLE IF NOT EXISTS periods (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  label       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  indicator_id    TEXT NOT NULL,
  org_unit_id     TEXT NOT NULL,
  period_id       TEXT NOT NULL,
  disaggregation  TEXT NOT NULL DEFAULT '',
  value           DOUBLE PRECISION NOT NULL,
  numerator       DOUBLE PRECISION,
  denominator     DOUBLE PRECISION,
  PRIMARY KEY (indicator_id, org_unit_id, period_id, disaggregation)
);
CREATE INDEX IF NOT EXISTS idx_obs_org_period ON observations(org_unit_id, period_id);
CREATE INDEX IF NOT EXISTS idx_obs_indicator_period ON observations(indicator_id, period_id);

CREATE TABLE IF NOT EXISTS reporting (
  org_unit_id   TEXT NOT NULL,
  dataset_id    TEXT NOT NULL,
  period_id     TEXT NOT NULL,
  expected      BOOLEAN NOT NULL,
  reported      BOOLEAN NOT NULL,
  submitted_at  TIMESTAMPTZ,
  due_date      DATE NOT NULL,
  PRIMARY KEY (org_unit_id, dataset_id, period_id)
);
CREATE INDEX IF NOT EXISTS idx_reporting_period ON reporting(period_id);

CREATE TABLE IF NOT EXISTS targets (
  indicator_id  TEXT NOT NULL,
  org_unit_id   TEXT NOT NULL DEFAULT '',
  period_id     TEXT NOT NULL DEFAULT '',
  value         DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (indicator_id, org_unit_id, period_id)
);

-- Indicator definitions and methodologies are stored as JSON documents so that
-- the registry and the scoring methodology remain configuration rather than
-- schema. Both are validated on read.
CREATE TABLE IF NOT EXISTS indicator_config (
  id          TEXT PRIMARY KEY,
  definition  JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_config (
  id          TEXT PRIMARY KEY,
  definition  JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS methodologies (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  status      TEXT NOT NULL,
  document    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
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
  evidence       JSONB NOT NULL,
  status         TEXT NOT NULL,
  detected_at    TIMESTAMPTZ NOT NULL
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
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL,
  last_login_at  TIMESTAMPTZ
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
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  due_date      DATE,
  outcome       TEXT,
  -- Score for the action's org unit at creation time, so outcome can be measured.
  baseline_score DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL,
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
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL,
  org_units     INTEGER NOT NULL DEFAULT 0,
  observations  INTEGER NOT NULL DEFAULT 0,
  findings      INTEGER NOT NULL DEFAULT 0,
  message       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_runs(started_at DESC);

-- DHIS2 validation rules, run per facility and month.
--
-- One row per facility-month checked, whether or not anything failed: a
-- scorecard has to tell a facility that passed from one that was never
-- checked, and from one that submitted nothing to check.
CREATE TABLE IF NOT EXISTS validation_checks (
  org_unit_id   TEXT NOT NULL,
  dataset_id    TEXT NOT NULL,
  period_id     TEXT NOT NULL,            -- monthly, YYYYMM
  reported      BOOLEAN NOT NULL,         -- the form was submitted for the month
  violations    INTEGER NOT NULL DEFAULT 0,
  checked_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_unit_id, dataset_id, period_id)
);
CREATE INDEX IF NOT EXISTS idx_validation_checks_period ON validation_checks(period_id);

CREATE TABLE IF NOT EXISTS validation_violations (
  org_unit_id   TEXT NOT NULL,
  dataset_id    TEXT NOT NULL,
  period_id     TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  rule_name     TEXT NOT NULL,
  importance    TEXT,
  operator      TEXT,
  left_desc     TEXT,
  left_value    DOUBLE PRECISION,
  right_desc    TEXT,
  right_value   DOUBLE PRECISION,
  PRIMARY KEY (org_unit_id, dataset_id, period_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_validation_violations_rule ON validation_violations(rule_id);
