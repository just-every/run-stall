import type { Bindings } from '../../auth.server'
import { audit,commit,live } from '../access'
import { shipmentCommand } from '../fulfilment'
import { fail,Problem,text,type Actor } from '../model'
import { authorize } from '../permissions'
import { assertRiskClear,riskBlock } from '../risk'
import { readOrder } from '../store'
import { activeStaff,authoritySql,isManager,reader,rule } from './rules'

type Receipt={taskId:string;ruleId:string;orderId:string;sourceRevision:string;reference:string;shipmentId:string;draftRevision:string;preparedAt:string}
export const receiptColumns='task_id AS taskId,rule_id AS ruleId,order_id AS orderId,source_revision AS sourceRevision,reference,shipment_id AS shipmentId,draft_revision AS draftRevision,prepared_at AS preparedAt'
const receipt=(env:Bindings,id:string)=>env.DB.prepare(`SELECT ${receiptColumns} FROM st_workflow_drafts WHERE task_id=?`).bind(id).first<Receipt>()

/** Reused at the actual order write and at receipt observation, never just at
 * route admission. The existing native-session transaction guard is additional. */
function taskFence(env:Bindings,a:Actor,id:string,orderId:string) {
 return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(
  SELECT 1 FROM st_workflow_tasks t JOIN st_workflow_rules r ON r.id=t.rule_id
  WHERE t.id=? AND t.source_id=? AND t.source_kind='order' AND t.action='draft_followup'
  AND t.status='open' AND t.rule_revision=r.revision AND r.state='active'
  AND json_extract(r.value_json,'$.action')='draft_followup'
  AND json_extract(r.value_json,'$.assigneeId')=t.assignee_id
  AND (t.assignee_id=? OR ?=1) AND ${authoritySql()}
  AND EXISTS(SELECT 1 FROM oa_operators s WHERE s.id=t.assignee_id AND s.status='active'
   AND (s.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM st_staff g WHERE g.actor_id=s.id)))
 ) AND EXISTS(SELECT 1 FROM oa_operators o LEFT JOIN st_staff g ON g.actor_id=o.id
  WHERE o.id=? AND o.status='active' AND (o.role IN ('owner','admin') OR
  (g.staff_role IN ('fulfillment','administrator') AND g.revision=?)))
 THEN 1 ELSE 0 END`).bind(id,orderId,a.id,isManager(a)?1:0,a.id,a.scopeRevision??'')
}
function orderFence(env:Bindings,id:string) {
 return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_orders o WHERE o.id=? AND json_extract(o.value_json,'$.erasedAt') IS NULL AND NOT ${riskBlock('o.id')}) THEN 1 ELSE 0 END`).bind(id)
}
export async function prepareTaskShipment(env:Bindings,actor:Actor,p:any) {
 reader(actor);authorize(actor,'fulfillment');await live(env,actor)
 const id=text(p.id,'Task ID',100),revision=text(p.revision,'Order revision',100),reference=text(p.reference,'Shipment reference')
 const task=await env.DB.prepare('SELECT * FROM st_workflow_tasks WHERE id=?').bind(id).first<any>()
 if(!task||(!isManager(actor)&&task.assignee_id!==actor.id)) fail('NOT_FOUND','Assigned task not found.',404)
 try {
  if(task.status!=='open') fail('TASK_CLOSED','Only an open assigned task can prepare a shipment draft.')
  if(task.action!=='draft_followup'||task.source_kind!=='order') fail('TASK_ACTION','This task does not prepare an order shipment.')
  await activeStaff(env,task.assignee_id)
  const currentRule=await rule(env,task.rule_id)
  if(currentRule.state!=='active'||currentRule.revision!==task.rule_revision||!currentRule.localAuthority) fail('RULE_INACTIVE','The rule changed, is paused or needs local activation. Review the current rule first.')
  const current=await readOrder(env.DB,task.source_id)
  if(current.erasedAt||task.error_code==='CUSTOMER_ERASED') fail('SOURCE_UNAVAILABLE','Customer erasure stopped this follow-up.')
  await assertRiskClear(env,current.id)
  const observe=async(found:Receipt)=>{
   if(found.sourceRevision!==revision||found.reference!==reference) fail('IDEMPOTENCY','This task already prepared a draft from another reviewed revision or reference.')
   const order=await readOrder(env.DB,found.orderId)
   if(order.shipment?.id!==found.shipmentId) fail('DRAFT_CHANGED','The prepared shipment has changed. Review it in the order desk.')
   await commit(env.DB,actor,[taskFence(env,actor,id,found.orderId),orderFence(env,found.orderId)])
   return {...found,status:'draft_prepared' as const,currentShipmentStatus:order.shipment.status}
  }
  const existing=await receipt(env,id)
  if(existing) return await observe(existing)
  if(await env.DB.prepare('SELECT task_id FROM st_workflow_drafts WHERE rule_id=? AND order_id=?').bind(task.rule_id,current.id).first()) fail('PREPARATION_EXISTS','This rule already prepared a shipment for this order. Review the original draft.')
  if(current.revision!==revision) fail('CHANGED','The order changed. Refresh the task, review the current order, and prepare again.')
  if(current.shipment) fail('DRAFT_EXISTS','This order already has a shipment. Review its existing draft or dispatch in the order desk.')
  try {
   await shipmentCommand(env,actor,'shipment.prepare',{orderId:current.id,revision,reference},{
    before:[taskFence(env,actor,id,current.id),orderFence(env,current.id)],
    after:next=>[
     env.DB.prepare('INSERT INTO st_workflow_drafts(task_id,rule_id,order_id,source_revision,reference,shipment_id,draft_revision,prepared_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,task.rule_id,current.id,revision,reference,next.shipment!.id,next.revision,new Date().toISOString()),
     env.DB.prepare("UPDATE st_workflow_tasks SET error_code=NULL WHERE id=? AND status='open'").bind(id),
     audit(env.DB,actor,id,'workflow.shipment.prepared'),
    ],
   })
  } catch(error) {
   // A concurrent identical request may have committed the one original draft.
   // Observe its receipt; never repeat an unbound order write or invent success.
   const raced=await receipt(env,id)
   if(raced) return await observe(raced)
   throw error
  }
  const saved=await receipt(env,id)
  if(!saved) fail('CHANGED','Draft preparation did not commit. Refresh the current task.')
  return await observe(saved)
 } catch(error) {
  const code=error instanceof Problem?error.code:'CHANGED'
  await env.DB.prepare("UPDATE st_workflow_tasks SET error_code=? WHERE id=? AND status='open' AND COALESCE(error_code,'')<>'CUSTOMER_ERASED'").bind(/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'CHANGED',id).run()
  if(error instanceof Problem) throw error
  return fail('CHANGED','The order or workflow authority changed during preparation. Refresh and review the current task.')
 }
}
