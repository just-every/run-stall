-- A shopper file holds a place in the waiting allowance until a paid order
-- claims it. The keyed client hash bounds each client's share of that allowance;
-- it is local to this installation and never travels in archives.
ALTER TABLE st_uploads ADD COLUMN client TEXT;
-- Allowance counts and lapse cleanup read only these columns, never the file bytes.
CREATE INDEX st_uploads_waiting ON st_uploads(client,order_id,created_at);
