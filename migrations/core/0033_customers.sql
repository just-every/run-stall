-- Commercial directory data never creates a native login or grants order access.
CREATE TABLE st_customers(id TEXT PRIMARY KEY NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL);
CREATE TABLE st_customer_emails(email TEXT PRIMARY KEY NOT NULL,customer_id TEXT NOT NULL REFERENCES st_customers(id) ON DELETE CASCADE);
CREATE TABLE st_customer_addresses(id TEXT PRIMARY KEY NOT NULL,email TEXT NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL);
CREATE INDEX st_customer_addresses_email ON st_customer_addresses(email);
CREATE TABLE st_customer_segments(id TEXT PRIMARY KEY NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
