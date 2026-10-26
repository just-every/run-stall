CREATE TABLE st_experiments (
 id TEXT PRIMARY KEY,
 sku TEXT NOT NULL,
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL
);
CREATE INDEX st_experiments_sku ON st_experiments(sku);
-- Aggregate product page counts by UTC hour only: no person, session, address or referrer is kept.
CREATE TABLE st_product_views (
 hour TEXT NOT NULL,
 sku TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0,
 limited INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (hour, sku)
);
