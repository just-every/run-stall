-- Installation-local authority and customer custody. All these tables are excluded
-- from archives: a restore must never re-enable an app, endpoint or identity link.
CREATE TABLE st_headless_apps (
 id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
 issuer_id TEXT NOT NULL, issuer_version INTEGER NOT NULL, origin TEXT NOT NULL,
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)), expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE st_headless_customers (id TEXT PRIMARY KEY NOT NULL, operator_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE st_headless_carts (
 id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), revision TEXT NOT NULL,
 created_at TEXT NOT NULL, checkout_request TEXT
);
CREATE TABLE st_headless_requests (
 id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, key_hash TEXT NOT NULL,
 customer_id TEXT NOT NULL, operation TEXT NOT NULL, request_digest TEXT NOT NULL,
 commerce_key TEXT NOT NULL, checkout_hash TEXT UNIQUE, cart_id TEXT NOT NULL, order_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(app_id,key_hash)
);
CREATE TABLE st_headless_orders (order_id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL, app_id TEXT NOT NULL);
CREATE INDEX st_headless_orders_customer ON st_headless_orders(customer_id,app_id);
CREATE TABLE st_headless_subscriptions (
 id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, endpoint TEXT NOT NULL,
 kinds_json TEXT NOT NULL CHECK(json_valid(kinds_json)), secret_cipher TEXT NOT NULL,
 issuer_id TEXT NOT NULL, issuer_version INTEGER NOT NULL, consent_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE TABLE st_headless_events (
 id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL,
 occurred_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE TABLE st_headless_deliveries (
 id TEXT PRIMARY KEY NOT NULL, subscription_id TEXT NOT NULL, event_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','delivered','rejected','uncertain')),
 created_at TEXT NOT NULL, attempted_at TEXT, finished_at TEXT, http_status INTEGER,
 replay_of TEXT
);
CREATE INDEX st_headless_deliveries_history ON st_headless_deliveries(subscription_id,created_at);
CREATE TABLE st_headless_limits (bucket TEXT PRIMARY KEY NOT NULL, window_at INTEGER NOT NULL, count INTEGER NOT NULL);
-- Existing commerce mutations are the source. No simulated stock, promotion or
-- return events are emitted while those producers do not exist.
CREATE TRIGGER st_headless_order_insert AFTER INSERT ON st_orders BEGIN
 INSERT INTO st_headless_orders(order_id,customer_id,app_id) SELECT NEW.id,customer_id,app_id FROM st_headless_requests WHERE operation='checkout' AND checkout_hash=json_extract(NEW.value_json,'$.checkoutKey');
 UPDATE st_headless_requests SET order_id=NEW.id WHERE operation='checkout' AND checkout_hash=json_extract(NEW.value_json,'$.checkoutKey');
 INSERT INTO st_headless_events SELECT 'order.'||NEW.id||'.'||NEW.revision,'order',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('id','order.'||NEW.id||'.'||NEW.revision,'kind','order','resourceId',NEW.id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER st_headless_order_update AFTER UPDATE ON st_orders WHEN NEW.revision<>OLD.revision BEGIN
 INSERT INTO st_headless_events SELECT 'order.'||NEW.id||'.'||NEW.revision,'order',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('id','order.'||NEW.id||'.'||NEW.revision,'kind','order','resourceId',NEW.id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER st_headless_customer_insert AFTER INSERT ON st_headless_customers BEGIN
 INSERT INTO st_headless_events SELECT 'customer.'||NEW.id,'customer',NEW.id,NEW.created_at,
 json_object('id','customer.'||NEW.id,'kind','customer','resourceId',NEW.id,'occurredAt',NEW.created_at);
END;
CREATE TRIGGER st_headless_event_queue AFTER INSERT ON st_headless_events BEGIN
 INSERT INTO st_headless_deliveries(id,subscription_id,event_id,status,created_at)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,'pending',NEW.occurred_at
 FROM st_headless_subscriptions s JOIN st_headless_apps a ON a.id=s.app_id
 JOIN oa_operators o ON o.id=s.issuer_id
 WHERE s.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
 AND o.status='active' AND o.role='owner' AND o.version=s.issuer_version
 AND a.issuer_id=o.id AND a.issuer_version=o.version
 AND EXISTS(SELECT 1 FROM json_each(s.kinds_json) WHERE value=NEW.kind);
END;
-- Customer erasure removes the entire private headless custody graph. Minimal
-- historical notices retain opaque references only, never contact values.
CREATE TRIGGER st_headless_customer_delete BEFORE DELETE ON st_headless_customers BEGIN
 DELETE FROM st_headless_carts WHERE customer_id=OLD.id;
 DELETE FROM st_headless_requests WHERE customer_id=OLD.id;
 DELETE FROM st_headless_orders WHERE customer_id=OLD.id;
END;
CREATE TRIGGER st_headless_operator_delete BEFORE DELETE ON oa_operators BEGIN
 DELETE FROM st_headless_customers WHERE operator_id=OLD.id;
END;
CREATE TABLE st_headless_stock (sku TEXT PRIMARY KEY NOT NULL,resource_id TEXT NOT NULL,available TEXT NOT NULL,revision TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE TRIGGER st_headless_stock_insert AFTER INSERT ON st_headless_stock BEGIN
 INSERT INTO st_headless_events VALUES('stock.'||NEW.resource_id||'.'||NEW.revision,'stock',NEW.resource_id,NEW.observed_at,json_object('id','stock.'||NEW.resource_id||'.'||NEW.revision,'kind','stock','resourceId',NEW.resource_id,'occurredAt',NEW.observed_at));
END;
CREATE TRIGGER st_headless_stock_update AFTER UPDATE ON st_headless_stock WHEN NEW.available<>OLD.available BEGIN
 INSERT INTO st_headless_events VALUES('stock.'||NEW.resource_id||'.'||NEW.revision,'stock',NEW.resource_id,NEW.observed_at,json_object('id','stock.'||NEW.resource_id||'.'||NEW.revision,'kind','stock','resourceId',NEW.resource_id,'occurredAt',NEW.observed_at));
END;
