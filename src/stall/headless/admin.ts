import type { Bindings } from '../../auth.server'
import { audit,changed,commit,digest } from '../access'
import { fail,integer,text,type Actor } from '../model'
import { body,json,kinds,now,origin,pickList,prefix,scopes } from './common'
import { seal,token } from './crypto'
import { endpoint } from './endpoint'
import { deliveryHistory,sendDelivery } from './events'
import { owner,rate } from './auth'
export const subscriptionConsent='Send minimal Stall event identifiers to this endpoint'
async function issueApp(env:Bindings,a:Actor,p:any) {
 const selected=pickList(p.scopes,scopes,'scopes'),allowedOrigin=origin(p.origin,env.AUTH_LOCAL==='true'),label=text(p.label,'Integration label',100)
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM st_headless_apps WHERE revoked_at IS NULL').first<{n:number}>()
 if(count&&count.n>=50) fail('APP_LIMIT','Revoke an unused integration before creating another.')
 const secret=token(),id=crypto.randomUUID(),expiresAt=Date.now()+integer(p.expiresInDays??30,'Expiry in days',1,90)*86400000
 await commit(env.DB,a,[env.DB.prepare('INSERT INTO st_headless_apps(id,label,digest,issuer_id,issuer_version,origin,scopes_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,label,await digest(secret),a.id,a.version,allowedOrigin,JSON.stringify(selected),expiresAt,now()),audit(env.DB,a,id,'headless.app.issued')])
 return {id,token:secret,expiresAt,origin:allowedOrigin,scopes:selected}
}
async function subscribe(env:Bindings,a:Actor,p:any) {
 const appId=text(p.appId,'Integration ID',100),url=endpoint(p.endpoint),selected=pickList(p.kinds,kinds,'event kinds')
 if(p.consent!==subscriptionConsent) fail('CONSENT','Explicit owner consent to transmit minimal event identifiers is required.',400)
 const grant=await env.DB.prepare("SELECT id FROM st_headless_apps WHERE id=? AND issuer_id=? AND issuer_version=? AND revoked_at IS NULL AND expires_at>?").bind(appId,a.id,a.version,Date.now()).first()
 if(!grant) fail('APP_AUTHORITY','Use a live integration issued by this owner.',403)
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM st_headless_subscriptions WHERE app_id=? AND revoked_at IS NULL').bind(appId).first<{n:number}>()
 if(count&&count.n>=10) fail('SUBSCRIPTION_LIMIT','Revoke an unused subscription before creating another.')
 const id=crypto.randomUUID(),secret=token(),at=now()
 await commit(env.DB,a,[env.DB.prepare('INSERT INTO st_headless_subscriptions(id,app_id,endpoint,kinds_json,secret_cipher,issuer_id,issuer_version,consent_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM st_headless_apps WHERE id=? AND issuer_id=? AND issuer_version=? AND revoked_at IS NULL AND expires_at>?)').bind(id,appId,url.href,JSON.stringify(selected),await seal(env,secret),a.id,a.version,at,appId,a.id,a.version,Date.now()),changed(env.DB),audit(env.DB,a,id,'headless.subscription.consented')])
 return {id,signingSecret:secret,endpoint:url.href,kinds:selected,consentAt:at}
}
export async function adminResponse(request:Request,env:Bindings,path:string):Promise<Response> {
 const actor=await owner(request,env);await rate(env,'admin:'+actor.id,120)
 if(path===prefix+'/admin/apps') {
  if(request.method==='POST') return json(await issueApp(env,actor,await body(request)),201)
  if(request.method==='GET') return json({apps:(await env.DB.prepare('SELECT id,label,issuer_id AS issuerId,origin,scopes_json AS scopesJson,expires_at AS expiresAt,created_at AS createdAt,revoked_at AS revokedAt FROM st_headless_apps ORDER BY created_at DESC LIMIT 100').all()).results})
 }
 const appRevoke=path.match(/^\/api\/stall\/v1\/admin\/apps\/([^/]+)\/revoke$/)
 if(appRevoke&&request.method==='POST') {
  await commit(env.DB,actor,[env.DB.prepare('UPDATE st_headless_apps SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(now(),appRevoke[1]),audit(env.DB,actor,appRevoke[1],'headless.app.revoked')]);return json({revoked:true})
 }
 if(path===prefix+'/admin/subscriptions') {
  if(request.method==='POST') return json(await subscribe(env,actor,await body(request)),201)
  if(request.method==='GET') return json({subscriptions:(await env.DB.prepare('SELECT id,app_id AS appId,endpoint,kinds_json AS kindsJson,consent_at AS consentAt,revoked_at AS revokedAt FROM st_headless_subscriptions ORDER BY consent_at DESC LIMIT 500').all()).results})
 }
 const subscriptionRevoke=path.match(/^\/api\/stall\/v1\/admin\/subscriptions\/([^/]+)\/revoke$/)
 if(subscriptionRevoke&&request.method==='POST') {
  await commit(env.DB,actor,[env.DB.prepare('UPDATE st_headless_subscriptions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(now(),subscriptionRevoke[1]),audit(env.DB,actor,subscriptionRevoke[1],'headless.subscription.revoked')]);return json({revoked:true})
 }
 if(path===prefix+'/admin/deliveries'&&request.method==='GET') return json(await deliveryHistory(env,new URL(request.url)))
 const delivery=path.match(/^\/api\/stall\/v1\/admin\/deliveries\/([^/]+)\/(send|replay)$/)
 if(delivery&&request.method==='POST') return json(await sendDelivery(env,actor,delivery[1],delivery[2]==='replay'))
 return json({error:{code:'NOT_FOUND',message:'Unknown integration administration endpoint.'}},404)
}
