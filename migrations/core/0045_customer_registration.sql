-- Local intake is never identity authority and must not travel in archives.
CREATE TABLE st_customer_registrations (
 id TEXT PRIMARY KEY NOT NULL,
 email_key TEXT UNIQUE,
 email TEXT,
 display_name TEXT,
 consent_version TEXT NOT NULL,
 requested_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','invited','declined','failed','expired')),
 decided_at INTEGER,
 decided_by TEXT
);
CREATE INDEX st_customer_registrations_pending ON st_customer_registrations(status,expires_at);
CREATE TABLE st_customer_registration_limits (
 client_key TEXT PRIMARY KEY NOT NULL,
 window INTEGER NOT NULL,
 attempts INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
