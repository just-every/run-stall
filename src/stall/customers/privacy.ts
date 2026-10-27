import type { Bindings } from '../../auth.server'
import { audit,commit,current,digest,live,systemAudit } from '../access'
import { analyticsErasureStatements,analyticsRevocationStatements } from '../analytics/capture'
import { clearAnalyticsCookies } from '../analytics/model'
import { email,fail,integer,requirePerson,text,type Actor } from '../model'
import { rawBody } from '../stripe'
import { account,customerActor,customerCommit } from './account'
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers}})
async function input(r:Request) {let value:any;try{value=JSON.parse(await rawBody(r,100000))}catch{fail('INPUT','Supply a JSON object.',400)}if(!value||typeof value!=='object'||Array.isArray(value))fail('INPUT','Supply a JSON object.',400);return value}
function origin(r:Request,env:Bindings) {if(r.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s privacy controls.',403)}
async function owner(r:Request,env:Bindings) {const a=await current(r,env);requirePerson(a);if(!['owner','admin'].includes(a.role))fail('FORBIDDEN','Only an owner or administrator may manage customer privacy.',403);if(r.method!=='GET')origin(r,env);await live(env,a);return a}
async function config(env:Bindings) {const r=await env.DB.prepare('SELECT revision,value_json FROM st_customer_privacy_config WHERE id=1').first<any>();return r?{revision:r.revision,...JSON.parse(r.value_json)}:{revision:'initial',policyVersion:'1',mode:'notice_opt_out',optInRegions:[]}}
export async function consentHistory(env:Bindings,a:Actor) {
 const email=a.email.toLowerCase(),history=(await env.DB.prepare('SELECT id,channel,subscribed,source,policy_version AS policyVersion,proof_json,created_at AS createdAt FROM st_customer_consents WHERE email=? ORDER BY seq DESC').bind(email).all<any>()).results.map(({proof_json,...r})=>({...r,subscribed:!!r.subscribed,...(proof_json?{proof:JSON.parse(proof_json)}:{})}))
 const suppressed=(await env.DB.prepare('SELECT channel FROM st_customer_suppressions WHERE email_hash=?').bind(await digest(email)).all<{channel:string}>()).results.map(r=>r.channel)
 await customerCommit(env,a)
 return {email,history,emailMarketing:!suppressed.includes('email')&&(history.find(r=>r.channel==='email')?.subscribed??false),smsMarketing:!suppressed.includes('sms')&&(history.find(r=>r.channel==='sms')?.subscribed??false),necessaryOrderNotices:'separate',downstreamSuppression:'not_connected'}
}
function choices(p:any) {if(Object.keys(p).some(k=>!['emailMarketing','smsMarketing'].includes(k))||typeof p.emailMarketing!=='boolean'||typeof p.smsMarketing!=='boolean')fail('INPUT','Explicitly choose email and SMS marketing separately.',400)}
async function capture(env:Bindings,a:Actor,p:any,source:string) {
 choices(p)
 const cfg=await config(env),stamp=new Date().toISOString(),email=a.email.toLowerCase(),hash=await digest(email),statements:D1PreparedStatement[]=[]
 for(const [channel,subscribed] of [['email',p.emailMarketing],['sms',p.smsMarketing]] as const) {
  statements.push(env.DB.prepare('INSERT INTO st_customer_consents SELECT ?,?,?,?,?,?,NULL,?,COALESCE((SELECT MAX(seq) FROM st_customer_consents),0)+1').bind(crypto.randomUUID(),email,channel,Number(subscribed),source,cfg.policyVersion,stamp))
  statements.push(subscribed?env.DB.prepare('DELETE FROM st_customer_suppressions WHERE email_hash=? AND channel=?').bind(hash,channel):env.DB.prepare('INSERT OR REPLACE INTO st_customer_suppressions VALUES(?,?,?)').bind(hash,channel,stamp))
 }
 await customerCommit(env,a,[...statements,audit(env.DB,a,crypto.randomUUID(),'customer.consent-captured')])
 return consentHistory(env,a)
}
async function visitor(request:Request,env:Bindings,change?:any) {
 if(change)origin(request,env)
 const cfg=await config(env),cookie=request.headers.get('cookie')?.split(';').map(p=>p.trim()).find(p=>p.startsWith('stall_privacy='))?.slice(14),id=cookie&&/^[a-f0-9]{64}$/.test(cookie)?cookie:Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),idHash=await digest(id)
 const stored=await env.DB.prepare('SELECT policy_version,value_json FROM st_customer_visitor_preferences WHERE id_hash=?').bind(idHash).first<any>()
 const prior=stored&&stored.policy_version===cfg.policyVersion?JSON.parse(stored.value_json):null
 const gpc=request.headers.get('sec-gpc')==='1'
 if(change&&(Object.keys(change).some(k=>!['analytics','advertising','doNotSellOrShare','policyVersion','region'].includes(k))||typeof change.analytics!=='boolean'||typeof change.advertising!=='boolean'||typeof change.doNotSellOrShare!=='boolean'||change.policyVersion!==cfg.policyVersion))fail('REVIEW_CHANGED','Review the current privacy policy and choose every category explicitly.',400)
 const value={analytics:change?.analytics??prior?.analytics??false,advertising:gpc?false:change?.advertising??prior?.advertising??false,doNotSellOrShare:gpc||change?.doNotSellOrShare===true||(!change&&prior?.doNotSellOrShare===true),region:change?.region?text(change.region,'Region',10).toUpperCase():prior?.region??'US',regionSelected:change&&Object.hasOwn(change,'region')?!!change.region:prior?.regionSelected===true}
 const mode=cfg.optInRegions.includes(value.region)?'opt_in':cfg.mode
 const invalidate=!value.analytics||!!stored&&stored.policy_version!==cfg.policyVersion,statements:D1PreparedStatement[]=invalidate?analyticsRevocationStatements(env.DB,idHash):[]
 if(change||gpc)statements.push(env.DB.prepare('INSERT INTO st_customer_visitor_preferences VALUES(?,?,?,?) ON CONFLICT(id_hash) DO UPDATE SET policy_version=excluded.policy_version,value_json=excluded.value_json,updated_at=excluded.updated_at').bind(idHash,cfg.policyVersion,JSON.stringify(value),new Date().toISOString()))
 if(change)statements.push(systemAudit(env.DB,'privacy-analytics',value.analytics?'analytics.consent-granted':'analytics.consent-withdrawn','visitor'))
 if(statements.length)await env.DB.batch(statements)
 const result=json({policyVersion:cfg.policyVersion,mode,gpc,regionSource:'visitor_selected_not_geolocated',...value,analyticsAllowed:value.analytics,advertisingAllowed:value.advertising&&!value.doNotSellOrShare,googleConsentMode:{analytics_storage:value.analytics?'granted':'denied',ad_storage:value.advertising&&!value.doNotSellOrShare?'granted':'denied',ad_user_data:value.advertising&&!value.doNotSellOrShare?'granted':'denied',ad_personalization:value.advertising&&!value.doNotSellOrShare?'granted':'denied'},installedPixels:[],serverConversionProviders:[]},200,{'set-cookie':`stall_privacy=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(env.AUTH_ORIGIN).protocol==='https:'?'; Secure':''}`})
 if(invalidate)clearAnalyticsCookies(result.headers,env.AUTH_ORIGIN)
 return result
}
async function importConsent(request:Request,env:Bindings,p:any) {
 const a=await owner(request,env)
 if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>200)fail('INPUT','Import 1 to 200 consent records.',400)
 const cfg=await config(env),statements:D1PreparedStatement[]=[]
 for(const row of p.rows) {
  const address=email(row.email),channel=row.channel
  if(!['email','sms'].includes(channel)||!['subscribed','unsubscribed','unknown'].includes(row.status))fail('INPUT','Choose email/SMS and subscribed/unsubscribed/unknown.',400)
  let proof:any=null
  if(row.status==='subscribed') {
   const p=row.proof??{},at=text(p.at,'Proof timestamp',40)
   if(!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now())fail('INPUT','Subscribed imports require a dated prior consent proof.',400)
   proof={source:text(p.source,'Proof source',100),at:new Date(at).toISOString(),reference:text(p.reference,'Proof reference',500),verification:'owner_supplied_proof'}
  }
  const hash=await digest(address),suppressed=!!await env.DB.prepare('SELECT 1 FROM st_customer_suppressions WHERE email_hash=? AND channel=?').bind(hash,channel).first(),subscribed=row.status==='subscribed'&&!suppressed,stamp=new Date().toISOString()
  // Repeat the suppression fence inside the transaction; an erasure racing
  // this reviewed import cannot reactivate old marketing authority.
  statements.push(env.DB.prepare(`INSERT INTO st_customer_consents SELECT ?,?,?,CASE WHEN ?=1 AND NOT EXISTS(SELECT 1 FROM st_customer_suppressions WHERE email_hash=? AND channel=?) THEN 1 ELSE 0 END,'import',?,?,?,COALESCE((SELECT MAX(seq) FROM st_customer_consents),0)+1`).bind(crypto.randomUUID(),address,channel,Number(subscribed),hash,channel,cfg.policyVersion,proof?JSON.stringify(proof):null,stamp))
  if(row.status==='unsubscribed')statements.push(env.DB.prepare('INSERT OR IGNORE INTO st_customer_suppressions VALUES(?,?,?)').bind(hash,channel,stamp))
 }
 await commit(env.DB,a,[...statements,audit(env.DB,a,crypto.randomUUID(),'customer.consent-imported')])
 return {imported:p.rows.length,downstream:'not_connected',proofLabel:'Owner supplied; not provider verified'}
}
async function privacyRequest(env:Bindings,a:Actor,p:any) {
 if(!['export','erasure'].includes(p.kind)||Object.keys(p).some(k=>k!=='kind'))fail('INPUT','Choose an export or erasure request.',400)
 const mine=await account(env,a),id=crypto.randomUUID(),at=new Date().toISOString(),value={retainedFinancialOrderIds:mine.orders.filter(o=>['paid','reserved','shipped','shortfall'].includes(o.status)).map(o=>o.id),providerFollowUp:['The owner must review Stripe and Pier records separately; this request sends no provider action.'],message:'Owner review required. Financial records remain; this request does not delete an account or send mail.'}
 await customerCommit(env,a,[env.DB.prepare('INSERT INTO st_customer_privacy_requests VALUES(?,?,?,\'requested\',?,?,NULL)').bind(id,a.email.toLowerCase(),p.kind,JSON.stringify(value),at),audit(env.DB,a,id,'customer.privacy-requested')])
 return {id,kind:p.kind,status:'requested',...value}
}
export async function privacyResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path==='/api/stall/privacy'&&['GET','POST'].includes(request.method))return visitor(request,env,request.method==='POST'?await input(request):undefined)
 if(path==='/api/stall/privacy/config') {
  const a=await owner(request,env)
  if(request.method==='GET')return json(await config(env))
  if(request.method==='POST') {
   const p=await input(request),old=await config(env)
   if(p.revision!==old.revision||!['notice_opt_out','opt_in'].includes(p.mode)||!Array.isArray(p.optInRegions)||p.optInRegions.length>100)fail('INPUT','Review current settings, a valid mode and region list.',400)
   const value={policyVersion:String(integer(Number(old.policyVersion)+1,'Policy version',1,100000000)),mode:p.mode,optInRegions:p.optInRegions.map((r:any)=>text(r,'Region',10).toUpperCase())}
   await commit(env.DB,a,[env.DB.prepare('INSERT INTO st_customer_privacy_config VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value_json=excluded.value_json WHERE st_customer_privacy_config.revision=?').bind(crypto.randomUUID(),JSON.stringify(value),old.revision),env.DB.prepare('INSERT INTO st_guard VALUES(changes())'),audit(env.DB,a,'privacy-policy','customer.privacy-policy-saved')]);return json(await config(env))
  }
 }
 const sources:Record<string,string>={'/api/stall/account/consent':'account','/api/stall/checkout/consent':'checkout','/api/stall/newsletter/consent':'newsletter','/api/stall/contact/consent':'contact','/api/stall/popup/consent':'popup'}
 if(sources[path]) {const a=await customerActor(request,env);if(request.method==='GET')return json(await consentHistory(env,a));if(request.method==='POST')return json(await capture(env,a,await input(request),sources[path]))}
 if(path==='/api/stall/account/export'&&request.method==='GET') {const a=await customerActor(request,env);return json({schema:'stall-customer-export-v1',account:await account(env,a),consent:await consentHistory(env,a),excluded:'Staff notes/tags, other mailbox records, credentials and provider authority.'})}
 if(path==='/api/stall/account/privacy-requests') {
  const a=await customerActor(request,env)
  if(request.method==='POST')return json(await privacyRequest(env,a,await input(request)))
  if(request.method==='GET') {const records=await env.DB.prepare('SELECT id,kind,status,value_json,created_at AS createdAt,completed_at AS completedAt FROM st_customer_privacy_requests WHERE email=? ORDER BY created_at DESC').bind(a.email.toLowerCase()).all<any>();await customerCommit(env,a);return json({requests:records.results.map(({value_json,...r})=>({...r,...JSON.parse(value_json)}))})}
 }
 if(path==='/api/stall/customers/consent/import'&&request.method==='POST')return json(await importConsent(request,env,await input(request)))
 if(path==='/api/stall/customers/privacy-requests'&&request.method==='GET') {await owner(request,env);const records=await env.DB.prepare('SELECT * FROM st_customer_privacy_requests ORDER BY created_at DESC').all<any>();return json({requests:records.results.map(({value_json,...r})=>({...r,...JSON.parse(value_json)}))})}
 return null
}
export async function privacyErasureStatements(db:D1Database,email:string) {
 const hash=await digest(email),at=new Date().toISOString()
 return [...analyticsErasureStatements(db,email),db.prepare("INSERT OR REPLACE INTO st_customer_suppressions VALUES(?,'email',?)").bind(hash,at),db.prepare("INSERT OR REPLACE INTO st_customer_suppressions VALUES(?,'sms',?)").bind(hash,at),db.prepare('DELETE FROM st_customer_consents WHERE email=?').bind(email),db.prepare("UPDATE st_customer_privacy_requests SET email=NULL,status='erased',completed_at=? WHERE email=? AND kind='erasure'").bind(at,email),db.prepare("UPDATE st_customer_privacy_requests SET email=NULL WHERE email=?").bind(email)]
}
export async function privacyBusinessRecords(db:D1Database) {
 const [history,suppressions,requests,settings,visitors]=await Promise.all([db.prepare('SELECT * FROM st_customer_consents ORDER BY created_at,id').all(),db.prepare('SELECT email_hash,channel,created_at FROM st_customer_suppressions ORDER BY email_hash,channel').all(),db.prepare('SELECT * FROM st_customer_privacy_requests ORDER BY created_at,id').all(),db.prepare('SELECT * FROM st_customer_privacy_config').all(),db.prepare('SELECT policy_version,value_json,updated_at FROM st_customer_visitor_preferences ORDER BY id_hash').all()])
 return {history:history.results,suppressions:suppressions.results,requests:requests.results,settings:settings.results,visitorPreferences:visitors.results}
}
