import { operatorAuth,type Bindings } from '../../auth.server'
import { AuthError,normalizeEmail,type Session } from '../../modules/operator-auth/index.mjs'
import { clientKey,digest } from '../access'
import { fail,Problem } from '../model'
import { rawBody } from '../stripe'

const requestPath='/api/stall/customer/registration'
const reviewPath='/api/stall/customer/registration-requests'
const day=86400000
const accepted={status:'accepted',message:'If eligible, your request will be reviewed by the shop. Access requires approval and verification through an email link.'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex'}})

function sameOrigin(request:Request,env:Bindings,mutation=true) {
 const url=new URL(request.url),host=request.headers.get('host'),origin=request.headers.get('origin')
 if(url.origin!==env.AUTH_ORIGIN||(host&&host.toLowerCase()!==url.host.toLowerCase())||request.headers.get('sec-fetch-site')==='cross-site'||(origin!==null&&origin!==env.AUTH_ORIGIN)||(mutation&&origin!==env.AUTH_ORIGIN))fail('ORIGIN','Use this shop’s account page.',403)
 if(request.headers.has('authorization'))fail('PERSON_REQUIRED','Use a native browser session for registration.',403)
}
async function input(request:Request) {
 let value:any
 try{value=JSON.parse(await rawBody(request,2048))}catch(error){if(error instanceof Problem)throw error;fail('INPUT','Supply a JSON object.',400)}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('INPUT','Supply a JSON object.',400)
 return value
}

/** Discard unverified identity data at seven days and request metadata at thirty days. */
export async function expireCustomerRegistrations(env:Bindings) {
 const now=Date.now()
 await env.DB.batch([
  env.DB.prepare(`UPDATE st_customer_registrations SET email=NULL,display_name=NULL,email_key=NULL,status=CASE WHEN status IN ('pending','sending','failed') THEN 'expired' ELSE status END WHERE expires_at<=? AND email_key IS NOT NULL`).bind(now),
  env.DB.prepare('DELETE FROM st_customer_registrations WHERE requested_at<=?').bind(now-30*day),
  env.DB.prepare('DELETE FROM st_customer_registration_limits WHERE expires_at<=?').bind(now),
 ])
}
/** Include these statements in the caller's erasure transaction. */
export async function customerRegistrationErasureStatements(db:D1Database,email:string) {
 return [db.prepare('DELETE FROM st_customer_registrations WHERE email_key=? OR email=?').bind(await digest(email.toLowerCase()),email.toLowerCase())]
}

async function intake(request:Request,env:Bindings) {
 sameOrigin(request,env)
 const p=await input(request)
 if(Object.keys(p).some(key=>!['email','displayName','necessaryAccountConsent'].includes(key))||p.necessaryAccountConsent!==true)fail('CONSENT','Explicitly agree to the account request and necessary account emails.',400)
 const email=normalizeEmail(p.email),name=typeof p.displayName==='string'?p.displayName.trim():''
 if(!name||name.length>120||/[\x00-\x1f\x7f]/.test(name))fail('INPUT','Enter a name of at most 120 characters.',400)
 await expireCustomerRegistrations(env)
 const now=Date.now(),window=Math.floor(now/3600000),key=await clientKey(env,request)
 // A fixed global table bound prevents unique network clients from filling storage.
 const limit=await env.DB.prepare(`INSERT INTO st_customer_registration_limits(client_key,window,attempts,expires_at)
  SELECT ?,?,1,? WHERE (SELECT COUNT(*) FROM st_customer_registration_limits)<2000 OR EXISTS(SELECT 1 FROM st_customer_registration_limits WHERE client_key=?)
  ON CONFLICT(client_key) DO UPDATE SET window=excluded.window,attempts=CASE WHEN st_customer_registration_limits.window=excluded.window THEN min(st_customer_registration_limits.attempts+1,11) ELSE 1 END,expires_at=excluded.expires_at RETURNING attempts`).bind(key,window,now+3600000,key).first<{attempts:number}>()
 if(!limit||limit.attempts>10)return json(accepted,202)
 // The same reply covers existing accounts, duplicates, and exhausted allowances.
 await env.DB.prepare(`INSERT INTO st_customer_registrations(id,email_key,email,display_name,consent_version,requested_at,expires_at,status)
  SELECT ?,?,?,?,?,?,?,'pending' WHERE NOT EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=?) AND (SELECT COUNT(*) FROM st_customer_registrations)<1000
  ON CONFLICT(email_key) DO NOTHING`).bind(crypto.randomUUID(),await digest(email),email,name,'necessary-account-v1',now,now+7*day,email).run()
 return json(accepted,202)
}

async function owner(request:Request,env:Bindings) {
 sameOrigin(request,env,request.method!=='GET')
 const session=await operatorAuth(env).getSession(request)
 if(!session)fail('AUTH','Sign in as the shop owner.',401)
 if(session.kind!=='native'||session.operator.role!=='owner')fail('FORBIDDEN','Only the owner’s native session may review account requests.',403)
 return session
}
function ownerFence(session:Session) {
 return {sql:`EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND s.kind='native' AND s.revoked_at IS NULL AND s.expires_at>? AND o.id=? AND o.version=? AND o.version=s.operator_version AND o.role='owner' AND o.status='active')`,params:[session.id,Date.now(),session.operator.id,session.operator.version]}
}
async function review(request:Request,env:Bindings) {
 const session=await owner(request,env)
 await expireCustomerRegistrations(env)
 if(request.method==='GET') {
  const fence=ownerFence(session)
  const rows=await env.DB.prepare(`SELECT id,email,display_name AS displayName,requested_at AS requestedAt,expires_at AS expiresAt,consent_version AS consentVersion,status FROM st_customer_registrations WHERE status IN ('pending','sending','failed') AND expires_at>? AND ${fence.sql} ORDER BY requested_at,id LIMIT 1000`).bind(Date.now(),...fence.params).all()
  return json({requests:rows.results})
 }
 const p=await input(request)
 if(Object.keys(p).some(key=>!['id','decision','reviewed'].includes(key))||typeof p.id!=='string'||p.id.length>100||!['approve','decline'].includes(p.decision)||p.reviewed!==true)fail('REVIEW_REQUIRED','Review one request and explicitly approve or decline it.',400)
 const fence=ownerFence(session),now=Date.now(),status=p.decision==='approve'?'sending':'declined'
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE st_customer_registrations SET status=?,decided_at=?,decided_by=? WHERE id=? AND status='pending' AND expires_at>? AND ${fence.sql}
   AND (?='declined' OR NOT EXISTS(SELECT 1 FROM oa_operators o WHERE lower(o.email)=st_customer_registrations.email)) RETURNING email,display_name AS displayName`).bind(status,now,session.operator.id,p.id,now,...fence.params,status),
  env.DB.prepare(`INSERT INTO st_audit SELECT ?,id,decided_by,?,? FROM st_customer_registrations WHERE id=? AND status=? AND decided_at=? AND decided_by=? AND changes()>0`).bind(crypto.randomUUID(),p.decision==='approve'?'customer.registration-approved':'customer.registration-declined',new Date(now).toISOString(),p.id,status,now,session.operator.id),
 ])
 const row=result[0].results[0] as {email:string;displayName:string}|undefined
 if(!row)fail('CONFLICT','This request expired, was already decided, or already has an account. Refresh the review list.',409)
 if(p.decision==='decline') {
  await env.DB.prepare('UPDATE st_customer_registrations SET email=NULL,display_name=NULL WHERE id=?').bind(p.id).run()
  return json({status:'declined'})
 }
 try {
  // The supported native API performs invitation policy and session fencing itself.
  await operatorAuth(env).invite(request,{email:row.email,displayName:row.displayName,role:'member',returnTo:'/order'})
  await env.DB.prepare(`UPDATE st_customer_registrations SET status='invited',email=NULL,display_name=NULL WHERE id=? AND status='sending'`).bind(p.id).run()
  return json({status:'invited'})
 }catch {
  // Mail may already have left the shop. Do not resend an uncertain invitation.
  await env.DB.prepare(`UPDATE st_customer_registrations SET status='failed' WHERE id=? AND status='sending'`).bind(p.id).run()
  return json({error:{code:'INVITATION_UNCERTAIN',message:'Invitation delivery was not confirmed. Review the native invitation record before taking another action.'}},409)
 }
}

/** Mount before the authenticated shop router; this door grants no public authority. */
export async function registrationResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path!==requestPath&&path!==reviewPath)return null
 try {
  if(path===requestPath&&request.method==='POST')return await intake(request,env)
  if(path===reviewPath&&['GET','POST'].includes(request.method))return await review(request,env)
  return json({error:{code:'METHOD',message:'Use the supported registration action.'}},405)
 }catch(error) {
  if(error instanceof Problem)return json({error:{code:error.code,message:error.message}},error.status)
  if(error instanceof AuthError)return json({error:{code:'INPUT',message:'Review your email address and account request.'}},error.status)
  return json({error:{code:'UNAVAILABLE',message:'Registration is unavailable. Try again later.'}},503)
 }
}
