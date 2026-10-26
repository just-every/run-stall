CREATE TABLE st_buy_links (
 id TEXT PRIMARY KEY,
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL,
 revoked_at TEXT,
 restored INTEGER NOT NULL DEFAULT 0
);
