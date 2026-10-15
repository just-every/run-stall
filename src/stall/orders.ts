import type { Bindings } from '../auth.server'
import { fail,requirePerson,text,type Actor } from './model'
import { live } from './access'
import { readOrder,saveOrder } from './store'
import { paidSession,reservePaid } from './payments'
import { finishShipment,observeShipment } from './fulfilment'
import { finishRefund } from './refunds'
import { checkoutSession,validateSession } from './stripe'
export async function reconcileOrder(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 let order=await readOrder(env.DB,text(p.orderId,'Order'))
 await live(env,actor)
 if(!order.payment) {
  const id=order.checkout?.id??(p.checkoutSessionId?text(p.checkoutSessionId,'Stripe session ID'):undefined)
  if(!id) fail('STRIPE_RECOVERY','Find this order’s existing Checkout Session in Stripe and supply its ID to reconcile.')
  const session=await checkoutSession(env,id)
  validateSession(order,session)
  if(session.payment_status!=='paid') {
   if(!order.checkout&&typeof session.url==='string') {
    const link=new URL(session.url)
    if(link.protocol!=='https:'||link.hostname!=='checkout.stripe.com') fail('STRIPE_RESPONSE','Stripe returned an invalid hosted checkout link.',502)
    order=await saveOrder(env,{...order,checkout:{id:session.id,url:link.href},status:'awaiting_payment'},'checkout.recovered',actor)
   }
   return order
  }
  order=await paidSession(env,order,id,actor)
 } else if(!order.shipment||order.shipment.status==='draft') order=await reservePaid(env,order,actor)
 if(order.shipment?.status==='pending') order=await finishShipment(env,actor,order)
 else if(order.shipment?.status==='shipped') order=await observeShipment(env,actor,order)
 for(const refund of order.refunds.filter(r=>r.status==='pending')) {
  const recovered=p.refundId===refund.id&&p.stripeRefundId?text(p.stripeRefundId,'Stripe refund ID'):undefined
  order=await finishRefund(env,actor,order,refund,recovered)
 }
 return order
}
