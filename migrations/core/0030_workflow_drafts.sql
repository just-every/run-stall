-- A commercial receipt, not executable authority. It travels with the order
-- history; local workflow activation and staff grants never do.
CREATE TABLE st_workflow_drafts (
 task_id TEXT PRIMARY KEY NOT NULL, rule_id TEXT NOT NULL, order_id TEXT NOT NULL,
 source_revision TEXT NOT NULL, reference TEXT NOT NULL, shipment_id TEXT NOT NULL,
 draft_revision TEXT NOT NULL, prepared_at TEXT NOT NULL,
 UNIQUE(rule_id,order_id)
);
