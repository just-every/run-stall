import { analyticsTestMode } from './test-mode'
import type { Bindings } from '../../auth.server'
import { digest } from '../access'
import { analyticsCookie,analyticsCookieNames,analyticsRetentionDays,analyticsSessionMinutes,type AnalyticsSession,type AnalyticsSnapshot } from './model'

export type AnalyticsConsent={privacyHash:string;policyVersion:string;region?:string}
const trustedSnapshots=new WeakMap<AnalyticsSnapshot,{snapshot:AnalyticsSnapshot;consent:AnalyticsConsent}>()
export const consentFence=`EXISTS(SELECT 1 FROM st_customer_visitor_preferences p WHERE p.id_hash=? AND p.policy_version=? AND json_extract(p.value_json,'$.analytics')=1 AND p.policy_version=COALESCE((SELECT json_extract(value_json,'$.policyVersion') FROM st_customer_privacy_config WHERE id=1),'1'))`
export const consentValues=(consent:AnalyticsConsent)=>[consent.privacyHash,consent.policyVersion]
export function excludedAnalytics(request:Request,env:Bindings) {
 return analyticsTestMode(env)||/bot\b|crawler|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|monitoring/i.test(request.headers.get('user-agent')??'')
}
export async function analyticsConsent(request:Request,env:Bindings):Promise<AnalyticsConsent|undefined> {
 if(excludedAnalytics(request,env))return
 const origin=request.headers.get('origin')
 if((origin&&origin!==env.AUTH_ORIGIN)||request.headers.get('sec-fetch-site')==='cross-site')return
 const cookie=analyticsCookie(request,'stall_privacy')
 if(!cookie)return
 const privacyHash=await digest(cookie),row=await env.DB.prepare(`SELECT p.policy_version,p.value_json FROM st_customer_visitor_preferences p WHERE p.id_hash=? AND json_extract(p.value_json,'$.analytics')=1 AND p.policy_version=COALESCE((SELECT json_extract(value_json,'$.policyVersion') FROM st_customer_privacy_config WHERE id=1),'1')`).bind(privacyHash).first<{policy_version:string;value_json:string}>()
 if(!row)return
 const value=JSON.parse(row.value_json),region=value.regionSelected===true&&typeof value.region==='string'&&/^[A-Z]{2}(?:-[A-Z0-9]{1,6})?$/.test(value.region)?value.region:undefined
 return {privacyHash,policyVersion:row.policy_version,...(region?{region}:{})}
}
export async function analyticsSession(request:Request,env:Bindings,consent:AnalyticsConsent) {
 const sessionCookie=analyticsCookie(request,analyticsCookieNames.session),visitorCookie=analyticsCookie(request,analyticsCookieNames.visitor)
 if(!sessionCookie||!visitorCookie)return
 const id=await digest(sessionCookie),visitorHash=await digest(visitorCookie),cutoff=new Date(Date.now()-analyticsSessionMinutes*60000).toISOString()
 const row=await env.DB.prepare(`SELECT s.id,s.visitor_hash,s.started_at,s.last_at,s.value_json FROM st_analytics_sessions s JOIN st_analytics_visitors v ON v.id_hash=s.visitor_hash WHERE s.id=? AND s.visitor_hash=? AND s.last_at>? AND v.privacy_hash=? AND v.policy_version=? AND COALESCE(json_extract(s.value_json,'$.restored'),0)=0 AND json_extract(s.value_json,'$.privacyHash')=? AND json_extract(s.value_json,'$.policyVersion')=?`).bind(id,visitorHash,cutoff,consent.privacyHash,consent.policyVersion,consent.privacyHash,consent.policyVersion).first<{id:string;visitor_hash:string;started_at:string;last_at:string;value_json:string}>()
 return row?{...row,value:JSON.parse(row.value_json) as AnalyticsSession,sessionCookie,visitorCookie}:undefined
}
export async function checkoutAnalytics(request:Request,env:Bindings):Promise<AnalyticsSnapshot|undefined> {
 const consent=await analyticsConsent(request,env)
 if(!consent)return
 const session=await analyticsSession(request,env,consent)
 if(!session)return
 const {privacyHash:_,restored:__,...attribution}=session.value
 const snapshot:AnalyticsSnapshot=Object.freeze({...attribution,sessionId:session.id,visitorHash:session.visitor_hash})
 trustedSnapshots.set(snapshot,{snapshot:{...snapshot},consent})
 return snapshot
}
// A snapshot is admitted only from this module and inserted with the new order transaction.
export function checkoutAnalyticsStatements(env:Bindings,orderId:string,snapshot?:AnalyticsSnapshot) {
 const trusted=snapshot&&trustedSnapshots.get(snapshot)
 if(!trusted)return []
 return [env.DB.prepare(`UPDATE st_orders SET value_json=json_set(value_json,'$.analytics',json(?)) WHERE id=? AND json_type(value_json,'$.analytics') IS NULL AND ${consentFence} AND EXISTS(SELECT 1 FROM st_analytics_sessions s JOIN st_analytics_visitors v ON v.id_hash=s.visitor_hash WHERE s.id=? AND s.visitor_hash=? AND v.privacy_hash=? AND v.policy_version=? AND s.last_at>? AND COALESCE(json_extract(s.value_json,'$.restored'),0)=0)`).bind(JSON.stringify(trusted.snapshot),orderId,...consentValues(trusted.consent),trusted.snapshot.sessionId,trusted.snapshot.visitorHash,trusted.consent.privacyHash,trusted.consent.policyVersion,new Date(Date.now()-analyticsSessionMinutes*60000).toISOString()),
  env.DB.prepare(`INSERT OR IGNORE INTO st_analytics_events SELECT ?,json_extract(value_json,'$.analytics.sessionId'),'checkout',?,NULL FROM st_orders WHERE id=? AND json_extract(value_json,'$.analytics.sessionId')=? AND ${consentFence}`).bind('server-checkout:'+orderId,new Date().toISOString(),orderId,trusted.snapshot.sessionId,...consentValues(trusted.consent)),
 ]
}
export function analyticsRevocationStatements(db:D1Database,privacyHash:string) {
 const visitors='SELECT id_hash FROM st_analytics_visitors WHERE privacy_hash=?'
 return [
  db.prepare(`UPDATE st_orders SET value_json=json_remove(value_json,'$.analytics'),revision=lower(hex(randomblob(16))) WHERE json_extract(value_json,'$.analytics.visitorHash') IN (${visitors})`).bind(privacyHash),
  db.prepare(`DELETE FROM st_analytics_events WHERE session_id IN (SELECT id FROM st_analytics_sessions WHERE visitor_hash IN (${visitors}))`).bind(privacyHash),
  db.prepare(`DELETE FROM st_analytics_sessions WHERE visitor_hash IN (${visitors})`).bind(privacyHash),
  db.prepare('DELETE FROM st_analytics_visitors WHERE privacy_hash=?').bind(privacyHash),
 ]
}
export function analyticsErasureStatements(db:D1Database,email:string) {
 const hashes="SELECT DISTINCT json_extract(value_json,'$.analytics.visitorHash') FROM st_orders WHERE json_extract(value_json,'$.customerEmail')=? AND json_extract(value_json,'$.analytics.visitorHash') IS NOT NULL"
 return [
  db.prepare(`DELETE FROM st_analytics_events WHERE session_id IN (SELECT id FROM st_analytics_sessions WHERE visitor_hash IN (${hashes}))`).bind(email),
  db.prepare(`DELETE FROM st_analytics_sessions WHERE visitor_hash IN (${hashes})`).bind(email),
  db.prepare(`DELETE FROM st_analytics_visitors WHERE id_hash IN (${hashes})`).bind(email),
  db.prepare(`UPDATE st_orders SET value_json=json_remove(value_json,'$.analytics'),revision=lower(hex(randomblob(16))) WHERE json_extract(value_json,'$.analytics.visitorHash') IN (${hashes}) OR json_extract(value_json,'$.customerEmail')=?`).bind(email,email),
 ]
}
export function analyticsRetentionStatements(db:D1Database,now=Date.now()) {
 const cutoff=new Date(now-analyticsRetentionDays*86400000).toISOString()
 return [
  db.prepare('DELETE FROM st_analytics_events WHERE occurred_at<? OR session_id IN (SELECT id FROM st_analytics_sessions WHERE started_at<?)').bind(cutoff,cutoff),
  db.prepare('DELETE FROM st_analytics_sessions WHERE started_at<?').bind(cutoff),
  db.prepare('DELETE FROM st_analytics_visitors WHERE last_at<?').bind(cutoff),
  db.prepare("UPDATE st_orders SET value_json=json_remove(value_json,'$.analytics.visitorHash','$.analytics.sessionId'),revision=lower(hex(randomblob(16))) WHERE json_extract(value_json,'$.analytics.attributedAt')<? AND json_type(value_json,'$.analytics.sessionId') IS NOT NULL").bind(cutoff),
 ]
}
