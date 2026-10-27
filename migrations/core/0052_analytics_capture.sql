CREATE TABLE st_analytics_visitors(id_hash TEXT PRIMARY KEY NOT NULL,privacy_hash TEXT NOT NULL,policy_version TEXT NOT NULL,last_at TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE INDEX st_analytics_visitors_privacy ON st_analytics_visitors(privacy_hash);
CREATE TABLE st_analytics_sessions(id TEXT PRIMARY KEY NOT NULL,visitor_hash TEXT NOT NULL,started_at TEXT NOT NULL,last_at TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE INDEX st_analytics_sessions_visitor ON st_analytics_sessions(visitor_hash);
CREATE INDEX st_analytics_sessions_dates ON st_analytics_sessions(started_at,last_at);
CREATE TABLE st_analytics_events(id TEXT PRIMARY KEY NOT NULL,session_id TEXT NOT NULL REFERENCES st_analytics_sessions(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN('visit','product_view','add_to_cart','checkout')),occurred_at TEXT NOT NULL,sku TEXT);
CREATE INDEX st_analytics_events_session ON st_analytics_events(session_id,occurred_at);
