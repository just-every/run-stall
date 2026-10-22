/** Execute before headless identity deletion and the order contact scrub, in
 * the same transaction. Opaque history may remain; customer follow-up stops. */
export function workflowErasureStatements(db:D1Database,email:string):D1PreparedStatement[] {
 const affected=`(source_kind IN ('order','return','cancellation') AND source_id IN (SELECT id FROM st_orders WHERE lower(json_extract(value_json,'$.customerEmail'))=?)) OR (source_kind='return_receipt' AND source_id IN (SELECT r.id FROM st_return_receipts r JOIN st_orders o ON o.id=r.order_id WHERE lower(json_extract(o.value_json,'$.customerEmail'))=?)) OR (source_kind='customer' AND source_id IN (SELECT c.id FROM st_headless_customers c LEFT JOIN oa_operators o ON o.id=c.operator_id WHERE lower(c.email)=? OR lower(o.email)=?))`
 return [
  db.prepare(`DELETE FROM st_workflow_notifications WHERE task_id IN (SELECT id FROM st_workflow_tasks WHERE ${affected})`).bind(email,email,email,email),
  db.prepare(`UPDATE st_workflow_tasks SET status='paused',error_code='CUSTOMER_ERASED' WHERE status<>'completed' AND (${affected})`).bind(email,email,email,email),
  db.prepare(`DELETE FROM st_workflow_requests WHERE order_id IN (SELECT id FROM st_orders WHERE lower(json_extract(value_json,'$.customerEmail'))=?)`).bind(email),
 ]
}
/** Guard current source custody at task creation and dispatch, so an in-flight
 * scan cannot recreate erased customer follow-up after the scrub commits. */
export function currentSource(kind:string,id:string) {
 if(kind==='promotion') return {sql:'EXISTS(SELECT 1 FROM st_promotions WHERE id=?)',params:[id]}
 if(kind==='return_receipt') return {sql:`EXISTS(SELECT 1 FROM st_return_receipts r JOIN st_orders o ON o.id=r.order_id WHERE r.id=? AND json_extract(o.value_json,'$.erasedAt') IS NULL)`,params:[id]}
 if(kind==='order') return {sql:`EXISTS(SELECT 1 FROM st_orders WHERE id=? AND json_extract(value_json,'$.erasedAt') IS NULL)`,params:[id]}
 if(kind==='return'||kind==='cancellation') return {sql:`EXISTS(SELECT 1 FROM st_workflow_requests r JOIN st_orders o ON o.id=r.order_id WHERE r.order_id=? AND r.kind=? AND json_extract(o.value_json,'$.erasedAt') IS NULL)`,params:[id,kind]}
 if(kind==='customer') return {sql:`EXISTS(SELECT 1 FROM st_headless_customers c JOIN oa_operators o ON o.id=c.operator_id WHERE c.id=? AND o.status='active')`,params:[id]}
 return {sql:'1=1',params:[]}
}
