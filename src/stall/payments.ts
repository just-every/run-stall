import type { Bindings } from '../auth.server'
import { digest,live } from './access'
import { assertOriginalPier,fullyReserved,pierState,reserveOrder } from './pier'
import { checkoutSession,signedEvent,validateSession } from './stripe'
import { readOrder,saveOrder } from './store'
import { startPaymentCheck,completePaymentCheck } from './operations'
import { observeShipment } from './shipment-sync'
import { observedStripeWork } from './integration-work'
import { fail,Problem,type Actor,type Order } from './model'
export async function paidSession(env:Bindings,order:Order,id:string,actor?:Actor) {
 if(actor) await live(env,actor)
 const session=await checkoutSession(env,id)
 validateSession(order,session,true)
 await observedStripeWork(env.DB,`stall-checkout-${order.id}`,session.id)
 if(!order.payment) {
  // Store only the delivery fields the shop needs. Stripe holds the card and full payment record.
  const details=session.collected_information?.shipping_details
  const shippingDetails=details?.name&&details?.address?{name:String(details.name),address:{line1:details.address.line1??'',line2:details.address.line2??'',city:details.address.city??'',state:details.address.state??'',postal_code:details.address.postal_code??'',country:details.address.country??''}}:undefined
  order=await saveOrder(env,{...order,...(shippingDetails?{shippingDetails}:{}),payment:{sessionId:session.id,intentId:session.payment_intent,paidAt:new Date().toISOString()},status:'paid'},'payment.confirmed',actor)
 }
 return reservePaid(env,order,actor)
}
export async function reservePaid(env:Bindings,order:Order,actor?:Actor):Promise<Order> {
 if(!order.payment) fail('PAYMENT','The order has no verified payment.')
 if(order.shipment?.status==='shipped') return order
 assertOriginalPier(env,order)
 if(actor) await live(env,actor)
 order=await observeShipment(env,actor,order)
 if(order.shipment?.status==='shipped'||order.shipment?.status==='partial') return order
 let result:any
 if(order.reservation) {
  const state=await pierState(env)
  if(!Array.isArray(state.orders)) fail('PIER_RESPONSE','Pier orders are missing.',502)
  result=state.orders.find((x:any)=>x.id===order.reservation!.id)
 } else result=await reserveOrder(env,order)
 if(typeof result?.id!=='string'||typeof result?.reference!=='string'||!Array.isArray(result?.lines)) fail('PIER_RESPONSE','Pier returned an incomplete reservation. Reconcile this order.',502)
 const full=fullyReserved(result,order.lines)
 return saveOrder(env,{...order,reservation:{id:result.id,reference:result.reference,lines:result.lines},status:full?'reserved':'shortfall'},full?'stock.reserved':'stock.shortfall',actor)
}
export async function webhook(request:Request,env:Bindings) {
 const {event,body}=await signedEvent(request,env)
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return {received:true,ignored:true}
 const session=event.data?.object
 if(typeof session?.metadata?.stall_order_id!=='string'||typeof session.id!=='string') fail('PAYMENT_MISMATCH','Stripe event is missing its order reference.',400)
 const orderId=session.metadata.stall_order_id,hash=await digest(body)
 const previous=await env.DB.prepare('SELECT * FROM st_events WHERE id=?').bind(event.id).first<any>()
 if(previous&&(previous.digest!==hash||previous.order_id!==orderId)) fail('EVENT_MISMATCH','Stripe event ID was reused with different content.',400)
 if(previous?.completed_at) return {received:true,replayed:true}
 await env.DB.prepare('INSERT OR IGNORE INTO st_events(id,digest,order_id) VALUES(?,?,?)').bind(event.id,hash,orderId).run()
 let order=await readOrder(env.DB,orderId)
 validateSession(order,session)
 if(session.payment_status!=='paid') return {received:true,pending:true}
 order=await paidSession(env,order,session.id)
 await env.DB.prepare('UPDATE st_events SET completed_at=? WHERE id=? AND digest=?').bind(new Date().toISOString(),event.id,hash).run()
 return {received:true,status:order.status}
}
/** Ask Stripe whether this order's Checkout Session is paid, and confirm it if so.
 * A local shop's only confirmation besides Reconcile; an online shop's safety net. */
export async function confirmFromStripe(env:Bindings,order:Order):Promise<Order> {
 if(order.payment||!order.checkout) return order
 const session=await checkoutSession(env,order.checkout.id)
 validateSession(order,session)
 return session.payment_status==='paid'?paidSession(env,order,session.id):order
}
/** The customer's return from Stripe: confirm the payment by asking Stripe. */
export async function confirmReturn(env:Bindings,orderId:string) {
 let order=await readOrder(env.DB,orderId)
 try { order=await confirmFromStripe(env,order) }
 catch(error) {
  // Payment may be recorded while Pier is unreachable; the order then waits for Reconcile.
  if(!(error instanceof Problem)) throw error
  order=await readOrder(env.DB,orderId)
  if(!order.payment) throw error
 }
 return {status:order.payment?'paid':'awaiting_payment'}
}
/** The scheduled check (every minute, also under rer dev): orders still awaiting
 * payment from the last day, while their Checkout Sessions can still be paid. */
export async function checkAwaitingPayments(env:Bindings) {
 const attempt=await startPaymentCheck(env)
 const result:{checked:number;confirmed:number;failed:number;lastErrorCode?:string}={checked:0,confirmed:0,failed:0}
 if(!env.STRIPE_SECRET_KEY) {
  await completePaymentCheck(env,attempt,result,'not_configured')
  return result
 }
 try {
  const since=new Date(Date.now()-25*3600000).toISOString()
  const rows=(await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.status')='awaiting_payment' AND json_extract(value_json,'$.createdAt')>? ORDER BY json_extract(value_json,'$.createdAt') LIMIT 20").bind(since).all<{id:string}>()).results
  for(const row of rows) {
   result.checked++
   try { if((await confirmFromStripe(env,await readOrder(env.DB,row.id))).payment) result.confirmed++ }
   catch(error) {
    result.failed++
    result.lastErrorCode=error instanceof Problem&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:'PAYMENT_CHECK_FAILED'
    if(!(error instanceof Problem)) throw error
   }
  }
  await completePaymentCheck(env,attempt,result,result.failed?'failed':'complete')
  return result
 } catch(error) {
  if(!result.failed) { result.failed++;result.lastErrorCode='PAYMENT_CHECK_FAILED' }
  await completePaymentCheck(env,attempt,result,'failed')
  throw error
 }
}
