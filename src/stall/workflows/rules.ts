import type { Bindings } from '../../auth.server'
import { fail,integer,requirePerson,text,type Actor } from '../model'
import { minute } from './time'
export const triggers=['low_stock','overdue_fulfillment','return_request','return_confirmed','cancellation_request','order','customer','promotion','scheduled_reconciliation'] as const
export type Trigger=typeof triggers[number]
export type RuleValue={name:string;trigger:Trigger;assigneeId:string;dueMinutes:number;notifyStaff:boolean;action:'task'|'draft_followup'|'reconcile_followup';conditions:{sku?:string;status?:string;minTotalCents?:number;maxTotalCents?:number;stockAtMost?:number;overdueHours?:number};quietHours?:{start:string;end:string};localTime?:string}
export type Rule={id:string;revision:string;state:'draft'|'active'|'paused';value:RuleValue;createdAt:string;updatedAt:string;checkedAt:string|null;errorCode:string|null;localAuthority:boolean}
export const authoritySql=(alias='r')=>`EXISTS(SELECT 1 FROM st_workflow_authority a JOIN oa_operators o ON o.id=a.custodian_id WHERE a.rule_id=${alias}.id AND a.rule_revision=${alias}.revision AND o.version=a.custodian_version AND o.status='active' AND o.role IN ('owner','admin'))`
export const activeStaffSql=`SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (o.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id))`
export function manager(a:Actor) {requirePerson(a);if(!['owner','admin'].includes(a.role)) fail('FORBIDDEN','Only an owner or administrator manages workflow rules.',403)}
export function reader(a:Actor) {requirePerson(a);if(!['owner','admin'].includes(a.role)&&!a.staffRole) fail('FORBIDDEN','Only active staff may read workflow work.',403)}
export function isManager(a:Actor) {return !a.agent&&['owner','admin'].includes(a.role)}
export async function activeStaff(env:Bindings,id:string) {if(!await env.DB.prepare(activeStaffSql).bind(id).first()) fail('ASSIGNEE','Choose an active owner, administrator or granted staff member.',400)}
function object(value:unknown,name:string):Record<string,any> {if(!value||typeof value!=='object'||Array.isArray(value)) fail('INPUT',`${name} must be an object.`,400);return value}
function keys(value:Record<string,any>,allowed:string[],name:string) {if(Object.keys(value).some(k=>!allowed.includes(k))) fail('INPUT',`${name} contains an unsupported field.`,400)}
export function validateRule(input:unknown):RuleValue {
 const p=object(input,'Rule');keys(p,['name','trigger','assigneeId','dueMinutes','notifyStaff','action','conditions','quietHours','localTime'],'Rule')
 if(!triggers.includes(p.trigger)) fail('INPUT','Choose a supported workflow trigger.',400)
 const c=object(p.conditions??{},'Conditions'),allowed=p.trigger==='low_stock'?['sku','stockAtMost']:p.trigger==='overdue_fulfillment'?['sku','status','minTotalCents','maxTotalCents','overdueHours']:p.trigger==='order'?['sku','status','minTotalCents','maxTotalCents']:[]
 keys(c,allowed,'Conditions')
 const conditions:RuleValue['conditions']={}
 if(c.sku!==undefined) conditions.sku=text(c.sku,'SKU',100)
 if(c.status!==undefined) {if(!['checkout_pending','awaiting_payment','paid','shortfall','reserved','shipped'].includes(c.status)) fail('INPUT','Choose a current order status.',400);conditions.status=c.status}
 for(const k of ['minTotalCents','maxTotalCents','stockAtMost','overdueHours'] as const) if(c[k]!==undefined) conditions[k]=integer(c[k],k,0,k==='overdueHours'?8760:100000000)
 if(conditions.minTotalCents!==undefined&&conditions.maxTotalCents!==undefined&&conditions.minTotalCents>conditions.maxTotalCents) fail('INPUT','The minimum total must not exceed the maximum.',400)
 if(p.trigger==='low_stock') conditions.stockAtMost??=5
 if(p.trigger==='overdue_fulfillment') conditions.overdueHours??=168
 const action=p.action??'task'
 if(!['task','draft_followup','reconcile_followup'].includes(action)) fail('INPUT','Choose an internal task or human-reviewed follow-up.',400)
 if(p.notifyStaff!==undefined&&typeof p.notifyStaff!=='boolean') fail('INPUT','Staff notification must be true or false.',400)
 const value:RuleValue={name:text(p.name,'Rule name',100),trigger:p.trigger,assigneeId:text(p.assigneeId,'Responsible staff',100),dueMinutes:integer(p.dueMinutes??1440,'Due in minutes',1,525600),notifyStaff:p.notifyStaff!==false,action,conditions}
 if(p.quietHours!==undefined&&p.quietHours!==null) {const q=object(p.quietHours,'Quiet hours');keys(q,['start','end'],'Quiet hours');if(minute(q.start)===minute(q.end)) fail('INPUT','Quiet hours must have different start and end times.',400);value.quietHours={start:q.start,end:q.end}}
 if(p.trigger==='scheduled_reconciliation') {minute(p.localTime);value.localTime=p.localTime}
 else if(p.localTime!==undefined) fail('INPUT','A local scheduled time applies only to scheduled reconciliation.',400)
 return value
}
export async function rules(env:Bindings) {
 const rows=await env.DB.prepare(`SELECT r.*,${authoritySql()} AS local_authority FROM st_workflow_rules r ORDER BY created_at,id`).all<any>()
 return rows.results.map(r=>({id:r.id,revision:r.revision,state:r.state,value:JSON.parse(r.value_json),createdAt:r.created_at,updatedAt:r.updated_at,checkedAt:r.checked_at,errorCode:r.error_code,localAuthority:!!r.local_authority})) as Rule[]
}
export async function rule(env:Bindings,id:string) {const found=(await rules(env)).find(r=>r.id===id);if(!found) fail('NOT_FOUND','Workflow rule not found.',404);return found}
