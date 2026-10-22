import type { Bindings } from '../../auth.server'
import { audit,changed,commit,live } from '../access'
import { withConnections } from '../connections'
import { fail,text,type Actor } from '../model'
import { businessTimeZone } from '../preferences'
import { runWorkflows } from './engine'
import { activeStaff,activeStaffSql,authoritySql,isManager,manager,reader,rule,validateRule } from './rules'
import { matches,sourceSupport } from './sources'
import { date,localInstant,minute,quietRelease } from './time'

export async function workflowCommand(original:Bindings,actor:Actor,type:string,p:any={}) {
 const env=await withConnections(original)
 if(!p||typeof p!=='object'||Array.isArray(p)) fail('INPUT','Workflow payload must be an object.',400)
 if(type==='workflow.task.complete'||type==='workflow.task.retry'||type==='workflow.notification.read') {
  reader(actor)
  const id=text(p.id,'Work ID',100),all=isManager(actor),stamp=new Date().toISOString()
  if(type==='workflow.notification.read') {
   await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_workflow_notifications SET read_at=COALESCE(read_at,?),read_by=COALESCE(read_by,?) WHERE id=? AND (?=1 OR recipient_id=?)`).bind(stamp,actor.id,id,all?1:0,actor.id),changed(env.DB),audit(env.DB,actor,id,type)])
  } else {
   const task=await env.DB.prepare('SELECT * FROM st_workflow_tasks WHERE id=?').bind(id).first<any>()
   if(!task||(!all&&task.assignee_id!==actor.id)) fail('NOT_FOUND','Task not found.',404)
   if(type==='workflow.task.complete') {
    if(task.status==='completed') {await live(env,actor);return {id,status:'completed'}}
    await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_workflow_tasks SET status='completed',completed_at=?,completed_by=? WHERE id=? AND status='open'`).bind(stamp,actor.id,id),changed(env.DB),audit(env.DB,actor,id,type)])
   } else {
    manager(actor);await activeStaff(env,task.assignee_id)
    if(task.error_code==='CUSTOMER_ERASED') fail('SOURCE_UNAVAILABLE','Customer erasure stopped this follow-up.',409)
    await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_workflow_tasks SET status='pending',error_code=NULL,dispatch_at=? WHERE id=? AND status IN ('failed','paused') AND EXISTS(SELECT 1 FROM st_workflow_rules r WHERE r.id=rule_id AND r.revision=rule_revision AND r.state='active' AND ${authoritySql()}) AND EXISTS(${activeStaffSql})`).bind(stamp,id,task.assignee_id),changed(env.DB),audit(env.DB,actor,id,type)])
   }
  }
  return {id,recorded:true}
 }
 manager(actor)
 if(type==='workflow.schedule.preview') {
  const zone=await businessTimeZone(env.DB),day=date(p.date),time=minute(p.localTime)
  await live(env,actor)
  return {date:day,localTime:p.localTime,timeZone:zone,instant:new Date(localInstant(day,time,zone)).toISOString(),resolution:'First occurrence for a repeated time; first instant after a gap.'}
 }
 if(type==='workflow.dry-run') {
  const value=p.rule?validateRule(p.rule):(await rule(env,text(p.id,'Rule ID',100))).value
  await activeStaff(env,value.assigneeId)
  const zone=await businessTimeZone(env.DB),at=Date.now(),found=await matches(env,value,zone,at)
  await live(env,actor)
  return {source:sourceSupport(value.trigger),matches:found.slice(0,100),total:found.length,truncated:found.length>100,limit:100,timeZone:zone,checkedAt:new Date(at).toISOString(),assigneeId:value.assigneeId,dueAt:new Date(at+value.dueMinutes*60000).toISOString(),dispatchAt:new Date(quietRelease(at,zone,value.quietHours)).toISOString(),action:value.action,humanApprovalRequired:value.action!=='task',effects:'Internal task and optional staff in-app notification only.'}
 }
 if(type==='workflow.run') {await live(env,actor);return runWorkflows(env)}
 if(type==='workflow.save') {
  const value=validateRule(p.rule),id=p.id===undefined?crypto.randomUUID():text(p.id,'Rule ID',100),at=new Date().toISOString(),revision=crypto.randomUUID()
  await activeStaff(env,value.assigneeId)
  if(p.id!==undefined) {
   const previous=await rule(env,id)
   if(p.revision!==previous.revision) fail('CHANGED','The workflow rule changed. Review it again.')
   await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_workflow_rules SET value_json=?,revision=?,state='paused',updated_at=?,error_code=NULL WHERE id=? AND revision=? AND EXISTS(${activeStaffSql})`).bind(JSON.stringify(value),revision,at,id,previous.revision,value.assigneeId),changed(env.DB),env.DB.prepare('DELETE FROM st_workflow_authority WHERE rule_id=?').bind(id),env.DB.prepare("UPDATE st_workflow_tasks SET status='paused',error_code='RULE_CHANGED' WHERE rule_id=? AND status='pending'").bind(id),audit(env.DB,actor,id,'workflow.saved')])
  } else {
   await commit(env.DB,actor,[env.DB.prepare(`INSERT INTO st_workflow_rules(id,revision,state,value_json,created_at,updated_at) SELECT ?,?,'draft',?,?,? WHERE (SELECT count(*) FROM st_workflow_rules)<100 AND EXISTS(${activeStaffSql})`).bind(id,revision,JSON.stringify(value),at,at,value.assigneeId),changed(env.DB),audit(env.DB,actor,id,'workflow.saved')])
  }
  return rule(env,id)
 }
 if(type==='workflow.activate'||type==='workflow.pause') {
  const found=await rule(env,text(p.id,'Rule ID',100))
  if(p.revision!==found.revision) fail('CHANGED','The workflow rule changed. Review it again.')
  if(type==='workflow.activate') {await activeStaff(env,found.value.assigneeId);if(!sourceSupport(found.value.trigger).available) fail('SOURCE_UNAVAILABLE','Promotion records and their native event producer are not implemented.',409)}
  const state=type==='workflow.activate'?'active':'paused'
  await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_workflow_rules SET state=?,updated_at=?,error_code=NULL WHERE id=? AND revision=? ${state==='active'?`AND EXISTS(${activeStaffSql})`:''}`).bind(state,new Date().toISOString(),found.id,found.revision,...(state==='active'?[found.value.assigneeId]:[])),changed(env.DB),...(state==='paused'?[env.DB.prepare('DELETE FROM st_workflow_authority WHERE rule_id=?').bind(found.id),env.DB.prepare("UPDATE st_workflow_tasks SET status='paused',error_code='RULE_PAUSED' WHERE rule_id=? AND status='pending'").bind(found.id)]:[env.DB.prepare('INSERT INTO st_workflow_authority(rule_id,rule_revision,custodian_id,custodian_version) VALUES(?,?,?,?) ON CONFLICT(rule_id) DO UPDATE SET rule_revision=excluded.rule_revision,custodian_id=excluded.custodian_id,custodian_version=excluded.custodian_version').bind(found.id,found.revision,actor.id,actor.version)]),audit(env.DB,actor,found.id,type)])
  // Activation performs no dispatch. The reviewable pending work is collected
  // at Run now or the next real cron tick, so pause always has an effective door.
  return rule(env,found.id)
 }
 return fail('COMMAND','Unknown workflow command.',400)
}
