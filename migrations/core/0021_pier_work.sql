-- Commercial correlations and fingerprints only. Never payloads or authority.
CREATE TABLE st_pier_work (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('order.create','order.channelPayment','dispatch.create')),
 intent_hash TEXT NOT NULL,
 pier_origin TEXT NOT NULL,
 pier_customer_id TEXT NOT NULL,
 provider_correlation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','uncertain','response_observed')),
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 attempted_at TEXT NOT NULL,
 observed_at TEXT,
 provider_id TEXT,
 error_code TEXT
);
CREATE INDEX st_pier_work_order ON st_pier_work(order_id);
