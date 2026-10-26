-- Historical facts have no live payment, stock, fulfilment or session authority.
CREATE TABLE st_customer_order_history (
 id TEXT PRIMARY KEY NOT NULL,
 source_key TEXT NOT NULL UNIQUE,
 email TEXT,
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE INDEX st_customer_order_history_email ON st_customer_order_history(email);

-- Every mutation, including erasure and restoration, invalidates old previews.
CREATE TABLE st_customer_order_history_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL
);
INSERT INTO st_customer_order_history_state VALUES(1,0);
CREATE TRIGGER st_customer_order_history_insert AFTER INSERT ON st_customer_order_history BEGIN
 UPDATE st_customer_order_history_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER st_customer_order_history_update AFTER UPDATE ON st_customer_order_history BEGIN
 UPDATE st_customer_order_history_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER st_customer_order_history_delete AFTER DELETE ON st_customer_order_history BEGIN
 UPDATE st_customer_order_history_state SET revision=revision+1 WHERE id=1;
END;
