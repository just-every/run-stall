-- No address, customer identity, credential or application authority is retained.
CREATE TABLE st_tax_previews (
 id TEXT PRIMARY KEY NOT NULL,
 intent_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','uncertain','observed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts IN (0,1)),
 attempted_at TEXT,
 observed_at TEXT,
 provider_id TEXT,
 result_json TEXT,
 error_code TEXT,
 restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1))
);
