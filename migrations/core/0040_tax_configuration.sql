-- Merchant configuration and reviewed evidence only; neither grants sale authority.
CREATE TABLE st_tax_configuration (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE st_tax_exemptions (
 id TEXT PRIMARY KEY NOT NULL,
 revision TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 state TEXT NOT NULL,
 evidence_reference TEXT NOT NULL,
 expires_on TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 reviewed_by TEXT NOT NULL,
 reviewed_at TEXT NOT NULL,
 restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1))
);
CREATE INDEX st_tax_exemptions_customer ON st_tax_exemptions(customer_email,state);
