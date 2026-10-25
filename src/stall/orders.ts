import { ensureRefundTax } from './tax/transactions'
import type { Bindings } from '../auth.server'
import { fail,requirePerson,text,type Actor } from './model'
import { live } from './access'
import { readOrder,saveOrder } from './store'
import { paidSession,reservePaid } from './payments'
import { finishShipment } from './fulfilment'
import { observeShipment } from './shipment-sync'
import { finishRefund } from './refunds'
import { checkoutSession,validateSession } from './stripe'
import { originalCheckout } from './stripe-recovery'
import { observedStripeWork } from './integration-work'
export async function reconcileOrder(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 await live(env,actor)
 order=await observeShipment(env,actor,order)
 if(!order.payment) {
  const id=order.checkout?.id??(p.checkoutSessionId?text(p.checkoutSessionId,'Stripe session ID'):undefined)
  const session=id?await checkoutSession(env,id):await originalCheckout(env,order)
  validateSession(order,session)
  await observedStripeWork(env.DB,`stall-checkout-${order.id}`,session.id)
  if(session.payment_status!=='paid') {
   if(!order.checkout&&typeof session.url==='string') {
    const link=new URL(session.url)
    if(link.protocol!=='https:'||link.hostname!=='checkout.stripe.com') fail('STRIPE_RESPONSE','Stripe returned an invalid hosted checkout link.',502)
    order=await saveOrder(env,{...order,checkout:{id:session.id,url:link.href},status:'awaiting_payment'},'checkout.recovered',actor)
   }
   return order
  }
  order=await paidSession(env,order,session.id,actor)
 } else if(!order.shipment||order.shipment.status==='draft') order=await reservePaid(env,order,actor)
 if(order.shipment?.status==='pending') order=await finishShipment(env,actor,order)
 for(const refund of order.refunds.filter(r=>r.status==='pending')) {
  const recovered=p.refundId===refund.id&&p.stripeRefundId?text(p.stripeRefundId,'Stripe refund ID'):undefined
  order=await finishRefund(env,actor,order,refund,recovered)
 }
 for(const refund of order.refunds.filter(r=>r.status==='succeeded'&&!r.taxReversalId))order=await ensureRefundTax(env,order,refund)
 return order
}
