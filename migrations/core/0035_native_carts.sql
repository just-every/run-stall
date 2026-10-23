CREATE TABLE st_shop_carts(id TEXT PRIMARY KEY NOT NULL,owner_email TEXT,guest_hash TEXT,revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),updated_at TEXT NOT NULL,review_digest TEXT,checkout_key TEXT,checkout_intent TEXT,order_id TEXT,CHECK((owner_email IS NULL)!=(guest_hash IS NULL)));
CREATE INDEX st_shop_carts_owner ON st_shop_carts(owner_email,updated_at);
CREATE INDEX st_shop_carts_guest ON st_shop_carts(guest_hash,updated_at);
CREATE TABLE st_checkout_fields(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
