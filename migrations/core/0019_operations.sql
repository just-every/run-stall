-- Last observations only. No seeded row: fresh restore destinations stay empty.
CREATE TABLE st_operations(key TEXT PRIMARY KEY NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
