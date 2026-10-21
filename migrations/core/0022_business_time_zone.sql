-- A presentation preference; original commerce timestamps remain UTC.
CREATE TABLE st_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1),
 time_zone TEXT NOT NULL
);
