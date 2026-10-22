-- Commercial workflow history transfers; the separate activation grants never
-- transfer, so restore cannot reactivate a scheduling policy.
CREATE TABLE st_workflow_rules (
 id TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','active','paused')),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, checked_at TEXT, error_code TEXT
);
CREATE TABLE st_workflow_sources (
 id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL,
 event_key TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE st_workflow_authority (
 rule_id TEXT PRIMARY KEY NOT NULL, rule_revision TEXT NOT NULL,
 custodian_id TEXT NOT NULL, custodian_version INTEGER NOT NULL
);
CREATE TABLE st_workflow_requests (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('return','cancellation')), created_at TEXT NOT NULL,
 UNIQUE(order_id,kind)
);
CREATE TABLE st_workflow_tasks (
 id TEXT PRIMARY KEY NOT NULL, rule_id TEXT NOT NULL, rule_revision TEXT NOT NULL,
 event_key TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('task','draft_followup','reconcile_followup')),
 status TEXT NOT NULL CHECK(status IN ('pending','open','paused','failed','completed')),
 assignee_id TEXT NOT NULL, due_at TEXT NOT NULL, dispatch_at TEXT NOT NULL,
 notify INTEGER NOT NULL CHECK(notify IN (0,1)), created_at TEXT NOT NULL,
 dispatched_at TEXT, completed_at TEXT, completed_by TEXT, error_code TEXT,
 UNIQUE(rule_id,event_key)
);
CREATE INDEX st_workflow_pending ON st_workflow_tasks(status,dispatch_at);
CREATE INDEX st_workflow_assignee ON st_workflow_tasks(assignee_id,status);
CREATE TABLE st_workflow_notifications (
 id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL UNIQUE,
 recipient_id TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, read_by TEXT
);
-- A request is an actual customer action, never a claim that goods were returned.
CREATE TRIGGER st_headless_return_request AFTER INSERT ON st_workflow_requests WHEN NEW.kind='return' BEGIN
 INSERT INTO st_headless_events VALUES('return.requested.'||NEW.id,'return',NEW.id,NEW.created_at,json_object('id','return.requested.'||NEW.id,'kind','return','resourceId',NEW.id,'occurredAt',NEW.created_at));
END;
