CREATE TABLE st_guest_order_links(order_id TEXT PRIMARY KEY NOT NULL REFERENCES st_orders(id) ON DELETE CASCADE,digest TEXT NOT NULL UNIQUE,email TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TRIGGER st_guest_order_links_custody AFTER UPDATE OF value_json ON st_orders
WHEN json_extract(NEW.value_json,'$.erasedAt') IS NOT NULL OR lower(json_extract(NEW.value_json,'$.customerEmail')) IS NOT lower(json_extract(OLD.value_json,'$.customerEmail'))
BEGIN
 DELETE FROM st_guest_order_links WHERE order_id=NEW.id;
END;
