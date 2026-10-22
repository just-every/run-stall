-- Advisory provider observations and explicit merchant fulfillment decisions only.
-- No customer contact, addresses, card details, internal notes or credentials.
CREATE TABLE st_risk_rules (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE st_risk (
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES st_orders(id),
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE st_risk_decisions (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES st_orders(id),
 risk_revision TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('release','cancel')),
 reviewer_id TEXT NOT NULL,
 reviewer_version INTEGER NOT NULL,
 decided_at TEXT NOT NULL,
 UNIQUE(order_id,risk_revision)
);
CREATE TABLE st_risk_notifications (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES st_orders(id),
 signal_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 read_by TEXT,
 read_at TEXT,
 UNIQUE(order_id,signal_hash)
);
CREATE INDEX st_risk_notifications_unread ON st_risk_notifications(read_at,created_at);
