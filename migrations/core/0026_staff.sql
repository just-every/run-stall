CREATE TABLE st_staff (
 actor_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 staff_role TEXT NOT NULL CHECK(staff_role IN ('catalog','fulfillment','customer_support','marketing','finance','administrator')),
 refund_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK(refund_limit_cents>=0),
 separate_approval INTEGER NOT NULL DEFAULT 1 CHECK(separate_approval IN (0,1)),
 revision TEXT NOT NULL
);
