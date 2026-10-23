-- Commercial directory data never creates a native login or grants order access.
CREATE TABLE st_customers(id TEXT PRIMARY KEY NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL);
CREATE TABLE st_customer_emails(email TEXT PRIMARY KEY NOT NULL,customer_id TEXT NOT NULL REFERENCES st_customers(id) ON DELETE CASCADE);
CREATE TABLE st_customer_addresses(id TEXT PRIMARY KEY NOT NULL,email TEXT NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL);
CREATE INDEX st_customer_addresses_email ON st_customer_addresses(email);
CREATE TABLE st_customer_segments(id TEXT PRIMARY KEY NOT NULL,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));

-- Existing/new commerce contacts join the directory without acquiring a login.
INSERT INTO st_customers(id,revision,value_json,created_at)
 SELECT 'order-customer:'||MIN(id),lower(hex(randomblob(16))),'{'||'"name":"","tags":[],"notes":[]'||'}',MIN(json_extract(value_json,'$.createdAt'))
 FROM st_orders WHERE json_extract(value_json,'$.customerEmail') IS NOT NULL AND json_extract(value_json,'$.erasedAt') IS NULL GROUP BY lower(json_extract(value_json,'$.customerEmail'));
INSERT INTO st_customer_emails(email,customer_id)
 SELECT lower(json_extract(value_json,'$.customerEmail')),'order-customer:'||MIN(id)
 FROM st_orders WHERE json_extract(value_json,'$.customerEmail') IS NOT NULL AND json_extract(value_json,'$.erasedAt') IS NULL GROUP BY lower(json_extract(value_json,'$.customerEmail'));
CREATE TRIGGER st_customer_order_contact AFTER INSERT ON st_orders WHEN json_extract(NEW.value_json,'$.customerEmail') IS NOT NULL AND json_extract(NEW.value_json,'$.erasedAt') IS NULL BEGIN
 INSERT INTO st_customers SELECT 'order-customer:'||NEW.id,lower(hex(randomblob(16))),'{"name":"","tags":[],"notes":[]}',json_extract(NEW.value_json,'$.createdAt') WHERE NOT EXISTS(SELECT 1 FROM st_customer_emails WHERE email=lower(json_extract(NEW.value_json,'$.customerEmail')));
 INSERT OR IGNORE INTO st_customer_emails VALUES(lower(json_extract(NEW.value_json,'$.customerEmail')),'order-customer:'||NEW.id);
END;
