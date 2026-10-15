CREATE TABLE st_products (id TEXT PRIMARY KEY NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),revision TEXT NOT NULL);
CREATE TABLE st_orders (id TEXT PRIMARY KEY NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),revision TEXT NOT NULL);
CREATE UNIQUE INDEX st_orders_checkout_key ON st_orders(json_extract(value_json,'$.checkoutKey'));
CREATE UNIQUE INDEX st_orders_session ON st_orders(json_extract(value_json,'$.payment.sessionId')) WHERE json_extract(value_json,'$.payment.sessionId') IS NOT NULL;
CREATE UNIQUE INDEX st_orders_intent ON st_orders(json_extract(value_json,'$.payment.intentId')) WHERE json_extract(value_json,'$.payment.intentId') IS NOT NULL;
CREATE TABLE st_audit(id TEXT PRIMARY KEY NOT NULL,subject TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE st_agent_tokens(id TEXT PRIMARY KEY NOT NULL,digest TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,actor_version INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE st_guard(value INTEGER NOT NULL CHECK(value=1));
CREATE TABLE st_events(id TEXT PRIMARY KEY NOT NULL,digest TEXT NOT NULL,order_id TEXT NOT NULL,completed_at TEXT);
