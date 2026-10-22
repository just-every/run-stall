import { operatorAuth,type Bindings } from '../../auth.server'
import { digest } from '../access'
import { fail,type Actor } from '../model'
export type App={id:string;issuer_id:string;issuer_version:number;origin:string;scopes_json:string}
export type Customer={id:string;actor:Actor}
const issuerSql=`SELECT 1 FROM st_headless_apps a JOIN oa_operators o ON o.id=a.issuer_id WHERE a.id=? AND a.revoked_at IS NULL AND a.expires_at>? AND o.status='active' AND o.role='owner' AND o.version=a.issuer_version`
export async function rate(env:Bindings,bucket:string,maximum=120) {
 const window=Math.floor(Date.now()/60000)*60000
 const row=await env.DB.prepare('INSERT INTO st_headless_limits(bucket,window_at,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window_at=excluded.window_at,count=CASE WHEN window_at=excluded.window_at THEN count+1 ELSE 1 END RETURNING count').bind(bucket,window).first<{count:number}>()
 if(!row||row.count>maximum) fail('RATE_LIMIT','Too many requests. Wait until the next minute.',429)
 await env.DB.prepare('DELETE FROM st_headless_limits WHERE window_at<?').bind(window-120000).run()
}
export async function app(request:Request,env:Bindings,scope:string):Promise<App> {
 const header=request.headers.get('authorization')??''
 if(!/^Bearer [a-f\d]{64}$/.test(header)) fail('AUTH','A scoped storefront credential is required.',401)
 const a=await env.DB.prepare(`SELECT a.* FROM st_headless_apps a JOIN oa_operators o ON o.id=a.issuer_id WHERE a.digest=? AND a.revoked_at IS NULL AND a.expires_at>? AND o.status='active' AND o.role='owner' AND o.version=a.issuer_version`).bind(await digest(header.slice(7)),Date.now()).first<App>()
 if(!a) fail('AUTH','Storefront credential expired or revoked.',401)
 if(request.headers.get('origin')!==a.origin) fail('ORIGIN','Use the credential’s exact storefront origin.',403)
 await rate(env,'app:'+a.id)
 if(!JSON.parse(a.scopes_json).includes(scope)) fail('SCOPE','The integration has no permission for this door.',403)
 return a
}
export function appGuard(env:Bindings,a:App) {return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(${issuerSql}) THEN 1 ELSE 0 END`).bind(a.id,Date.now())}
export function customerGuard(env:Bindings,c:Customer) {
 return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id JOIN st_headless_customers c ON c.operator_id=o.id WHERE c.id=? AND s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>?) THEN 1 ELSE 0 END`).bind(c.id,c.actor.sessionId!,c.actor.id,c.actor.version,Date.now())
}
export async function fenced(env:Bindings,a:App,c:Customer|null,statements:D1PreparedStatement[]=[]) {await env.DB.batch([appGuard(env,a),...(c?[customerGuard(env,c)]:[]),...statements,env.DB.prepare('DELETE FROM st_guard')])}
export async function customer(request:Request,env:Bindings,a:App):Promise<Customer> {
 // Bearer authority never becomes a human session. Native auth reads only the
 // signed HttpOnly cookie and rechecks live operator/session status and version.
 const session=await operatorAuth(env).getSession(request)
 if(!session) fail('CUSTOMER_AUTH','Sign in independently with this installation’s native sign-in.',401)
 const actor:Actor={id:session.operator.id,email:session.operator.email,role:session.operator.role,version:session.operator.version,sessionId:session.id,agent:false}
 let row=await env.DB.prepare('SELECT id FROM st_headless_customers WHERE operator_id=?').bind(actor.id).first<{id:string}>()
 if(!row) {
  await fenced(env,a,null,[env.DB.prepare(`INSERT OR IGNORE INTO st_headless_customers(id,operator_id,email,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>?)`).bind(crypto.randomUUID(),actor.id,actor.email.toLowerCase(),new Date().toISOString(),session.id,actor.id,actor.version,Date.now())])
  row=await env.DB.prepare('SELECT id FROM st_headless_customers WHERE operator_id=?').bind(actor.id).first<{id:string}>()
 }
 if(row)await fenced(env,a,null,[env.DB.prepare('UPDATE st_headless_customers SET email=? WHERE id=?').bind(actor.email.toLowerCase(),row.id)])
 if(!row) fail('CUSTOMER_AUTH','Customer authority changed. Sign in again.',401)
 return {id:row.id,actor}
}
export async function owner(request:Request,env:Bindings):Promise<Actor> {
 if(request.headers.has('authorization')) fail('OWNER_REQUIRED','Use the owner’s native session, never an app credential.',403)
 const s=await operatorAuth(env).getSession(request)
 if(!s) fail('AUTH','Sign in as the owner.',401)
 if(s.operator.role!=='owner') fail('OWNER_REQUIRED','Only the owner can administer storefront integrations.',403)
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this installation’s owner page.',403)
 return {id:s.operator.id,email:s.operator.email,role:s.operator.role,version:s.operator.version,sessionId:s.id,agent:false}
}
