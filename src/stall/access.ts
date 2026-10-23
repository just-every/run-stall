import { operatorAuth, type Bindings } from '../auth.server'
import { fail, type Actor } from './model'
export async function digest(value:string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('') }
/** The caller's network address, keyed to this installation, for per-client allowances. */
export const clientKey=(env:Bindings,request:Request)=>digest(`${env.SESSION_SECRET}\nclient\n${request.headers.get('CF-Connecting-IP')??''}`)
export async function current(request:Request,env:Bindings):Promise<Actor> {
 const authorization=request.headers.get('authorization')
 if(authorization) {
  if(!authorization.startsWith('Bearer ')) fail('AUTH','Use a current session or personal Stall agent credential.',401)
  const grant=await env.DB.prepare(`SELECT t.id AS grantId,o.id,o.email,o.role,o.version FROM st_agent_tokens t JOIN oa_operators o ON o.id=t.actor_id WHERE t.digest=? AND t.expires_at>? AND o.status='active' AND o.version=t.actor_version AND o.role IN ('owner','admin')`).bind(await digest(authorization.slice(7)),Date.now()).first<any>()
  if(!grant) fail('AUTH','Agent credential expired or revoked.',401)
  return {...grant,agent:true}
 }
 const s=await operatorAuth(env).getSession(request)
 if(!s) fail('AUTH','Sign in to manage the shop.',401)
 const staff=await env.DB.prepare('SELECT staff_role AS staffRole,revision AS scopeRevision,refund_limit_cents AS refundLimitCents,separate_approval AS separateApproval FROM st_staff WHERE actor_id=?').bind(s.operator.id).first<any>()
 return {...(staff?{...staff,separateApproval:!!staff.separateApproval}:{}),id:s.operator.id,email:s.operator.email,role:s.operator.role,version:s.operator.version,sessionId:s.id,agent:false}
}
export function authority(a:Actor) {
 const sql=a.agent?`EXISTS(SELECT 1 FROM st_agent_tokens t JOIN oa_operators o ON o.id=t.actor_id WHERE t.id=? AND o.id=? AND o.version=? AND t.actor_version=o.version AND o.status='active' AND o.role IN ('owner','admin') AND t.expires_at>?)`:`EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.role=? AND (o.role='owner' OR (o.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff g WHERE g.actor_id=o.id) AND ?='') OR EXISTS(SELECT 1 FROM st_staff g WHERE g.actor_id=o.id AND g.revision=?)) AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>?)`
 const values=a.agent?[a.grantId!,a.id,a.version,Date.now()]:[a.sessionId!,a.id,a.version,a.role,a.scopeRevision??'',a.scopeRevision??'',Date.now()]
 return {sql,params:values}
}
export function admission(db:D1Database,a:Actor) {
 const {sql,params}=authority(a)
 return db.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END`).bind(...params)
}
export async function commit(db:D1Database,a:Actor,statements:D1PreparedStatement[]) { await db.batch([admission(db,a),...statements,db.prepare('DELETE FROM st_guard')]) }
export const changed=(db:D1Database)=>db.prepare('INSERT INTO st_guard(value) VALUES(changes())')
export const audit=(db:D1Database,a:Actor,subject:string,action:string)=>systemAudit(db,subject,action,a.agent?`agent:${a.grantId}`:a.id)
export const systemAudit=(db:D1Database,subject:string,action:string,actor='stripe')=>db.prepare('INSERT INTO st_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),subject,actor,action,new Date().toISOString())
export async function live(env:Bindings,actor:Actor) { await commit(env.DB,actor,[]) }
