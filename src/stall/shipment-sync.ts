import type { Bindings } from '../auth.server'
import { fail, Problem, type Actor, type Order, type PierDispatch } from './model'
import { assertOriginalPier, decimal, pierState } from './pier'
import { saveOrder } from './store'
import { observePierWork } from './pier-work'

const plain = (value:unknown):string|undefined => typeof value==='string'&&value.length<=500?value:undefined
function trackingUrl(value:unknown) {
 try { const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password?url.href:undefined }catch { return undefined }
}
function dispatchRecord(value:any):PierDispatch {
 return {id:value.id,reference:value.reference,
  ...(typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))?{shippedAt:value.createdAt}:{}),
  ...(plain(value.deliveryStatus)?{deliveryStatus:plain(value.deliveryStatus)}:{}),
  tracking:Array.isArray(value.tracking)?value.tracking.map((t:any)=>({
   ...(Number.isSafeInteger(t?.carton)?{carton:t.carton}:{}),
   ...(plain(t?.trackingCode)?{trackingCode:plain(t.trackingCode)}:{}),
   ...(trackingUrl(t?.trackingUrl)?{trackingUrl:trackingUrl(t.trackingUrl)}:{}),
  })):[]}
}

/** Read actual dispatches, including warehouse work performed entirely in Pier.
 * Aggregate every dispatch by the original order line before calling it shipped. */
export async function observeShipment(env:Bindings,actor:Actor|undefined,order:Order,snapshot?:any):Promise<Order> {
 if(!order.payment||!order.reservation) return order
 assertOriginalPier(env,order)
 const state=snapshot??await pierState(env)
 if(!Array.isArray(state.orders)||!Array.isArray(state.shipments)) fail('PIER_RESPONSE','Pier did not return orders and shipments. Shipping has not been refreshed.',502)
 const native=state.orders.find((o:any)=>o.id===order.reservation!.id)
 if(!native||!Array.isArray(native.lines)) fail('PIER_ORDER_MISSING','This order is missing from Pier, possibly after a restore. Restore its original order history before shipping again.')
 if(native.customerId!==undefined&&native.customerId!==order.pierCustomerId) fail('PIER_RESPONSE','Pier returned a different customer for this order.',502)
 const dispatched=state.shipments.filter((s:any)=>s.orderId===native.id).sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id)))
 if(!dispatched.length) {
  if(order.shipment?.dispatches?.length||order.shipment?.status==='shipped') fail('PIER_SHIPMENT_MISSING','Pier no longer has this order’s recorded shipment, possibly after a restore. Restore its dispatch history before shipping again.')
  return order
 }
 const totals=new Map<string,bigint>(),ids=new Set<string>()
 for(const shipment of dispatched) {
  if(typeof shipment.id!=='string'||ids.has(shipment.id)||typeof shipment.reference!=='string'||!Array.isArray(shipment.lines)||!shipment.lines.length) fail('PIER_RESPONSE','Pier returned an incomplete or duplicate shipment. Review this order in Pier.',502)
  ids.add(shipment.id)
  for(const line of shipment.lines) {
   const original=order.reservation.lines.find((l:any)=>l.id===line.orderLineId&&l.itemId===line.itemId)
   if(!original||!order.lines.some(l=>l.itemId===line.itemId)) fail('PIER_RESPONSE','Pier shipment lines do not match this order. Review its dispatch history.',502)
   const quantity=decimal(line.quantity)
   if(quantity<=0n) fail('PIER_RESPONSE','Pier returned an empty shipment line.',502)
   totals.set(original.id,(totals.get(original.id)??0n)+quantity)
  }
 }
 if((order.shipment?.pierShipmentId&&!ids.has(order.shipment.pierShipmentId))||order.shipment?.dispatches?.some(s=>!ids.has(s.id))) fail('PIER_SHIPMENT_MISSING','Pier is missing a previously recorded dispatch, possibly after a restore. Restore its dispatch history before shipping again.')
 const complete=order.lines.map(line=>{
  const matches=order.reservation!.lines.filter((l:any)=>l.itemId===line.itemId)
  if(matches.length!==1) fail('PIER_RESPONSE','Pier order lines do not match this order.',502)
  const quantity=totals.get(matches[0].id)??0n,wanted=BigInt(line.quantity)*1000000n
  if(quantity>wanted) fail('PIER_RESPONSE','Pier reports more shipped units than this order purchased. Review its dispatch history.',502)
  return quantity===wanted
 }).every(Boolean)
 const records:PierDispatch[]=dispatched.map(dispatchRecord),previous=order.shipment
 // Only a complete original dispatch can close Stall's uncertain command.
 const original=previous?.status==='pending'&&complete&&dispatched.length===1&&dispatched[0].reference===previous.reference?dispatched[0]:null
 if(original) await observePierWork(env.DB,`stall-ship-${previous!.id}`,original.id)
 const own=previous?.pierShipmentId?ids.has(previous.pierShipmentId):previous?.status==='pending'&&dispatched.some((s:any)=>s.reference===previous.reference)
 const shipment={...(own?previous:{}),id:own?previous!.id:records[0].id,reference:records.map(s=>s.reference).join(' · '),status:complete?'shipped' as const:'partial' as const,preparedBy:own?previous!.preparedBy:'pier',pierShipmentId:records[0].id,dispatches:records}
 const status=complete?'shipped' as const:order.status==='shipped'?'reserved' as const:order.status
 if(JSON.stringify(shipment)===JSON.stringify(previous)&&status===order.status) return order
 return saveOrder(env,{...order,status,shipment},'shipment.observed',actor,'pier')
}

/** One shared read for the desk. A damaged/restored order must not prevent
 * another order's actual shipment from becoming visible. */
export async function refreshShipments(env:Bindings,actor:Actor,history:Order[]) {
 const shipmentSync:{checkedAt?:string;error?:string}={}
 if(!history.some(order=>order.payment&&order.reservation)) return {orders:history,shipmentSync}
 let snapshot:any
 try { snapshot=await pierState(env) }
 catch(error) {
  if(!(error instanceof Problem)) throw error
  return {orders:history,shipmentSync:{error:error.message}}
 }
 const updated:Order[]=[],errors=new Set<string>()
 for(const order of history) {
  try { updated.push(await observeShipment(env,actor,order,snapshot)) }
  catch(error) {
   if(!(error instanceof Problem)) throw error
   errors.add(`${order.reservation?.reference??'Order'}: ${error.message}`)
   updated.push(order)
  }
 }
 if(errors.size) shipmentSync.error=[...errors].join(' ')
 else shipmentSync.checkedAt=new Date().toISOString()
 return {orders:updated,shipmentSync}
}
