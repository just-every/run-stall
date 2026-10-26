-- One owner-managed return policy and the customer return, exchange and
-- cancellation cases. A case is a request and a person decision, never a
-- refund, a cancellation or a goods receipt. Cases travel with the business.
CREATE TABLE st_return_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE st_return_cases (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('cancellation','return','exchange')),
 email TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('account','guest_link')),
 fingerprint TEXT NOT NULL UNIQUE, revision TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('requested','accepted','refused')),
 lines_json TEXT NOT NULL CHECK(json_valid(lines_json)), note TEXT,
 policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_note TEXT,
 reservation_json TEXT CHECK(reservation_json IS NULL OR json_valid(reservation_json))
);
CREATE INDEX st_return_cases_order ON st_return_cases(order_id);
CREATE INDEX st_return_cases_state ON st_return_cases(state,created_at);
CREATE TABLE st_return_events (
 id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL,
 at TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX st_return_events_case ON st_return_events(case_id,at);
-- Photos a customer attaches as evidence. Held privately in this installation,
-- readable only by the customer of that order and an owner or administrator.
CREATE TABLE st_return_files (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, email TEXT NOT NULL, case_id TEXT,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX st_return_files_order ON st_return_files(order_id,case_id);
