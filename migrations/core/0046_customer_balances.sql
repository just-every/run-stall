-- Mailbox custody is independent of directory records and native operator IDs.
CREATE TABLE st_customer_balance_accounts (
 id TEXT PRIMARY KEY NOT NULL,
 email TEXT UNIQUE,
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL,
 erased_at TEXT,
 CHECK ((email IS NOT NULL AND erased_at IS NULL) OR (email IS NULL AND erased_at IS NOT NULL))
);
CREATE TABLE st_customer_balance_ledger (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES st_customer_balance_accounts(id),
 command_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('gift','credit')),
 action TEXT NOT NULL CHECK(action IN ('issue','adjust')),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND ((action='issue' AND amount_cents>0) OR (action='adjust' AND amount_cents<0))),
 currency TEXT NOT NULL CHECK(currency='usd'),
 previous_revision TEXT NOT NULL,
 revision TEXT NOT NULL UNIQUE,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX st_customer_balance_ledger_account ON st_customer_balance_ledger(account_id,created_at,id);
-- Erasable annotations stay outside the immutable financial journal.
CREATE TABLE st_customer_balance_details (
 entry_id TEXT PRIMARY KEY NOT NULL REFERENCES st_customer_balance_ledger(id),
 request_hash TEXT NOT NULL,
 reason TEXT NOT NULL
);
CREATE TRIGGER st_customer_balance_ledger_no_update BEFORE UPDATE ON st_customer_balance_ledger
BEGIN SELECT RAISE(ABORT,'Balance financial entries are append-only'); END;
CREATE TRIGGER st_customer_balance_ledger_no_delete BEFORE DELETE ON st_customer_balance_ledger
BEGIN SELECT RAISE(ABORT,'Balance financial entries are append-only'); END;
