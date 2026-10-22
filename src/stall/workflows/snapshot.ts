import type { Bindings } from '../../auth.server'
import { live } from '../access'
import type { Actor } from '../model'
import { businessTimeZone } from '../preferences'
import { permits } from '../permissions'
import { riskBlock } from '../risk'
import { authoritySql,isManager,reader,rules } from './rules'
import { sourceSupport } from './sources'
import { receiptColumns } from './shipment'
export const taskColumns=`t.id,t.rule_id AS ruleId,t.rule_revision AS ruleRevision,t.event_key AS eventKey,t.source_kind AS sourceKind,t.source_id AS sourceId,t.action,t.status,t.assignee_id AS assigneeId,t.due_at AS dueAt,t.dispatch_at AS dispatchAt,t.created_at AS createdAt,t.dispatched_at AS dispatchedAt,t.completed_at AS completedAt,t.completed_by AS completedBy,t.error_code AS errorCode`
export async function workflowSnapshot(env:Bindings,actor:Actor) {
 reader(actor)
 const all=isManager(actor),where=all?'1=1':'t.assignee_id=?',params=all?[]:[actor.id]
 const [list,tasks,counts,notifications,staff,requests,timeZone,drafts]=await Promise.all([
  all?rules(env):Promise.resolve([]),
  env.DB.prepare(`SELECT ${taskColumns},o.revision AS orderRevision,json_extract(o.value_json,'$.status') AS orderStatus,json_extract(o.value_json,'$.shipment.status') AS shipmentStatus,json_extract(o.value_json,'$.totalCents') AS totalCents,
   (SELECT json_group_array(json_object('sku',json_extract(l.value,'$.sku'),'name',json_extract(l.value,'$.name'),'quantity',json_extract(l.value,'$.quantity'))) FROM json_each(o.value_json,'$.lines') l) AS orderLines,
   ${riskBlock('o.id')} AS riskBlocked,
   EXISTS(SELECT 1 FROM st_workflow_rules r WHERE r.id=t.rule_id AND r.revision=t.rule_revision AND r.state='active' AND ${authoritySql()}) AS ruleAvailable,
   EXISTS(SELECT 1 FROM oa_operators s WHERE s.id=t.assignee_id AND s.status='active' AND (s.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM st_staff g WHERE g.actor_id=s.id))) AS assigneeAvailable
   FROM st_workflow_tasks t LEFT JOIN st_orders o ON t.source_kind='order' AND t.action='draft_followup' AND o.id=t.source_id AND json_extract(o.value_json,'$.erasedAt') IS NULL WHERE ${where} ORDER BY t.created_at DESC,t.id LIMIT 100`).bind(...params).all<any>(),
  env.DB.prepare(`SELECT t.status,count(*) AS count FROM st_workflow_tasks t WHERE ${where} GROUP BY t.status`).bind(...params).all<{status:string;count:number}>(),
  env.DB.prepare(`SELECT id,task_id AS taskId,recipient_id AS recipientId,created_at AS createdAt,read_at AS readAt,read_by AS readBy FROM st_workflow_notifications WHERE ${all?'1=1':'recipient_id=?'} ORDER BY created_at DESC,id LIMIT 100`).bind(...params).all(),
  all?env.DB.prepare(`SELECT o.id,o.email,o.display_name AS name,o.role FROM oa_operators o WHERE o.status='active' AND (o.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id)) ORDER BY o.display_name,o.id`).all():env.DB.prepare('SELECT id,email,display_name AS name,role FROM oa_operators WHERE id=?').bind(actor.id).all(),
  all?env.DB.prepare(`SELECT id,order_id AS orderId,kind,created_at AS createdAt FROM st_workflow_requests ORDER BY created_at DESC,id LIMIT 100`).all():Promise.resolve({results:[]}),
  businessTimeZone(env.DB),
  env.DB.prepare(`SELECT ${receiptColumns} FROM st_workflow_drafts WHERE task_id IN (SELECT t.id FROM st_workflow_tasks t WHERE ${where})`).bind(...params).all<any>(),
 ])
 await live(env,actor)
 const total=counts.results.reduce((n,r)=>n+r.count,0)
 return {rules:list.map(r=>({...r,source:sourceSupport(r.value.trigger)})),tasks:tasks.results.map(({orderRevision,orderStatus,shipmentStatus,totalCents,orderLines,riskBlocked,ruleAvailable,assigneeAvailable,...t})=>{
  const draft=drafts.results.find(d=>d.taskId===t.id)??null
  const canReview=permits(actor,'fulfillment')&&t.action==='draft_followup'&&t.sourceKind==='order'
  const reason=t.status!=='open'?'The task must be open.':!ruleAvailable?'The rule is paused, changed or needs local activation.':!assigneeAvailable?'The responsible staff member needs active access.':!orderRevision?'The current order is unavailable.':riskBlocked?'Fulfillment needs an authorized risk review.':shipmentStatus?'Review the existing shipment in the order desk.':orderStatus!=='reserved'?'The order must be paid and fully reserved.':null
  return {...t,humanApprovalRequired:t.action!=='task',shipmentDraft:draft,shipmentPreparation:canReview?{available:!draft&&!reason,reason,orderId:t.sourceId,revision:orderRevision,status:orderStatus,totalCents,lines:JSON.parse(orderLines??'[]')}:null}
 }),notifications:notifications.results,staff:staff.results,requests:requests.results,timeZone,canManage:all,counts:counts.results,total,limit:100,truncated:total>100,limits:{dispatchPerRun:100,rules:100},unsupported:['Automatic return restock','Sales accounting integrations','Automatic outbound or commercial actions']}
}
