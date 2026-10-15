import type { Bindings } from '../auth.server'
import { live } from './access'
import { assertOriginalPier,decimal,dispatchOrder,pierState } from './pier'
import { readOrder,saveOrder } from './store'
import { approval,actorLabel,fail,requirePerson,text,type Actor,type Approval,type Order } from './model'
export async function liveApproval(env:Bindings,actor:Actor,a?:Approval) {
 await live(env,actor)
 if(!a||!await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')").bind(a.by,a.version).first()) fail('APPROVAL_REVOKED','The recorded approver no longer has authority. Review with a current approver.')
}
export function exactRevision(order:Order,p:any) { if(p.revision!==order.revision) fail('CHANGED','The order changed. Review its current exact revision.') }
export async function shipmentCommand(env:Bindings,actor:Actor,type:string,p:any) {
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 if(type==='shipment.prepare') {
  exactRevision(order,p)
  if(order.status!=='reserved'||!order.payment||!order.reservation) fail('SHIPMENT','Only paid orders with fully reserved stock can be shipped.')
  if(order.shipment&&order.shipment.status!=='draft') fail('SHIPMENT','This order already has an approved shipment.')
  return saveOrder(env,{...order,shipment:{id:order.shipment?.id??crypto.randomUUID(),reference:text(p.reference,'Shipment reference'),status:'draft',preparedBy:actorLabel(actor)}},'shipment.prepared',actor)
 }
 requirePerson(actor)
 if(order.shipment?.status==='shipped') return order
 if(!order.shipment) fail('SHIPMENT','Prepare and review the shipment first.')
 if(order.shipment.status==='draft') {
  exactRevision(order,p)
  order=await saveOrder(env,{...order,shipment:{...order.shipment,status:'pending',approval:approval(actor,order.revision)}},'shipment.approved',actor)
 } else {
  if(p.revision!==order.revision&&p.revision!==order.shipment.approval?.revision) fail('CHANGED','Review the current shipment before resuming.')
  if(p.revision===order.revision&&(order.shipment.approval?.by!==actor.id||order.shipment.approval?.version!==actor.version)) order=await saveOrder(env,{...order,shipment:{...order.shipment,approval:approval(actor,order.revision)}},'shipment.reapproved',actor)
 }
 return finishShipment(env,actor,order)
}
export async function finishShipment(env:Bindings,actor:Actor,order:Order) {
 if(order.shipment?.status!=='pending') return order
 await liveApproval(env,actor,order.shipment.approval)
 const result=await dispatchOrder(env,order)
 validateShipment(order,result)
 return saveOrder(env,{...order,status:'shipped',shipment:{...order.shipment,status:'shipped',pierShipmentId:result.id}},'shipment.shipped',actor)
}
export function validateShipment(order:Order,result:any) {
 if(typeof result?.id!=='string'||result.orderId!==order.reservation?.id||result.reference!==order.shipment?.reference||!Array.isArray(result.lines)||result.lines.length!==order.lines.length||!order.lines.every(l=>{
  const matches=result.lines.filter((x:any)=>x.itemId===l.itemId)
  return matches.length===1&&decimal(matches[0].quantity)===BigInt(l.quantity)*1000000n
 })) fail('PIER_RESPONSE','Pier shipment does not match the approved order. Reconcile this shipment.',502)
}

export async function observeShipment(env:Bindings,actor:Actor,order:Order) {
 assertOriginalPier(env,order)
 await live(env,actor)
 const state=await pierState(env)
 const shipment=Array.isArray(state.shipments)?state.shipments.find((s:any)=>s.id===order.shipment?.pierShipmentId):undefined
 validateShipment(order,shipment)
 return order
}
