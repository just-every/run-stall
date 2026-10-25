import { taxTestMode } from './tax/commerce-provider'
import { ensureRefundTax } from './tax/transactions'
import { refundAuthority } from './permissions'
import type { Bindings } from '../auth.server'
import { actorLabel,approval,fail,requirePerson,shopCurrency,text,type Actor,type Order,type Refund } from './model'
import { createRefund,retrieveRefund } from './stripe'
import { readOrder,saveOrder } from './store'
import { refundValue } from './refund-values'
import { exactRevision,liveApproval } from './fulfilment'
import { staffRefundLabel } from './payment-labels'
import { observedStripeWork } from './integration-work'
function refundResult(order:Order,r:Refund,result:any):Refund {
 if(typeof result?.id!=='string'||!/^re_[A-Za-z0-9_]+$/.test(result.id)||result.object!=='refund'||result.amount!==r.amountCents||result.currency!==shopCurrency||result.payment_intent!==order.payment?.intentId||result.metadata?.stall_order_id!==order.id||result.metadata?.stall_refund_id!==r.id||(r.stripeId&&r.stripeId!==result.id)||!['pending','requires_action','succeeded','failed','canceled'].includes(result.status)) fail('REFUND_MISMATCH','Stripe refund does not match this approved refund.',502)
 return {...r,stripeId:result.id,status:result.status==='requires_action'?'pending':result.status}
}
export async function refundCommand(env:Bindings,actor:Actor,type:string,p:any) {
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 if(!order.payment||order.shipment?.status!=='shipped') fail('REFUND','Ship the paid order before preparing a refund. Refunds do not restock items.')
 if(type==='refund.prepare') {
  exactRevision(order,p)
  if(order.refunds.some(r=>r.status==='pending')) fail('REFUND_PENDING','Reconcile the pending refund before preparing another.')
  const components=refundValue(order,p)
  const draft:Refund={id:crypto.randomUUID(),...components,reason:text(p.reason,'Refund reason',500),status:'draft',preparedBy:actorLabel(actor)}
  return saveOrder(env,{...order,refunds:[...order.refunds.filter(r=>r.status!=='draft'),draft]},'refund.prepared',actor)
 }
 requirePerson(actor)
 let refund=p.refundId?order.refunds.find(r=>r.id===p.refundId):order.refunds.at(-1)
 if(!refund) fail('REFUND','Prepare and review a refund first.')
 refundAuthority(actor,refund.amountCents,refund.preparedBy)
 if(refund.status==='succeeded')return ensureRefundTax(env,order,refund)
 if(['failed','canceled'].includes(refund.status))return order
 const allowCreate=refund.status==='draft'
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
 return finishRefund(env,actor,order,refund,undefined,allowCreate)
}
export async function finishRefund(env:Bindings,actor:Actor,order:Order,r:Refund,recoveredStripeId?:string,allowCreate=false) {
 if(order.tax)taxTestMode(env)
 refundAuthority(actor,r.amountCents,r.preparedBy)
 await liveApproval(env,actor,r.approval,'finance')
 if(order.payment?.source==='staff') {
  const next:Refund={...r,source:'staff',label:staffRefundLabel,status:'succeeded'}
  return saveOrder(env,{...order,refunds:order.refunds.map(x=>x.id===r.id?next:x)},'refund.staff-recorded',actor)
 }
 const result=r.stripeId||recoveredStripeId?await retrieveRefund(env,r.stripeId??recoveredStripeId!):await createRefund(env,order,r,allowCreate)
 const next=refundResult(order,r,result)
 await observedStripeWork(env.DB,`stall-refund-${r.id}`,next.stripeId!)
 order=await saveOrder(env,{...order,refunds:order.refunds.map(x=>x.id===r.id?next:x)},`refund.${next.status}`,actor)
 return ensureRefundTax(env,order,next)
}
