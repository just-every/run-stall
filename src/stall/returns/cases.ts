import type { Bindings } from '../../auth.server'
import { clientKey,digest } from '../access'
import { customerActor,customerCommit,ownOrder } from '../customers/account'
import { guestOrder,guestOrderGuard } from '../customers/guest-orders'
import { rate } from '../headless/auth'
import { body } from '../headless/common'
import { fail,integer,text } from '../model'
import { eligibility,type CaseLine,type CaseRow } from './eligibility'
import { loadPolicy,policyView,reasons } from './policy'

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'}})
type Row=CaseRow&{email:string;channel:string;revision:string;note:string|null;created_at:string;decided_at:string|null;decision_note:string|null;decided_by:string|null;reservation_json:string|null;policy_json:string}
const received={cancellation:'Request received. A person reviews it; nothing is canceled or refunded until they decide.',return:'Request received. A person reviews it and explains the decision. No refund is made until the goods are received and reviewed.',exchange:'Request received. A person reviews it; replacement stock is set aside only if they accept.'}
/** Customer-safe: no staff identity, no payment reference, no other customer's data. */
export async function customerCases(db:D1Database,orderIds:string[]) {
 if(!orderIds.length) return []
 const ids=JSON.stringify(orderIds)
 const [rows,events,files]=await Promise.all([
  db.prepare('SELECT * FROM st_return_cases WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id').bind(ids).all<Row>(),
  db.prepare('SELECT case_id,at,text FROM st_return_events WHERE case_id IN (SELECT id FROM st_return_cases WHERE order_id IN (SELECT value FROM json_each(?))) ORDER BY at,rowid').bind(ids).all<{case_id:string;at:string;text:string}>(),
  db.prepare('SELECT id,case_id,name,size FROM st_return_files WHERE case_id IN (SELECT id FROM st_return_cases WHERE order_id IN (SELECT value FROM json_each(?))) ORDER BY created_at,id').bind(ids).all<{id:string;case_id:string;name:string;size:number}>(),
 ])
 return rows.results.map(row=>({id:row.id,orderId:row.order_id,kind:row.kind,state:row.state,lines:JSON.parse(row.lines_json) as CaseLine[],note:row.note,createdAt:row.created_at,decidedAt:row.decided_at,decision:row.decision_note,
  replacementReserved:!!row.reservation_json,attachments:files.results.filter(f=>f.case_id===row.id).map(({id,name,size})=>({id,name,size})),progress:events.results.filter(e=>e.case_id===row.id).map(({at,text})=>({at,text}))}))
}
export async function subject(request:Request,env:Bindings,orderId:string,mutation:boolean) {
 await rate(env,'returns:'+await clientKey(env,request),120)
 const token=request.headers.get('x-stall-order-token')
 if(token!==null) {
  if(request.headers.has('authorization'))fail('CUSTOMER_AUTH','Use the native account or private order link.',401)
  if(request.headers.has('origin')&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s own order page.',403)
  const access=await guestOrder(env,token,orderId),guard=guestOrderGuard(env,access)
  return {order:access.order,channel:'guest_link' as const,actor:'guest-link',write:(statements:D1PreparedStatement[])=>env.DB.batch([guard,...statements,env.DB.prepare('DELETE FROM st_guard')])}
 }
 const actor=await customerActor(request,env),order=await ownOrder(env,actor,orderId)
 if(mutation&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s own account page.',403)
 const guard=env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_orders WHERE id=? AND revision=? AND lower(json_extract(value_json,'$.customerEmail'))=? AND json_extract(value_json,'$.erasedAt') IS NULL AND json_extract(value_json,'$.payment') IS NOT NULL) THEN 1 ELSE 0 END`).bind(order.id,order.revision,actor.email.toLowerCase())
 return {order,channel:'account' as const,actor:'customer:'+actor.id,write:(statements:D1PreparedStatement[])=>customerCommit(env,actor,[guard,...statements])}
}
const orderCases=(db:D1Database,orderId:string)=>db.prepare('SELECT * FROM st_return_cases WHERE order_id=?').bind(orderId).all<Row>().then(r=>r.results)
const keys=(p:any,allowed:string[],label:string)=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>!allowed.includes(key)))fail('INPUT',`Supply only ${label}.`,400)}
async function request(env:Bindings,request:Request) {
 const p=await body(request);keys(p,['orderId','kind','lines','note','attachments'],'the order, request kind, lines, an optional note and uploaded photos')
 const orderId=text(p.orderId,'Order ID',100),kind=p.kind
 if(!['cancellation','return','exchange'].includes(kind))fail('INPUT','Choose a cancellation, return or exchange.',400)
 const who=await subject(request,env,orderId,true),{order}=who
 if(!order.payment)fail('PAST_ORDER_REQUIRED','Only a paid order can have a request.')
 const stored=await loadPolicy(env.DB),policy=stored?.value??null,cases=await orderCases(env.DB,order.id)
 const view=await eligibility(env,order,policy,cases)
 let lines:CaseLine[]
 if(kind==='cancellation') {
  if(p.lines!==undefined&&(!Array.isArray(p.lines)||p.lines.length))fail('INPUT','A cancellation covers the whole order; send no lines.',400)
  if(!view.cancellation.eligible)fail('NOT_ELIGIBLE',view.cancellation.reason!)
  lines=order.lines.map(({sku,name,quantity})=>({sku,name,quantity}))
 } else {
  if(!policy)fail('RETURN_POLICY_UNSET','This shop has not published its return policy yet, so it cannot take return or exchange requests. Contact the shop.')
  if(kind==='exchange'&&!policy.exchanges)fail('NOT_ELIGIBLE','This shop does not offer exchanges. You can request a return instead.')
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>order.lines.length)fail('INPUT','Choose the purchased lines to send back.',400)
  const seen=new Set<string>()
  lines=p.lines.map((raw:any)=>{
   keys(raw,kind==='exchange'?['sku','quantity','reason','toSku']:['sku','quantity','reason'],'a SKU, quantity, reason and, for an exchange, the replacement SKU')
   const sku=text(raw.sku,'SKU',100),line=view.lines.find(l=>l.sku===sku),quantity=integer(raw.quantity,'Quantity',1,1000000)
   if(!line||seen.has(sku))fail('INPUT','Choose each purchased line once.',400)
   seen.add(sku)
   if(!line.eligible)fail('NOT_ELIGIBLE',`${line.name}: ${line.reasons[0]}`)
   if(quantity>line.remaining)fail('NOT_ELIGIBLE',`${line.name}: only ${line.remaining} unit${line.remaining===1?'':'s'} can still be requested.`)
   if(typeof raw.reason!=='string'||!(raw.reason in reasons))fail('INPUT','Choose a reason for each line.',400)
   if(kind==='return')return {sku,name:line.name,quantity,reason:raw.reason}
   const option=line.exchangeOptions.find(o=>o.sku===raw.toSku)
   if(!option)fail('NOT_ELIGIBLE',`${line.name}: choose a replacement that is currently in stock.`)
   if(quantity>option.availableQuantity)fail('NOT_ELIGIBLE',`${line.name}: only ${option.availableQuantity} of ${option.name} ${option.availableQuantity===1?'is':'are'} available to exchange.`)
   return {sku,name:line.name,quantity,reason:raw.reason,toSku:option.sku,toName:option.name}
  })
 }
 const note=p.note===undefined||p.note===''?null:text(p.note,'Note',500)
 const attached:string[]=p.attachments===undefined?[]:Array.isArray(p.attachments)&&p.attachments.length<=3&&(kind!=='cancellation'||!p.attachments.length)?[...new Set<string>(p.attachments.map((id:unknown)=>text(id,'Photo',100)))]:fail('INPUT','Attach at most three photos to a return or exchange.',400)
 if(attached.length&&(await env.DB.prepare('SELECT count(*) AS n FROM st_return_files WHERE order_id=? AND case_id IS NULL AND id IN (SELECT value FROM json_each(?))').bind(order.id,JSON.stringify(attached)).first<{n:number}>())?.n!==attached.length)fail('NOT_FOUND','An attached photo is missing. Upload it again.',404)
 const fingerprint=await digest(JSON.stringify([order.id,kind,lines.map(l=>[l.sku,l.quantity,l.toSku??null]).sort()])),id=crypto.randomUUID(),at=new Date().toISOString()
 const open=cases.filter(c=>['requested','accepted'].includes(c.state)).length
 await who.write([
  env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM st_return_cases WHERE order_id=? AND state IN (\'requested\',\'accepted\'))=? THEN 1 ELSE 0 END').bind(order.id,open),
  env.DB.prepare('INSERT OR IGNORE INTO st_return_cases(id,order_id,kind,email,channel,fingerprint,revision,state,lines_json,note,policy_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,order.id,kind,order.customerEmail!.toLowerCase(),who.channel,fingerprint,crypto.randomUUID(),'requested',JSON.stringify(lines),note,JSON.stringify(policy??{}),at),
  env.DB.prepare('INSERT INTO st_return_events(id,case_id,at,text) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM st_return_cases WHERE id=?)').bind(crypto.randomUUID(),id,at,received[kind as keyof typeof received],id),
  env.DB.prepare('UPDATE st_return_files SET case_id=? WHERE order_id=? AND case_id IS NULL AND id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM st_return_cases WHERE id=?)').bind(id,order.id,JSON.stringify(attached),id),
  env.DB.prepare('INSERT OR IGNORE INTO st_workflow_requests(id,order_id,kind,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM st_return_cases WHERE id=?)').bind(id,order.id,kind==='cancellation'?'cancellation':'return',at,id),
  env.DB.prepare('INSERT INTO st_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM st_return_cases WHERE id=?)').bind(crypto.randomUUID(),order.id,who.actor,kind+'.requested',at,id),
 ])
 const found=await env.DB.prepare('SELECT id FROM st_return_cases WHERE fingerprint=?').bind(fingerprint).first<{id:string}>()
 const [saved]=await customerCases(env.DB,[order.id]).then(all=>all.filter(c=>c.id===found?.id))
 return json({case:saved,duplicate:found?.id!==id,message:found?.id===id?received[kind as keyof typeof received]:'You already sent this request. Its current progress is shown.'},found?.id===id?201:200)
}
export async function caseResponse(req:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(req.url)
 if(url.pathname==='/api/stall/return-policy') {
  if(req.method!=='GET')fail('METHOD','Use GET.',405)
  return json(policyView(await loadPolicy(env.DB)))
 }
 if(url.pathname==='/api/stall/returns/eligibility') {
  if(req.method!=='GET')fail('METHOD','Use GET.',405)
  const who=await subject(req,env,text(url.searchParams.get('orderId'),'Order ID',100),false),stored=await loadPolicy(env.DB)
  const [view,cases]=await Promise.all([eligibility(env,who.order,stored?.value??null,await orderCases(env.DB,who.order.id)),customerCases(env.DB,[who.order.id])])
  return json({policy:policyView(stored),...view,cases})
 }
 if(url.pathname==='/api/stall/returns/requests') {
  if(req.method!=='POST')fail('METHOD','Use POST.',405)
  return request(env,req)
 }
 return null
}
