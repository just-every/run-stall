-- Shop discovery: merchant-curated collections, menus, search synonyms and pins,
-- and an aggregate of what shoppers searched for (query text only, no person).
CREATE TABLE st_collections (id TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)), revision TEXT NOT NULL);
CREATE TABLE st_search_config (id TEXT PRIMARY KEY NOT NULL CHECK(id IN ('menus','synonyms','pins')), value_json TEXT NOT NULL CHECK(json_valid(value_json)), revision TEXT NOT NULL);
CREATE TABLE st_search_terms (query TEXT PRIMARY KEY NOT NULL, searches INTEGER NOT NULL, empty INTEGER NOT NULL, last_at TEXT NOT NULL);
