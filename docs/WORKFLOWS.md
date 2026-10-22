# Workflows

Workflows scan current commerce records and create internal work. They never
charge, refund, ship, restock, cancel an order, send customer messages or call an
outbound integration automatically. An order's `draft_followup` task lets an
authorized person review its current lines and exact revision, then explicitly
prepare a shipment draft. Approval and dispatch remain separate. Other draft
and reconciliation follow-ups ask a person to use the reviewed commerce doors.
Completing a task records staff progress
and never claims that its source order or an external effect succeeded.

Owner/admin native sessions manage rules. Granted staff can see and complete
their own dispatched tasks and read their own in-app notifications. An assigned
person must currently be an active owner, administrator or member with a
functional staff grant. Assignment grants no commerce authority. Agents and
ungranted members cannot manage rules or read workflow work. Mutations require
the installation's exact Origin and live native authority, including at commit.

## HTTP and command contract

`GET /api/stall/workflows` returns `rules`, `tasks`, `notifications`, active
`staff`, minimal customer `requests`, canonical `timeZone`, `canManage`, grouped
  task `counts`, `total`, `limit` and `truncated`. Rules expose `localAuthority`;
  an archived active state with no local grant is visibly inactive. Staff receive only their tasks
and notifications. Task lists show the latest 100 and the full task count;
notifications and request lists show the latest 100.

`POST /api/stall/workflows` takes `{type,payload}` and returns `{result}`.
The same commands are exported as `workflowCommand(env,actor,type,payload)`.

* `workflow.save`: `{rule,id?,revision?}`; new rules are drafts. Editing requires
  the current revision, pauses the rule and its pending tasks, and gives it a
  new revision. Rule fields are `name`, `trigger`, `assigneeId`, `dueMinutes`
  (default 1440), `notifyStaff` (default true), `action` (default `task`),
  `conditions` (default `{}`), optional `quietHours:{start,end}` and, for a
  daily scheduled rule, `localTime`. Times are local `HH:mm`; unknown fields or
  conditions are refused rather than ignored. At most 100 rules are retained.
* `workflow.dry-run`: `{id}` or `{rule}`; returns current matching source IDs,
  event identities and explanations, full match count, the first 100 matches,
  responsibility, projected due/dispatch times and explicit action limits.
  It consumes no event and changes no stock or commerce record.
* `workflow.activate` and `workflow.pause`: `{id,revision}`. Activation enables
  the next scan; Run now or cron performs the scan. Pause atomically pauses
  undispatched tasks and prevents new dispatch. Already dispatched work remains
  visible. Reactivation does not silently resume paused tasks.
* `workflow.run`: `{}`; uses the same engine as the actual scheduled Worker.
* `workflow.task.retry`: `{id}`; owner/admin explicitly resumes a paused or
  failed task only while its original rule revision is active and its assignee
  is active. A task from an edited rule cannot resume under a different policy.
* `workflow.task.complete`: `{id}`; assignee or owner/admin completes an open
  task. It does not approve a commercial effect.
* `workflow.task.prepare-shipment`: `{id,revision,reference}`; an authorized
  human assignee or owner/admin prepares a shipment draft for an open order
  follow-up. The current functional fulfillment permission, task, rule revision,
  local activation, assignee, order revision and risk gate are checked again in
  the same transaction as the draft and durable receipt. Replays recover that
  receipt. One preparation per rule/order prevents the draft's new order revision
  from creating a preparation loop. No stock is dispatched and no approval is
  inferred from assignment, task completion or a restored receipt.
* `workflow.notification.read`: `{id}`; recipient or owner/admin records a read.
* `workflow.schedule.preview`: `{date:'YYYY-MM-DD',localTime:'HH:mm'}`; returns
  the resolved UTC instant in the current shop zone without emitting any event.

`POST /api/stall/customer-requests` takes **only**
`{orderId,kind:'return'|'cancellation'}`. It independently verifies the native
session and live operator, then compares the session's verified email to the
current non-erased order's customer email, again in the write transaction.
Bearer credentials, asserted actor/email fields and another customer's order
cannot authorize it. The minimal request contains ID, order ID, kind and time;
one request per order/kind is retained, so repeat submissions do not duplicate
work. An activated request rule turns it into assigned staff work at the next
scan. The owner/admin request list also exposes requests without an active rule.
There is no arbitrary trigger/event emission endpoint.

