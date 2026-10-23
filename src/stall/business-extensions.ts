import { customerBusinessRecords } from './customers'
/** Owner-only commercial exports. Installation authority, endpoint consent,
 * native identity bindings and checkout fingerprints are deliberately omitted. */
export async function businessExtensions(db:D1Database) {
 const [rules,observations,decisions,alerts,customers,carts,events,deliveries,workflowRules,tasks,notifications,requests,drafts,receipts,promotions,allocations]=await Promise.all([
  db.prepare('SELECT value_json FROM st_risk_rules WHERE id=1').first<{value_json:string}>(),
  db.prepare('SELECT value_json FROM st_risk ORDER BY order_id').all<{value_json:string}>(),
  db.prepare('SELECT * FROM st_risk_decisions ORDER BY decided_at,id').all(),
  db.prepare('SELECT * FROM st_risk_notifications ORDER BY created_at,id').all(),
  db.prepare('SELECT id,email,created_at AS createdAt FROM st_headless_customers ORDER BY id').all(),
  db.prepare('SELECT id,customer_id AS customerId,value_json,created_at AS createdAt FROM st_headless_carts ORDER BY id').all<any>(),
  db.prepare('SELECT id,kind,resource_id AS resourceId,occurred_at AS occurredAt FROM st_headless_events ORDER BY occurred_at,id').all(),
  db.prepare('SELECT id,event_id AS eventId,status,created_at AS createdAt,attempted_at AS attemptedAt,finished_at AS finishedAt,http_status AS httpStatus,replay_of AS replayOf FROM st_headless_deliveries ORDER BY created_at,id').all(),
  db.prepare('SELECT id,revision,state,value_json,created_at AS createdAt,updated_at AS updatedAt,checked_at AS checkedAt,error_code AS errorCode FROM st_workflow_rules ORDER BY id').all<any>(),
  db.prepare('SELECT * FROM st_workflow_tasks ORDER BY id').all(),
  db.prepare('SELECT * FROM st_workflow_notifications ORDER BY id').all(),
  db.prepare('SELECT * FROM st_workflow_requests ORDER BY id').all(),
  db.prepare('SELECT * FROM st_workflow_drafts ORDER BY prepared_at,task_id').all(),
  db.prepare('SELECT id,request_id AS requestId,order_id AS orderId,source_revision AS sourceRevision,lines_json,received_by AS receivedBy,created_at AS createdAt FROM st_return_receipts ORDER BY created_at,id').all<any>(),
  db.prepare('SELECT id,revision,starts_at,ends_at,minimum_cents,max_customer_uses,max_total_uses,max_discount_cents,kind,revoked_at,created_at,updated_at FROM st_promotions ORDER BY created_at,id').all(),
  db.prepare('SELECT order_id,promotion_id,promotion_revision,discount_cents,status,reserved_at,used_at FROM st_promotion_allocations ORDER BY reserved_at,order_id').all(),
 ])
 return {
  customerDirectory:await customerBusinessRecords(db),
  risk:{rules:rules?JSON.parse(rules.value_json):null,observations:observations.results.map(r=>JSON.parse(r.value_json)),decisions:decisions.results,notifications:alerts.results},
  headless:{customers:customers.results,carts:carts.results.map(({value_json,...r})=>({...r,lines:JSON.parse(value_json)})),events:events.results,deliveries:deliveries.results},
  workflows:{rules:workflowRules.results.map(({value_json,...r})=>({...r,value:JSON.parse(value_json)})),tasks:tasks.results,notifications:notifications.results,requests:requests.results,drafts:drafts.results},
  returns:{receipts:receipts.results.map(({lines_json,...r})=>({...r,lines:JSON.parse(lines_json)}))},
  promotions:{rules:promotions.results,allocations:allocations.results},
 }
}
