CREATE TABLE st_merch_proposals (
 id TEXT PRIMARY KEY,
 sku TEXT NOT NULL,
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL
);
CREATE INDEX st_merch_proposals_sku ON st_merch_proposals(sku);
