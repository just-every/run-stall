-- Product media and shopper personalization uploads. Bytes are base64 text so the
-- portable archive carries them as ordinary rows; uploads attach to one order and
-- leave with that customer's erasure.
CREATE TABLE st_media (
 id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','video')), mime TEXT NOT NULL,
 size INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE st_uploads (
 id TEXT PRIMARY KEY NOT NULL, sku TEXT NOT NULL, field TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
 size INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, order_id TEXT
);
CREATE INDEX st_uploads_order ON st_uploads(order_id);
