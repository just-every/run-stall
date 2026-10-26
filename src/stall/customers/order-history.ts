import type { Bindings } from '../../auth.server'
import { audit,commit,digest } from '../access'
import { email,fail,integer,Problem,text,type Actor } from '../model'
import { rawBody } from '../stripe'
import { addressValue,customerCommit,requireProvenEmail } from './account'
import { directoryAuthority } from './directory'

type HistoryLine={sku:string;name:string;quantity:number;unitCents:number}
export type HistoricalOrder={id:string;createdAt:string;status:string;totalCents:number;currency:'usd';paid:boolean;lines:HistoryLine[];shippingCents:number;taxCents:number;shippingDetails?:{name:string;address:ReturnType<typeof addressValue>};refunds:{id:string;status:string;amountCents:number;lines:never[]}[];shipment:null|{status:string;dispatches:{shippedAt:string;deliveryStatus:string;tracking:{trackingCode?:string;trackingUrl?:string}[]}[]};source:{system:string;recordId:string};imported:true}
type Row={id:string;source_key:string;email:string|null;revision:string;value_json:string}
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}})
function exact(value:any,keys:string[]) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('INPUT','Use only the documented historical order fields.',400)
}
// Identity remains case-sensitive and exact. Whitespace in a source reference
// is significant; mailbox normalization never changes source identity.
function reference(value:unknown,label:string,max:number) {text(value,label,max);return value as string}
function stamp(value:unknown) {
 const input=text(value,'Order timestamp',40),parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(input)
 if(!parts)fail('INPUT','Use an ISO timestamp with seconds and an explicit timezone offset.',400)
 const [,year,month,day,hour,minute,second,,offsetHour,offsetMinute]=parts
 const y=Number(year),m=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0)
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31]
 if(m<1||m>12||d<1||d>days[m-1]||Number(hour)>23||Number(minute)>59||Number(second)>59||Number(offsetHour??0)>23||Number(offsetMinute??0)>59||!Number.isFinite(Date.parse(input)))fail('INPUT','Use a valid ISO calendar timestamp and timezone offset.',400)
 return new Date(input).toISOString()
}
function tracking(value:any):HistoricalOrder['shipment'] {
 if(value===undefined)return null
 exact(value,['shippedAt','deliveryStatus','trackingCode','trackingUrl'])
 let trackingUrl:string|undefined
 if(value.trackingUrl!==undefined) {
  try {
   const url=new URL(text(value.trackingUrl,'Tracking URL',1000))
   if(url.protocol!=='https:'||url.username||url.password)fail('INPUT','Use a secure tracking link without credentials.',400)
   trackingUrl=url.href
  } catch(error) {if(error instanceof Problem)throw error;fail('INPUT','Use a valid secure tracking link.',400)}
 }
 return {status:'shipped',dispatches:[{shippedAt:stamp(value.shippedAt),deliveryStatus:text(value.deliveryStatus,'Delivery status',100),tracking:[{...(value.trackingCode!==undefined?{trackingCode:text(value.trackingCode,'Tracking code',200)}:{}),...(trackingUrl?{trackingUrl}:{})}]}]}
}
async function normalize(p:any) {
 exact(p,['source','rows','fingerprint','confirmed'])
 const source=reference(p.source,'Source system',100)
 if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>200)fail('INPUT','Import 1 to 200 historical orders.',400)
 const keys=new Set<string>()
 return Promise.all(p.rows.map(async(r:any)=>{
  exact(r,['recordId','email','createdAt','status','paid','lines','shippingCents','taxCents','totalCents','address','refunds','tracking'])
  const recordId=reference(r.recordId,'Source order reference',200),sourceKey=await digest(JSON.stringify([source,recordId])),mailbox=email(r.email)
  if(keys.has(sourceKey))fail('INPUT','Each source order may appear only once in an import.',400)
  keys.add(sourceKey)
  if(typeof r.paid!=='boolean'||!['processing','paid','shipped','cancelled','refunded','partially_refunded'].includes(r.status))fail('INPUT','State whether the source order was paid and use a documented order status.',400)
  if(!Array.isArray(r.lines)||!r.lines.length||r.lines.length>100)fail('INPUT','Historical orders need 1 to 100 purchased lines.',400)
  const lines:HistoryLine[]=r.lines.map((line:any)=>{
   exact(line,['sku','name','quantity','unitCents'])
   return {sku:text(line.sku,'SKU',100),name:text(line.name,'Purchased product name',200),quantity:integer(line.quantity,'Quantity',1,1000000),unitCents:integer(line.unitCents,'Original unit cents',0,99999999)}
  })
  const shippingCents=integer(r.shippingCents??0,'Shipping cents',0,99999999),taxCents=integer(r.taxCents??0,'Tax cents',0,99999999),totalCents=integer(r.totalCents,'Original total cents',0,99999999)
  if(lines.reduce((sum,line)=>sum+line.quantity*line.unitCents,shippingCents+taxCents)!==totalCents)fail('TOTAL_MISMATCH','Historical lines, shipping and tax must reconcile to the original total. Resolve unsupported discounts in the source before importing.',400)
  if(r.refunds!==undefined&&(!Array.isArray(r.refunds)||r.refunds.length>100))fail('INPUT','Supply at most 100 historical refund rows.',400)
  const refundIds=new Set<string>()
  const refunds=(r.refunds??[]).map((refund:any)=>{
   exact(refund,['recordId','status','amountCents'])
   const id=reference(refund.recordId,'Refund reference',200)
   if(refundIds.has(id))fail('INPUT','Each source refund may appear only once per order.',400)
   refundIds.add(id)
   if(!['pending','succeeded','failed'].includes(refund.status))fail('INPUT','Use a documented refund status.',400)
   return {id,status:refund.status,amountCents:integer(refund.amountCents,'Refund cents',1,99999999),lines:[] as never[]}
  })
  if(refunds.filter((refund:{status:string})=>refund.status==='succeeded').reduce((sum:number,refund:{amountCents:number})=>sum+refund.amountCents,0)>totalCents)fail('TOTAL_MISMATCH','Completed refunds exceed the historical order total.',400)
  if(!r.paid&&refunds.some((refund:{status:string})=>refund.status==='succeeded'))fail('TOTAL_MISMATCH','An unpaid historical order cannot have completed refunds.',400)
  let shippingDetails:HistoricalOrder['shippingDetails']
  if(r.address!==undefined) {
   exact(r.address,['name','line1','line2','city','state','postal_code','country'])
   const address=addressValue(r.address)
   shippingDetails={name:address.name,address}
  }
  const value:HistoricalOrder={id:'history-'+sourceKey,createdAt:stamp(r.createdAt),status:r.status,totalCents,currency:'usd',paid:r.paid,lines,shippingCents,taxCents,...(shippingDetails?{shippingDetails}:{}),refunds,shipment:tracking(r.tracking),source:{system:source,recordId},imported:true}
  return {id:value.id,sourceKey,email:mailbox,value}
 }))
}
async function preview(env:Bindings,actor:Actor,p:any) {
 directoryAuthority(actor,true)
 const rows=await normalize(p)
 // Batch gives the revision and facts one transactional snapshot. The same
 // revision is checked inside apply's write transaction, before its first row.
 const [state,stored]=await env.DB.batch<{revision:number}&Row>([
  env.DB.prepare('SELECT revision FROM st_customer_order_history_state WHERE id=1'),
  env.DB.prepare('SELECT id,source_key,email,revision,value_json FROM st_customer_order_history ORDER BY id'),
 ])
 const revision=state.results[0].revision,existing=new Map(stored.results.map(row=>[row.source_key,row]))
 const result=rows.map(row=>{
  const old=existing.get(row.sourceKey)
  if(old&&(old.id!==row.id||old.email!==row.email||old.value_json!==JSON.stringify(row.value)))fail('HISTORY_CONFLICT','A source order already has different or erased facts. Preserve it and reconcile the source before another import.')
  return {...row,duplicate:!!old}
 })
 await commit(env.DB,actor,[])
 return {rows:result,revision,fingerprint:await digest(JSON.stringify({rows:result,revision})),newCount:result.filter(row=>!row.duplicate).length,duplicateCount:result.filter(row=>row.duplicate).length}
}
export async function historyImport(env:Bindings,actor:Actor,p:any,apply=false) {
 const checked=await preview(env,actor,p)
 if(!apply)return checked
 if(p.confirmed!==true||p.fingerprint!==checked.fingerprint)fail('REVIEW_CHANGED','Explicitly approve this exact current historical import preview; nothing was imported.')
 const statements=[env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_customer_order_history_state WHERE id=1 AND revision=?) THEN 1 ELSE 0 END').bind(checked.revision)]
 for(const row of checked.rows.filter(row=>!row.duplicate))statements.push(
  env.DB.prepare('INSERT INTO st_customer_order_history(id,source_key,email,revision,value_json) VALUES(?,?,?,?,?)').bind(row.id,row.sourceKey,row.email,crypto.randomUUID(),JSON.stringify(row.value)),
  audit(env.DB,actor,row.id,'customer.history-imported'),
 )
 try {await commit(env.DB,actor,statements)}catch(error) {
  await commit(env.DB,actor,[])
  const current=await env.DB.prepare('SELECT revision FROM st_customer_order_history_state WHERE id=1').first<{revision:number}>()
  if(current?.revision!==checked.revision)fail('REVIEW_CHANGED','Historical records changed. Preview and approve the import again; nothing was imported.')
  throw error
 }
 return {imported:checked.newCount,duplicates:checked.duplicateCount}
}
export async function historicalOrders(db:D1Database,mailbox:string) {
 return (await db.prepare("SELECT value_json FROM st_customer_order_history WHERE email=? ORDER BY json_extract(value_json,'$.createdAt') DESC,id DESC").bind(email(mailbox)).all<{value_json:string}>()).results.map(row=>JSON.parse(row.value_json) as HistoricalOrder)
}
export async function ownHistoricalOrder(env:Bindings,actor:Actor,id:string) {
 if(actor.agent||!actor.sessionId)fail('CUSTOMER_AUTH','Use your independently verified native customer session.',401)
 await requireProvenEmail(env,actor.sessionId,actor.id)
 const row=await env.DB.prepare('SELECT * FROM st_customer_order_history WHERE id=? AND email=?').bind(id,email(actor.email)).first<Row>()
 if(!row)fail('NOT_FOUND','Order not found.',404)
 await customerCommit(env,actor)
 return {row,order:JSON.parse(row.value_json) as HistoricalOrder}
}
export function historicalGuard(env:Bindings,actor:Actor,row:Row) {
 return env.DB.prepare("INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_customer_order_history WHERE id=? AND email=? AND revision=? AND json_extract(value_json,'$.paid')=1) THEN 1 ELSE 0 END").bind(row.id,email(actor.email),row.revision)
}
export async function historyImportResponse(request:Request,env:Bindings,actor:Actor) {
 const path=new URL(request.url).pathname
 if(!['/api/stall/customers/history/preview','/api/stall/customers/history/apply'].includes(path))return null
 directoryAuthority(actor,true)
 if(request.method!=='POST')fail('METHOD','Use POST.',405)
 if(request.headers.get('origin')!==env.AUTH_ORIGIN||request.headers.get('sec-fetch-site')==='cross-site')fail('ORIGIN','Use this shop’s customer history import.',403)
 let p:any
 try {p=JSON.parse(await rawBody(request,1000000))}catch(error){if(error instanceof Problem)throw error;fail('INPUT','Supply the documented historical export.',400)}
 return json(await historyImport(env,actor,p,path.endsWith('/apply')))
}
export function historyErasureStatements(db:D1Database,mailbox:string) {
 return [db.prepare(`UPDATE st_customer_order_history SET email=NULL,revision=lower(hex(randomblob(16))),value_json=json_remove(json_set(value_json,'$.source.recordId','Erased with customer contact','$.refunds',json((SELECT json_group_array(json_object('id','erased-refund-'||r.key,'status',json_extract(r.value,'$.status'),'amountCents',json_extract(r.value,'$.amountCents'),'lines',json('[]'))) FROM json_each(st_customer_order_history.value_json,'$.refunds') r))),'$.shippingDetails','$.shipment') WHERE email=?`).bind(email(mailbox))]
}
export async function historyBusinessRecords(db:D1Database) {
 return (await db.prepare('SELECT id,source_key,email,revision,value_json FROM st_customer_order_history ORDER BY id').all<Row>()).results.map(({value_json,...row})=>({...row,value:JSON.parse(value_json) as HistoricalOrder}))
}