`GET /api/stall/returns` lists current return requests and received-goods records
for native owners/admins. `POST` with `{requestId,orderRevision,lines:[{sku,quantity}]}`
explicitly records purchased goods received after a completed shipment. Quantities
must be positive, unique purchased lines within their original quantities. One
immutable receipt per request is retained; an identical replay returns it and a
different or stale confirmation is refused. This records the human observation,
not warehouse success, a refund or a completed return/exchange case. The
`return_confirmed` rule creates assigned stock inspection/restock work from it.

## Current sources and conditions

| Trigger | Current source and event identity | Conditions |
| --- | --- | --- |
| `low_stock` | Current published sellable variant availability read from Pier. Persisted observation changes create stable event episodes; unchanged observations replay the same event. A replenishment observed between low-stock episodes allows a later low-stock task. | `sku`, `stockAtMost` (default 5 whole units) |
| `overdue_fulfillment` | Paid order not completely shipped, older than the selected elapsed hours since latest stamped dispatch, or payment time. Stable per order and that anchor time. | `sku`, `status`, `minTotalCents`, `maxTotalCents`, `overdueHours` (default 168) |
| `return_request` / `cancellation_request` | The independently authenticated native customer request, stable per request ID. | None |
| `return_confirmed` | Explicit owner/admin received-goods record, stable per receipt ID; creates stock follow-up without asserting a stock movement. | None |
| `order` | Current order identity/revision; scanned records include existing orders. | `sku`, `status`, `minTotalCents`, `maxTotalCents` |
| `customer` | Existing active native headless customer identities; one event per customer ID. | None |
| `scheduled_reconciliation` | One daily slot per shop calendar date; prepares internal human reconciliation follow-up. | `localTime` on the rule |
| `promotion` | Real promotion change, checkout budget qualification and verified redemption events, stable per event ID. | None |

SKU and status match exactly; price bounds are inclusive USD cents. The low
stock scan is a current observation, not an inventory movement subscription: a
replenishment and subsequent depletion entirely between scans cannot be
distinguished. Order rules see the latest revision, not every intermediate
transition between scans. A customer rule covers the existing headless native
identity producer; it does not infer a customer from unverified checkout text.

## Scheduling, durability and failure visibility

The shop's saved `businessTimeZone` is canonical; its initial default is
America/Chicago. Scheduled local times select the first occurrence at fall-back
and the first instant after a spring-forward gap. A daily slot can run at any
scan after its time on that local date, including activation later that day;
missed prior dates are not backfilled. A slot's identity is its calendar date,
so changing time zone cannot duplicate the same date's work. Quiet hours defer
dispatch and notification, including overnight ranges. Due time is matching
observation time plus `dueMinutes`, measured in elapsed minutes; quiet hours do
not move the agreed due date. Stored timestamps remain UTC.

Tasks are unique by rule ID plus original source event identity across rule
edits and concurrent/repeated cron invocations. Responsibility and due date are
frozen when the task is first created. Creation and dispatch both check current
rule status/revision; notification and dispatch commit together and one task
has at most one notification. Internal workflow records never feed a trigger,
so rule chains cannot loop. Each run dispatches at most 100 pending tasks; later
runs drain the queue. Current rule sources are scanned without a hidden record
limit. Pending, open, paused, failed and completed states remain visible.

Provider-source failures persist a bounded error code and last-check time on
the rule. An inactive/ungranted assignee prevents dispatch and leaves a failed
task for human review. No raw provider error body, credential or copied customer
contact is retained. Explicit retry uses the original task identity. Run results
report evaluated rules, match count, dispatched tasks and failures. A database
failure itself cannot be durably written to the unavailable database.

Rules, sources, customer requests, tasks and notifications are commercial history
and transfer in the archive. Only `st_workflow_authority` is installation-local
and excluded. Activation binds the current rule revision to a live owner/admin
operator ID/version; role, version or active-status changes revoke the grant.
Evaluation and atomic dispatch recheck it. Restore therefore preserves visible
history without dispatching work: a scan labels inactive authority and pauses
pending tasks. A local owner/admin must review responsibility, resave/reassign
where needed and explicitly activate; original paused tasks require explicit
retry under their original live rule revision. Erasure removes the minimal
customer requests and notifications and stops related customer follow-ups;
in-flight scans cannot recreate them after the scrub.

Warehouse stock movement, accounting posting and approved-integration invocation
with budget policy remain unimplemented. Full return/exchange handling and the
wider discount types remain RETURN-001/002 and PROMO-001. FLOW-001 remains
partial pending those obligations and the clause ruling.
