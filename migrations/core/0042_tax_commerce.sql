CREATE TABLE st_tax_commerce (
 id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 account_id TEXT, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
 consent TEXT NOT NULL, restored INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE st_tax_quotes (
 id TEXT PRIMARY KEY, intent_hash TEXT NOT NULL, config_revision TEXT NOT NULL,
 commerce_revision TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','uncertain','observed')),
 provider_id TEXT, result_json TEXT, attempted_at TEXT, order_id TEXT UNIQUE,
 restored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX st_tax_quote_intent ON st_tax_quotes(intent_hash,status);
CREATE TABLE st_tax_transactions (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('sale','refund')),
 intent_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','uncertain','observed')),
 provider_id TEXT UNIQUE, attempted_at TEXT, result_json TEXT, restored INTEGER NOT NULL DEFAULT 0
);
