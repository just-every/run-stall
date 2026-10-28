import { assertRiskClear } from './risk'
import type { Bindings } from '../auth.server'
import { live } from './access'
import { decimal,dispatchOrder } from './pier'
import { observeShipment } from './shipment-sync'
import { readOrder,saveOrder,type OrderWriteContext } from './store'
import { approval,actorLabel,fail,requirePerson,text,type Actor,type Approval,type Order } from './model'
export async function liveApproval(env:Bindings,actor:Actor,a?:Approval,right='fulfillment') {
 await live(env,actor)
 if(!a||!await env.DB.prepare(`SELECT o.id FROM oa_operators o LEFT JOIN st_staff g ON g.actor_id=o.id WHERE o.id=? AND o.version=? AND o.status='active' AND (o.role IN ('owner','admin') OR (g.revision=? AND g.staff_role IN (?,'administrator')))` ).bind(a.by,a.version,a.scopeRevision??'',right).first()) fail('APPROVAL_REVOKED','The recorded approver no longer has authority. Review with a current approver.')
}
export function exactRevision(order:Order,p:any) { if(p.revision!==order.revision) fail('CHANGED','The order changed. Review its current exact revision.') }
export async function shipmentCommand(env:Bindings,actor:Actor,type:string,p:any,preparation?:OrderWriteContext) {
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 await assertRiskClear(env,order.id)
 const before=order
 order=await observeShipment(env,actor,order)
 if(order.shipment?.status==='partial') fail('PART_ALREADY_SHIPPED',`Pier already shipped part of this order (${order.shipment.reference}). Finish the remaining lines in Pier, then refresh Stall.`)
 if(order.shipment?.status==='shipped'&&(type==='shipment.prepare'||before.shipment?.status!=='shipped')) fail('ALREADY_SHIPPED',`Pier already shipped this order (${order.shipment.reference}). Refresh Stall to see its shipment; do not ship it again.`)
 if(type==='shipment.prepare') {
  exactRevision(order,p)
  if(order.status!=='reserved'||!order.payment||!order.reservation) fail('SHIPMENT','Only paid orders with fully reserved stock can be shipped.')
  if(order.shipment&&order.shipment.status!=='draft') fail('SHIPMENT','This order already has an approved shipment.')
  return saveOrder(env,{...order,shipment:{id:order.shipment?.id??crypto.randomUUID(),reference:text(p.reference,'Shipment reference'),status:'draft',preparedBy:actorLabel(actor)}},'shipment.prepared',actor,'stripe',preparation)
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
 const observed=await observeShipment(env,actor,order)
 if(observed.shipment?.status==='shipped') return observed
 if(observed.shipment?.status==='partial') fail('PART_ALREADY_SHIPPED',`Pier already shipped part of this order (${observed.shipment.reference}). Finish the remaining lines in Pier, then refresh Stall.`)
 await assertRiskClear(env,order.id)
 const result=await dispatchOrder(env,order)
 validateShipment(order,result)
 return saveOrder(env,{...order,status:'shipped',shipment:{...order.shipment,status:'shipped',pierShipmentId:result.id}},'shipment.shipped',actor)
}
export function validateShipment(order:Order,result:any) {
 if(order.promotion?.lineDiscounts?.some(l=>l.discountCents>0)) {
  const reserved=order.reservation?.lines??[]
  if(typeof result?.id!=='string'||result.orderId!==order.reservation?.id||result.reference!==order.shipment?.reference||!Array.isArray(result.lines)||result.lines.length!==reserved.length||!reserved.every(original=>{const matches=result.lines.filter((x:any)=>x.orderLineId===original.id&&x.itemId===original.itemId);return matches.length===1&&decimal(matches[0].quantity)===decimal(original.quantity)}))fail('PIER_RESPONSE','Pier shipment does not match the approved discounted order. Reconcile this shipment.',502)
  return
 }
 if(typeof result?.id!=='string'||result.orderId!==order.reservation?.id||result.reference!==order.shipment?.reference||!Array.isArray(result.lines)||result.lines.length!==order.lines.length||!order.lines.every(l=>{
  const matches=result.lines.filter((x:any)=>x.itemId===l.itemId)
  return matches.length===1&&decimal(matches[0].quantity)===BigInt(l.quantity)*1000000n
 })) fail('PIER_RESPONSE','Pier shipment does not match the approved order. Reconcile this shipment.',502)
}
