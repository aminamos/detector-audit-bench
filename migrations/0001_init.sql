CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  external_id TEXT,
  parent_id TEXT REFERENCES documents(id),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  era TEXT,
  source TEXT,
  slice TEXT,
  label TEXT NOT NULL CHECK (label IN ('human', 'ai', 'mixed')),
  ai_pct REAL,
  word_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_run_id ON documents(run_id);
CREATE INDEX IF NOT EXISTS idx_documents_run_external ON documents(run_id, external_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  detector TEXT NOT NULL,
  model TEXT,
  prediction TEXT,
  fraction_ai REAL,
  fraction_ai_assisted REAL,
  fraction_human REAL,
  full_json TEXT NOT NULL,
  scored_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_run_id ON scores(run_id);
CREATE INDEX IF NOT EXISTS idx_scores_document_id ON scores(document_id);
