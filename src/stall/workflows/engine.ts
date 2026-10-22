import type { Bindings } from '../../auth.server'
import { systemAudit } from '../access'
import { withConnections } from '../connections'
import { Problem } from '../model'
import { businessTimeZone } from '../preferences'
import { activeStaff,activeStaffSql,authoritySql,rules,type Rule } from './rules'
import { matches } from './sources'
import { quietRelease } from './time'
import { currentSource } from './erasure'
const safeCode=(e:unknown)=>e instanceof Problem&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code)?e.code:'WORKFLOW_UNAVAILABLE'
async function evaluate(env:Bindings,r:Rule,zone:string,at:number) {
 const found=await matches(env,r.value,zone,at,true)
 await activeStaff(env,r.value.assigneeId)
 const stamp=new Date(at).toISOString(),due=new Date(at+r.value.dueMinutes*60000).toISOString(),dispatch=new Date(quietRelease(at,zone,r.value.quietHours)).toISOString()
 // Each insert is also guarded against a concurrent pause/edit. The unique
 // identity spans rule revisions: editing/replaying cannot duplicate an event.
 for(let start=0;start<found.length;start+=50) await env.DB.batch(found.slice(start,start+50).map(m=>{
  const source=currentSource(m.sourceKind,m.sourceId)
  return env.DB.prepare(`INSERT OR IGNORE INTO st_workflow_tasks(id,rule_id,rule_revision,event_key,source_kind,source_id,action,status,assignee_id,due_at,dispatch_at,notify,created_at) SELECT ?,?,?,?,?,?,?,'pending',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM st_workflow_rules r WHERE r.id=? AND r.revision=? AND r.state='active' AND ${authoritySql()}) AND EXISTS(${activeStaffSql}) AND (${source.sql})`).bind(crypto.randomUUID(),r.id,r.revision,m.eventKey,m.sourceKind,m.sourceId,r.value.action,r.value.assigneeId,due,dispatch,r.value.notifyStaff?1:0,stamp,r.id,r.revision,r.value.assigneeId,...source.params)
 }))
 await env.DB.prepare('UPDATE st_workflow_rules SET checked_at=?,error_code=NULL WHERE id=? AND revision=? AND state=\'active\'').bind(stamp,r.id,r.revision).run()
 return found.length
}
async function dispatchPending(env:Bindings,zone:string,at:number) {
 const stamp=new Date(at).toISOString(),pending=await env.DB.prepare(`SELECT t.*,r.value_json,r.revision AS current_revision,r.state AS rule_state,${authoritySql()} AS local_authority FROM st_workflow_tasks t JOIN st_workflow_rules r ON r.id=t.rule_id WHERE t.status='pending' ORDER BY t.dispatch_at,t.id LIMIT 100`).all<any>()
 let dispatched=0,failed=0
 for(const task of pending.results) {
  if(task.rule_state!=='active'||task.rule_revision!==task.current_revision||!task.local_authority) {
   await env.DB.prepare("UPDATE st_workflow_tasks SET status='paused',error_code='RULE_PAUSED' WHERE id=? AND status='pending'").bind(task.id).run();continue
  }
  try { await activeStaff(env,task.assignee_id) } catch {
   await env.DB.prepare("UPDATE st_workflow_tasks SET status='failed',error_code='ASSIGNEE' WHERE id=? AND status='pending'").bind(task.id).run();failed++;continue
  }
  const release=quietRelease(at,zone,JSON.parse(task.value_json).quietHours)
  if(release>at) {await env.DB.prepare("UPDATE st_workflow_tasks SET dispatch_at=? WHERE id=? AND status='pending'").bind(new Date(release).toISOString(),task.id).run();continue}
  // The notification and transition share one transaction. Pause and staff
  // revocation are tested again in SQL at the point of dispatch.
  const source=currentSource(task.source_kind,task.source_id)
  const result=await env.DB.batch([
   env.DB.prepare(`UPDATE st_workflow_tasks SET status='open',dispatched_at=?,error_code=NULL WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM st_workflow_rules r WHERE r.id=rule_id AND r.revision=rule_revision AND r.state='active' AND ${authoritySql()}) AND EXISTS(${activeStaffSql}) AND (${source.sql})`).bind(stamp,task.id,task.assignee_id,...source.params),
   env.DB.prepare(`INSERT OR IGNORE INTO st_workflow_notifications(id,task_id,recipient_id,created_at) SELECT ?,id,assignee_id,? FROM st_workflow_tasks WHERE id=? AND status='open' AND notify=1`).bind(crypto.randomUUID(),stamp,task.id),
  ])
  dispatched+=result[0].meta.changes
 }
 return {dispatched,failed}
}
/** Cron and a human's Run now use exactly the same read-only source scan and
 * internal work dispatch. No workflow task is an input to another workflow. */
export async function runWorkflows(original:Bindings) {
 const env=await withConnections(original),zone=await businessTimeZone(env.DB),at=Date.now()
 let evaluated=0,matched=0,failed=0
 for(const r of await rules(env)) if(r.state==='active') {
  evaluated++
  if(!r.localAuthority) {
   await env.DB.batch([env.DB.prepare("UPDATE st_workflow_rules SET checked_at=?,error_code='LOCAL_AUTHORITY_REQUIRED' WHERE id=? AND revision=?").bind(new Date(at).toISOString(),r.id,r.revision),env.DB.prepare("UPDATE st_workflow_tasks SET status='paused',error_code='AUTHORITY_INACTIVE' WHERE rule_id=? AND status='pending'").bind(r.id)])
   failed++;continue
  }
  try {matched+=await evaluate(env,r,zone,at)} catch(e) {
   failed++
   await env.DB.batch([env.DB.prepare('UPDATE st_workflow_rules SET checked_at=?,error_code=? WHERE id=? AND revision=?').bind(new Date(at).toISOString(),safeCode(e),r.id,r.revision),systemAudit(env.DB,r.id,'workflow.evaluation.failed','workflow')])
  }
 }
 const dispatch=await dispatchPending(env,zone,at)
 return {evaluated,matched,failed:failed+dispatch.failed,dispatched:dispatch.dispatched,checkedAt:new Date(at).toISOString(),timeZone:zone}
}
