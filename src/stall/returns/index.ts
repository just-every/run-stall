import type { Bindings } from '../../auth.server'
import { audit,changed,commit,current,digest,live } from '../access'
import { fail,integer,requirePerson,text } from '../model'
import { body,json } from '../headless/common'
import { readOrder } from '../store'
import { staffReturns } from './decide'

type Receipt={id:string;request_id:string;order_id:string;source_revision:string;lines_json:string;fingerprint:string;received_by:string;created_at:string}
const present=({fingerprint,lines_json,...receipt}:Receipt)=>({...receipt,lines:JSON.parse(lines_json),stockStatus:'Inspection and stock handling remain separate; no stock or money moved.'})

/** Confirmation records an explicit human observation, never a processor,
 * carrier or warehouse success. Stock follow-up is a separate workflow task. */
export async function returnsResponse(request:Request,env:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/stall/returns') return null
 const actor=await current(request,env);requirePerson(actor)
 if(!['owner','admin'].includes(actor.role)) fail('FORBIDDEN','Only an owner or administrator confirms received returns.',403)
 if(request.method==='GET') {
  const [requests,receipts]=await Promise.all([
   env.DB.prepare(`SELECT r.id,r.order_id AS orderId,r.created_at AS requestedAt FROM st_workflow_requests r JOIN st_orders o ON o.id=r.order_id WHERE r.kind='return' AND json_extract(o.value_json,'$.erasedAt') IS NULL ORDER BY r.created_at DESC,r.id LIMIT 100`).all(),
   env.DB.prepare(`SELECT r.* FROM st_return_receipts r JOIN st_orders o ON o.id=r.order_id WHERE json_extract(o.value_json,'$.erasedAt') IS NULL ORDER BY r.created_at DESC,r.id LIMIT 100`).all<Receipt>(),
  ])
  await live(env,actor);return json({requests:requests.results,receipts:receipts.results.map(present),limit:100,...await staffReturns(env,actor)})
 }
 if(request.method!=='POST') return json({error:{code:'METHOD',message:'Use GET or POST.'}},405)
 if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this installation’s staff page.',403)
 const p=await body(request),requestId=text(p.requestId,'Return request ID',100),revision=text(p.orderRevision,'Reviewed order revision',100)
 const source=await env.DB.prepare("SELECT order_id FROM st_workflow_requests WHERE id=? AND kind='return'").bind(requestId).first<{order_id:string}>()
 if(!source) fail('NOT_FOUND','Return request not found.',404)
 const order=await readOrder(env.DB,source.order_id)
 if(order.erasedAt) fail('NOT_FOUND','Return request not found.',404)
 if(!order.payment||order.shipment?.status!=='shipped') fail('RETURN_STATE','Only an order with a recorded payment and completed shipment can have goods confirmed received.')
 if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>order.lines.length) fail('INPUT','Choose the purchased lines and quantities received.',400)
 const seen=new Set<string>(),lines=p.lines.map((line:any)=>{
  const sku=text(line?.sku,'Purchased SKU',100),quantity=integer(line?.quantity,'Received quantity',1,1000000),purchased=order.lines.find(l=>l.sku===sku)
  if(seen.has(sku)||!purchased||quantity>purchased.quantity) fail('INPUT','Received lines must be unique purchased SKUs within their original quantities.',400)
  seen.add(sku);return {sku,quantity}
 }).sort((a:{sku:string},b:{sku:string})=>a.sku.localeCompare(b.sku))
 const fingerprint=await digest(JSON.stringify({revision,lines})),previous=await env.DB.prepare('SELECT * FROM st_return_receipts WHERE request_id=?').bind(requestId).first<Receipt>()
 if(previous) {
  await live(env,actor)
  if(previous.fingerprint!==fingerprint) fail('RETURN_RECORDED','This request already has a different received-goods record. It cannot be replaced.')
  return json(present(previous))
 }
 if(order.revision!==revision) fail('CHANGED','The order changed. Review its current purchased lines and shipment before confirming.')
 const id=crypto.randomUUID(),at=new Date().toISOString()
 try {
  await commit(env.DB,actor,[
   env.DB.prepare(`INSERT INTO st_return_receipts(id,request_id,order_id,source_revision,lines_json,fingerprint,received_by,created_at) SELECT ?,?,?,?,?,?,?,? FROM st_orders o JOIN st_workflow_requests r ON r.order_id=o.id WHERE o.id=? AND o.revision=? AND json_extract(o.value_json,'$.erasedAt') IS NULL AND json_extract(o.value_json,'$.shipment.status')='shipped' AND r.id=? AND r.kind='return'`).bind(id,requestId,order.id,revision,JSON.stringify(lines),fingerprint,actor.id,at,order.id,revision,requestId),
   changed(env.DB),audit(env.DB,actor,order.id,'return.goods-received'),
  ])
 } catch(error) {
  const winner=await env.DB.prepare('SELECT * FROM st_return_receipts WHERE request_id=?').bind(requestId).first<Receipt>()
  if(!winner||winner.fingerprint!==fingerprint) throw error
  await live(env,actor);return json(present(winner))
 }
 return json(present((await env.DB.prepare('SELECT * FROM st_return_receipts WHERE id=?').bind(id).first<Receipt>())!),201)
}
