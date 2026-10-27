import type { Bindings } from '../../auth.server'
import { digest } from '../access'
import { fail } from '../model'
import { rawBody } from '../stripe'
import { analyticsConsent,analyticsRetentionStatements,analyticsSession,consentFence,consentValues,excludedAnalytics } from './capture'
import { analyticsCookie,analyticsCookieHeader,analyticsCookieNames,analyticsRetentionDays,analyticsSessionMinutes,clearAnalyticsCookies,randomAnalyticsId,type AnalyticsAttribution,type AnalyticsKind,type AnalyticsSession } from './model'

const response=(value:unknown,headers=new Headers())=>{headers.set('cache-control','no-store');headers.set('referrer-policy','no-referrer');headers.set('x-content-type-options','nosniff');return Response.json(value,{headers})}
const token=(value:string|null)=>value&&/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)?value.toLowerCase():undefined
function landing(value:unknown,origin:string) {
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//'))fail('INPUT','Supply a shop pathname.',400)
 const url=new URL(value,origin)
 if(url.origin!==new URL(origin).origin)fail('INPUT','Supply a shop pathname.',400)
 const path=url.pathname
 return {url,path:/^\/(?:shop(?:\/[a-z0-9][a-z0-9-]{0,119})?|cart|checkout|pages\/[a-z0-9][a-z0-9-]{0,119}|blog(?:\/[a-z0-9][a-z0-9-]{0,119})?)?\/?$/i.test(path)?path:'/other'}
}
function referrerHostname(value:unknown,origin:string) {
 if(typeof value!=='string'||value.length>2000)return
 try {const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.origin===new URL(origin).origin||!/[a-z]/i.test(url.hostname)||url.hostname.includes(':')||!url.hostname.includes('.'))return;return url.hostname.toLowerCase()}catch{return}
}
function attribution(p:any,request:Request,env:Bindings,policyVersion:string,region?:string):AnalyticsAttribution {
 const {url,path}=landing(p.path,env.AUTH_ORIGIN),referrer=referrerHostname(p.referrer,env.AUTH_ORIGIN),source=token(url.searchParams.get('utm_source')),medium=token(url.searchParams.get('utm_medium')),campaign=token(url.searchParams.get('utm_campaign')),content=token(url.searchParams.get('utm_content')),ua=request.headers.get('user-agent')??''
 const inferred=referrer?(/(?:^|\.)(?:google|bing|yahoo|duckduckgo|baidu)\./i.test(referrer)?'organic':'referral'):'none'
 return {source:source??referrer??'direct',medium:medium??(source?'campaign':inferred),...(campaign?{campaign}:{}),...(content?{content}:{}),...(referrer?{referrer}:{}),landingPage:path,device:/ipad|tablet/i.test(ua)?'tablet':/mobile|android|iphone/i.test(ua)?'mobile':ua?'desktop':'unknown',...(region?{region,location:region}:{}),regionSource:'visitor_selected_unverified',consent:'granted',policyVersion,attributionModel:'last_non_direct_click',attributionWindowDays:30,attributedAt:new Date().toISOString()}
}
export async function analyticsCaptureResponse(request:Request,env:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/stall/analytics/events')return null
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST','cache-control':'no-store'}})
 if(request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s storefront.',403)
 const headers=new Headers(),consent=await analyticsConsent(request,env)
 if(!consent) {clearAnalyticsCookies(headers,env.AUTH_ORIGIN);return response({captured:false,reason:excludedAnalytics(request,env)?'excluded_traffic':'consent_limited_unknown'},headers)}
 let p:any;try {p=JSON.parse(await rawBody(request,4096))}catch {fail('INPUT','Supply a small analytics event object.',400)}
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>!['id','kind','path','referrer','sku'].includes(key))||!['visit','product_view','add_to_cart','checkout'].includes(p.kind)||typeof p.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.id))fail('INPUT','Supply a fresh event UUID and supported storefront event.',400)
 if(p.sku!==undefined&&(typeof p.sku!=='string'||!p.sku.trim()||p.sku.length>160))fail('INPUT','Supply a catalog SKU.',400)
 let sku:string|null=null
 if(['product_view','add_to_cart'].includes(p.kind)) {
  if(!p.sku)fail('INPUT','Select a published product for this event.',400)
  const product=await env.DB.prepare("SELECT value_json FROM st_products WHERE json_extract(value_json,'$.active')=1 AND COALESCE(json_extract(value_json,'$.archived'),0)=0 AND json_type(value_json,'$.approval')='object' AND (json_extract(value_json,'$.publishAt') IS NULL OR json_extract(value_json,'$.publishAt')<=?) AND (json_extract(value_json,'$.sku')=? OR EXISTS(SELECT 1 FROM json_each(value_json,'$.details.variants') v WHERE json_extract(v.value,'$.sku')=? AND COALESCE(json_extract(v.value,'$.archived'),0)=0)) LIMIT 1").bind(new Date().toISOString(),p.sku,p.sku).first<{value_json:string}>()
  if(!product)fail('NOT_FOUND','Published product not found.',404)
  sku=p.sku
 }
 if(await env.DB.prepare('SELECT 1 FROM st_analytics_events WHERE id=?').bind(p.id.toLowerCase()).first())return response({captured:false,reason:'duplicate'},headers)
 const now=new Date().toISOString(),cutoff=new Date(Date.now()-analyticsRetentionDays*86400000).toISOString(),fresh=attribution(p,request,env,consent.policyVersion,consent.region)
 let visitorCookie=analyticsCookie(request,analyticsCookieNames.visitor),visitorHash=visitorCookie?await digest(visitorCookie):undefined
 const prior=visitorHash?await env.DB.prepare('SELECT value_json FROM st_analytics_visitors WHERE id_hash=? AND privacy_hash=? AND policy_version=? AND last_at>?').bind(visitorHash,consent.privacyHash,consent.policyVersion,cutoff).first<{value_json:string}>():null
 if(!prior) {visitorCookie=randomAnalyticsId();visitorHash=await digest(visitorCookie)}
 let existing=prior?await analyticsSession(request,env,consent):undefined
 const nonDirect=fresh.source!=='direct',last=prior?JSON.parse(prior.value_json).lastNonDirect as AnalyticsAttribution|undefined:undefined,usableLast=last&&last.attributedAt>cutoff?last:undefined
 if(p.kind==='visit'&&nonDirect&&existing&&['source','medium','campaign','content','referrer'].some(key=>(existing!.value as any)[key]!==((fresh as any)[key])))existing=undefined
 const buyId=new URL(p.path,env.AUTH_ORIGIN).searchParams.get('buy'),buy=buyId?await env.DB.prepare('SELECT value_json FROM st_buy_links WHERE id=? AND revoked_at IS NULL AND restored=0').bind(buyId).first<{value_json:string}>():null,channel=buy?(JSON.parse(buy.value_json).kind?'buy_button':'checkout_link'):'online'
 const chosen=nonDirect?fresh:usableLast?{...usableLast,landingPage:fresh.landingPage,device:fresh.device,region:fresh.region,location:fresh.location,policyVersion:consent.policyVersion}:fresh
 const sessionCookie=existing?.sessionCookie??randomAnalyticsId(),sessionId=existing?.id??await digest(sessionCookie),session:AnalyticsSession=existing?.value??{...chosen,privacyHash:consent.privacyHash,channel}
 const lastNonDirect=nonDirect?fresh:usableLast
 const statements=analyticsRetentionStatements(env.DB)
 statements.push(env.DB.prepare(`INSERT INTO st_analytics_visitors SELECT ?,?,?,?,? WHERE ${consentFence} ON CONFLICT(id_hash) DO UPDATE SET last_at=excluded.last_at,value_json=excluded.value_json WHERE st_analytics_visitors.privacy_hash=excluded.privacy_hash AND st_analytics_visitors.policy_version=excluded.policy_version`).bind(visitorHash!,consent.privacyHash,consent.policyVersion,now,JSON.stringify(lastNonDirect?{lastNonDirect}:{}),...consentValues(consent)))
 statements.push(env.DB.prepare(`INSERT INTO st_analytics_sessions SELECT ?,?,?,?,? WHERE ${consentFence} AND EXISTS(SELECT 1 FROM st_analytics_visitors WHERE id_hash=? AND privacy_hash=? AND policy_version=?) ON CONFLICT(id) DO UPDATE SET last_at=excluded.last_at`).bind(sessionId,visitorHash!,now,now,JSON.stringify(session),...consentValues(consent),visitorHash!,consent.privacyHash,consent.policyVersion))
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO st_analytics_events SELECT ?,?,?,?,? WHERE ${consentFence} AND EXISTS(SELECT 1 FROM st_analytics_sessions WHERE id=? AND visitor_hash=? AND json_extract(value_json,'$.privacyHash')=? AND json_extract(value_json,'$.policyVersion')=? AND COALESCE(json_extract(value_json,'$.restored'),0)=0)`).bind(p.id.toLowerCase(),sessionId,p.kind as AnalyticsKind,now,sku,...consentValues(consent),sessionId,visitorHash!,consent.privacyHash,consent.policyVersion))
 const result=await env.DB.batch(statements),captured=(result.at(-1)?.meta.changes??0)>0
 if(captured) {headers.append('set-cookie',analyticsCookieHeader(analyticsCookieNames.visitor,visitorCookie!,env.AUTH_ORIGIN,analyticsRetentionDays*86400));headers.append('set-cookie',analyticsCookieHeader(analyticsCookieNames.session,sessionCookie,env.AUTH_ORIGIN,analyticsSessionMinutes*60))}
 else clearAnalyticsCookies(headers,env.AUTH_ORIGIN)
 return response({captured,...(!captured?{reason:'consent_changed_or_duplicate'}:{})},headers)
}
