CREATE TABLE st_analytics_cost_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), by_actor TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE st_analytics_costs (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), by_actor TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX st_analytics_cost_order ON st_analytics_costs(order_id,at);
CREATE TABLE st_analytics_history_previews (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, digest TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 by_actor TEXT NOT NULL, created_at TEXT NOT NULL, applied_at TEXT
);
CREATE TABLE st_analytics_history (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 preview_id TEXT NOT NULL, imported_at TEXT NOT NULL, by_actor TEXT NOT NULL, UNIQUE(source,source_id)
);
CREATE TRIGGER st_analytics_history_update BEFORE UPDATE ON st_analytics_history BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER st_analytics_history_insert BEFORE INSERT ON st_analytics_history
 WHEN EXISTS(SELECT 1 FROM st_analytics_history WHERE source=NEW.source AND source_id=NEW.source_id AND value_json<>NEW.value_json)
 BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER st_analytics_history_delete BEFORE DELETE ON st_analytics_history BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
