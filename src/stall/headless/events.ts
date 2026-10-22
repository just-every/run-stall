import type { Bindings } from '../../auth.server'
import { audit,changed,commit } from '../access'
import { fail,type Actor } from '../model'
import { now } from './common'
import { checkedEndpoint } from './endpoint'
import { signature,unseal } from './crypto'
import { rate } from './auth'
type Delivery={id:string;subscription_id:string;event_id:string;status:string;body:string;endpoint:string;secret_cipher:string;app_id:string}
const liveSubscription=`EXISTS(SELECT 1 FROM st_headless_subscriptions s JOIN st_headless_apps a ON a.id=s.app_id JOIN oa_operators o ON o.id=s.issuer_id WHERE s.id=? AND s.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>? AND a.issuer_id=o.id AND a.issuer_version=o.version AND o.role='owner' AND o.status='active' AND o.version=s.issuer_version)`
export function subscriptionGuard(env:Bindings,id:string) {return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN ${liveSubscription} THEN 1 ELSE 0 END`).bind(id,Date.now())}
export async function deliveryHistory(env:Bindings,url:URL) {
 const conditions:string[]=[],values:string[]=[]
 for(const [param,column] of [['subscriptionId','d.subscription_id'],['status','d.status'],['kind','e.kind'],['eventId','d.event_id']] as const) {
  const value=url.searchParams.get(param);if(value) {conditions.push(`${column}=?`);values.push(value)}
 }
 const before=url.searchParams.get('before')
 if(before){conditions.push('d.rowid<?');values.push(before)}
 const rows=await env.DB.prepare(`SELECT d.rowid AS cursor,d.id,d.subscription_id AS subscriptionId,d.event_id AS eventId,e.kind,d.status,d.created_at AS createdAt,d.attempted_at AS attemptedAt,d.finished_at AS finishedAt,d.http_status AS httpStatus,d.replay_of AS replayOf FROM st_headless_deliveries d JOIN st_headless_events e ON e.id=d.event_id ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY d.rowid DESC LIMIT 101`).bind(...values).all<any>()
 return {deliveries:rows.results.slice(0,100),next:rows.results.length>100?String(rows.results[99].cursor):null}
}
export async function sendDelivery(env:Bindings,actor:Actor,id:string,replay=false) {
 await rate(env,'delivery:'+actor.id,30)
 const original=await env.DB.prepare('SELECT d.*,e.body,s.endpoint,s.secret_cipher,s.app_id FROM st_headless_deliveries d JOIN st_headless_events e ON e.id=d.event_id JOIN st_headless_subscriptions s ON s.id=d.subscription_id WHERE d.id=?').bind(id).first<Delivery>()
 if(!original) fail('NOT_FOUND','Delivery not found.',404)
 if(!await env.DB.prepare(`SELECT 1 WHERE ${liveSubscription}`).bind(original.subscription_id,Date.now()).first()) fail('REVOKED','Subscription or integration authority was revoked.',403)
 if(replay&&original.status==='pending') fail('DELIVERY_STATE','Send this pending attempt before replaying it.')
 if(!replay&&original.status!=='pending') fail('DELIVERY_STATE','This attempt already started. Inspect its outcome and explicitly replay if appropriate.')
 // Resolution is checked at every attempt. Redirects never receive the body.
 const url=await checkedEndpoint(original.endpoint)
 const deliveryId=replay?crypto.randomUUID():original.id,timestamp=Math.floor(Date.now()/1000)
 const signed=await signature(await unseal(env,original.secret_cipher),timestamp,original.body)
 const statements=[subscriptionGuard(env,original.subscription_id)]
 if(replay) statements.push(env.DB.prepare('INSERT INTO st_headless_deliveries(id,subscription_id,event_id,status,created_at,replay_of) VALUES(?,?,?,?,?,?)').bind(deliveryId,original.subscription_id,original.event_id,'pending',now(),original.id))
 statements.push(env.DB.prepare("UPDATE st_headless_deliveries SET status='sending',attempted_at=? WHERE id=? AND status='pending'").bind(now(),deliveryId),changed(env.DB),audit(env.DB,actor,deliveryId,replay?'headless.delivery.replayed':'headless.delivery.started'))
 await commit(env.DB,actor,statements)
 let status='uncertain',httpStatus:number|null=null
 try {
  const result=await fetch(url.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','stall-signature':signed,'stall-event-id':original.event_id,'stall-delivery-id':deliveryId},body:original.body})
  httpStatus=result.status;status=result.ok?'delivered':'rejected'
  await result.body?.cancel()
 } catch { /* A timeout or disconnect can follow an external effect. Never retry. */ }
 // Completion is an observation, even if the owner revoked authority in flight.
 await env.DB.prepare('UPDATE st_headless_deliveries SET status=?,http_status=?,finished_at=? WHERE id=? AND status=\'sending\'').bind(status,httpStatus,now(),deliveryId).run()
 return {id:deliveryId,eventId:original.event_id,status,httpStatus}
}
