CREATE TABLE st_customer_consents(id TEXT PRIMARY KEY NOT NULL,email TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN('email','sms')),subscribed INTEGER NOT NULL CHECK(subscribed IN(0,1)),source TEXT NOT NULL,policy_version TEXT NOT NULL,proof_json TEXT,created_at TEXT NOT NULL,seq INTEGER NOT NULL UNIQUE);
CREATE INDEX st_customer_consents_history ON st_customer_consents(email,created_at,id);
CREATE TABLE st_customer_suppressions(email_hash TEXT NOT NULL,channel TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(email_hash,channel));
CREATE TABLE st_customer_privacy_config(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE TABLE st_customer_visitor_preferences(id_hash TEXT PRIMARY KEY NOT NULL,policy_version TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),updated_at TEXT NOT NULL);
CREATE TABLE st_customer_privacy_requests(id TEXT PRIMARY KEY NOT NULL,email TEXT,kind TEXT NOT NULL CHECK(kind IN('export','erasure')),status TEXT NOT NULL CHECK(status IN('requested','erased')),value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL,completed_at TEXT);
