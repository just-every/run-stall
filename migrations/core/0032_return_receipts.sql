-- A human's record of goods received. It never changes Pier availability,
-- refunds money or completes the wider return/exchange case.
CREATE TABLE st_return_receipts (
 id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL UNIQUE,
 order_id TEXT NOT NULL, source_revision TEXT NOT NULL,
 lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
 fingerprint TEXT NOT NULL, received_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER st_headless_return_received AFTER INSERT ON st_return_receipts BEGIN
 INSERT INTO st_headless_events VALUES('return.received.'||NEW.id,'return',NEW.id,NEW.created_at,
 json_object('id','return.received.'||NEW.id,'kind','return','resourceId',NEW.id,'occurredAt',NEW.created_at));
END;
