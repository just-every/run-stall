import type { Bindings } from '../auth.server'
import { actorLabel,approval,fail,integer,requirePerson,text,type Actor,type Order,type Refund } from './model'
import { createRefund,retrieveRefund } from './stripe'
import { readOrder,saveOrder } from './store'
import { exactRevision,liveApproval } from './fulfilment'
function refundResult(order:Order,r:Refund,result:any):Refund {
 if(typeof result?.id!=='string'||!/^re_[A-Za-z0-9_]+$/.test(result.id)||result.object!=='refund'||result.amount!==r.amountCents||result.currency!=='aud'||result.payment_intent!==order.payment?.intentId||result.metadata?.stall_order_id!==order.id||result.metadata?.stall_refund_id!==r.id||(r.stripeId&&r.stripeId!==result.id)||!['pending','requires_action','succeeded','failed','canceled'].includes(result.status)) fail('REFUND_MISMATCH','Stripe refund does not match this approved refund.',502)
 return {...r,stripeId:result.id,status:result.status==='requires_action'?'pending':result.status}
}
export async function refundCommand(env:Bindings,actor:Actor,type:string,p:any) {
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 if(!order.payment||order.shipment?.status!=='shipped') fail('REFUND','Ship the paid order before preparing a refund. Refunds do not restock items.')
 if(type==='refund.prepare') {
  exactRevision(order,p)
  if(order.refunds.some(r=>r.status==='pending')) fail('REFUND_PENDING','Reconcile the pending refund before preparing another.')
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>order.lines.length) fail('LINES','Choose the items to refund.',400)
  const seen=new Set<string>()
  const lines=p.lines.map((l:any)=>{
   const sku=text(l.sku,'SKU',100),quantity=integer(l.quantity,'Refund quantity',1,1000),source=order.lines.find(x=>x.sku===sku)
   if(!source||seen.has(sku)) fail('LINES','Choose distinct products from this order.',400)
   seen.add(sku)
   const refunded=order.refunds.filter(r=>['pending','succeeded'].includes(r.status)).reduce((n,r)=>n+(r.lines.find(x=>x.sku===sku)?.quantity??0),0)
   if(refunded+quantity>source.quantity) fail('REFUND_LIMIT','The requested quantity exceeds the unrefunded purchase.')
   return {sku,quantity}
  })
  const amountCents=lines.reduce((n:number,l:any)=>n+l.quantity*order.lines.find(x=>x.sku===l.sku)!.unitCents,0)
  const refundedCents=order.refunds.filter(r=>['pending','succeeded'].includes(r.status)).reduce((n,r)=>n+r.amountCents,0)
  if(refundedCents+amountCents>order.totalCents) fail('REFUND_LIMIT','Refunds cannot exceed the paid amount.')
  const draft:Refund={id:crypto.randomUUID(),lines,amountCents,reason:text(p.reason,'Refund reason',500),status:'draft',preparedBy:actorLabel(actor)}
  return saveOrder(env,{...order,refunds:[...order.refunds.filter(r=>r.status!=='draft'),draft]},'refund.prepared',actor)
 }
 requirePerson(actor)
 let refund=p.refundId?order.refunds.find(r=>r.id===p.refundId):order.refunds.at(-1)
 if(!refund) fail('REFUND','Prepare and review a refund first.')
 if(['succeeded','failed','canceled'].includes(refund.status)) return order
 if(refund.status==='draft') {
  exactRevision(order,p)
  refund={...refund,status:'pending',approval:approval(actor,order.revision),startedAt:new Date().toISOString()}
  order=await saveOrder(env,{...order,refunds:order.refunds.map(r=>r.id===refund!.id?refund!:r)},'refund.approved',actor)
 } else {
  if(p.revision!==order.revision&&p.revision!==refund.approval?.revision) fail('CHANGED','Review the current refund before resuming.')
  if(p.revision===order.revision&&(refund.approval?.by!==actor.id||refund.approval?.version!==actor.version)) {
   refund={...refund,approval:approval(actor,order.revision)}
   order=await saveOrder(env,{...order,refunds:order.refunds.map(r=>r.id===refund!.id?refund!:r)},'refund.reapproved',actor)
  }
 }
 return finishRefund(env,actor,order,refund)
}
export async function finishRefund(env:Bindings,actor:Actor,order:Order,r:Refund,recoveredStripeId?:string) {
 await liveApproval(env,actor,r.approval)
 const result=r.stripeId||recoveredStripeId?await retrieveRefund(env,r.stripeId??recoveredStripeId!):await createRefund(env,order,r)
 const next=refundResult(order,r,result)
 return saveOrder(env,{...order,refunds:order.refunds.map(x=>x.id===r.id?next:x)},`refund.${next.status}`,actor)
}
