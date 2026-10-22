import type { Bindings } from '../../auth.server'
import { live } from '../access'
import type { Actor } from '../model'
import { businessTimeZone } from '../preferences'
import { isManager,reader,rules } from './rules'
import { sourceSupport } from './sources'
export const taskColumns=`t.id,t.rule_id AS ruleId,t.rule_revision AS ruleRevision,t.event_key AS eventKey,t.source_kind AS sourceKind,t.source_id AS sourceId,t.action,t.status,t.assignee_id AS assigneeId,t.due_at AS dueAt,t.dispatch_at AS dispatchAt,t.created_at AS createdAt,t.dispatched_at AS dispatchedAt,t.completed_at AS completedAt,t.completed_by AS completedBy,t.error_code AS errorCode`
export async function workflowSnapshot(env:Bindings,actor:Actor) {
 reader(actor)
 const all=isManager(actor),where=all?'1=1':'t.assignee_id=?',params=all?[]:[actor.id]
 const [list,tasks,counts,notifications,staff,requests,timeZone]=await Promise.all([
  all?rules(env):Promise.resolve([]),
  env.DB.prepare(`SELECT ${taskColumns} FROM st_workflow_tasks t WHERE ${where} ORDER BY t.created_at DESC,t.id LIMIT 100`).bind(...params).all<any>(),
  env.DB.prepare(`SELECT t.status,count(*) AS count FROM st_workflow_tasks t WHERE ${where} GROUP BY t.status`).bind(...params).all<{status:string;count:number}>(),
  env.DB.prepare(`SELECT id,task_id AS taskId,recipient_id AS recipientId,created_at AS createdAt,read_at AS readAt,read_by AS readBy FROM st_workflow_notifications WHERE ${all?'1=1':'recipient_id=?'} ORDER BY created_at DESC,id LIMIT 100`).bind(...params).all(),
  all?env.DB.prepare(`SELECT o.id,o.email,o.display_name AS name,o.role FROM oa_operators o WHERE o.status='active' AND (o.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id)) ORDER BY o.display_name,o.id`).all():Promise.resolve({results:[]}),
  all?env.DB.prepare(`SELECT id,order_id AS orderId,kind,created_at AS createdAt FROM st_workflow_requests ORDER BY created_at DESC,id LIMIT 100`).all():Promise.resolve({results:[]}),
  businessTimeZone(env.DB),
 ])
 await live(env,actor)
 const total=counts.results.reduce((n,r)=>n+r.count,0)
 return {rules:list.map(r=>({...r,source:sourceSupport(r.value.trigger)})),tasks:tasks.results.map(t=>({...t,humanApprovalRequired:t.action!=='task'})),notifications:notifications.results,staff:staff.results,requests:requests.results,timeZone,canManage:all,counts:counts.results,total,limit:100,truncated:total>100,limits:{dispatchPerRun:100,rules:100},unsupported:['Promotion source events','Confirmed-return stock work','Sales accounting integrations','Automatic outbound or commercial actions']}
}
