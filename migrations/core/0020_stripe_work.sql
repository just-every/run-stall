-- Commercial references only: no payloads, contact fingerprints or authority.
CREATE TABLE st_stripe_work (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('checkout','refund')),
 intent_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','uncertain','response_observed')),
 attempts INTEGER NOT NULL CHECK(attempts IN (0,1)),
 attempted_at TEXT NOT NULL,
 observed_at TEXT,
 provider_id TEXT,
 error_code TEXT
);
CREATE INDEX st_stripe_work_order ON st_stripe_work(order_id);
