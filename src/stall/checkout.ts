import type { Bindings } from '../auth.server'
import { digest,systemAudit } from './access'
import { pierOrigin } from './pier'
import { selectLines,priceSelection } from './order-selection'
import { createCheckout,paymentsReady,validateSession } from './stripe'
import { readOrder,saveOrder } from './store'
import { paidSession } from './payments'
import { email,fail,shopCurrency,text,type Order } from './model'
export async function checkout(env:Bindings,p:any) {
 const key=text(p.idempotencyKey,'Checkout idempotency key',100)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) fail('INPUT','Use a fresh random UUID for each checkout and retain it when retrying.',400)
 const customerEmail=email(p.customerEmail)
 const selection=selectLines(p.lines)
 const checkoutKey=await digest(key),requestDigest=await digest(JSON.stringify({customerEmail,lines:selection,expectedTotalCents:p.expectedTotalCents??null}))
 let row=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<any>()
 let order:Order,allowCreate=false
 if(row) {
  order=await readOrder(env.DB,row.id)
  if(order.requestDigest!==requestDigest||order.erasedAt) fail('IDEMPOTENCY','This checkout key belongs to a different or erased purchase. Start a new checkout.')
 } else {
  if(!paymentsReady(env)) fail('STRIPE_UNAVAILABLE','Connect Stripe on Settings before accepting payments.',503)
  const {lines,shippingCents,totalCents}=await priceSelection(env,selection,p.expectedTotalCents)
  const id=crypto.randomUUID(),revision=crypto.randomUUID()
  order={id,revision,customerEmail,lines,totalCents,shippingCents,currency:shopCurrency,status:'checkout_pending',createdAt:new Date().toISOString(),requestDigest,checkoutKey,pierOrigin:pierOrigin(env),pierCustomerId:env.PIER_CUSTOMER_ID!,refunds:[]}
  // Unique checkout key prevents two orders even if concurrent requests observed no row.
  try { await env.DB.batch([env.DB.prepare('INSERT INTO st_orders VALUES(?,?,?)').bind(id,JSON.stringify(order),revision),systemAudit(env.DB,id,'checkout.prepared','customer')]);allowCreate=true }
  catch(error) {
   const winner=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<any>()
   if(!winner) throw error
   order=await readOrder(env.DB,winner.id)
   if(order.requestDigest!==requestDigest||order.erasedAt) fail('IDEMPOTENCY','This checkout key belongs to a different or erased purchase.')
  }
 }
 if(order.payment) return {orderId:order.id,url:'/order?checkout=success&orderId='+encodeURIComponent(order.id),status:order.status}
 if(!order.checkout) {
  if(order.erasedAt||!order.customerEmail) fail('ERASED','This customer record was erased.')
  const session=await createCheckout(env,order,allowCreate)
  validateSession(order,session)
  if(!allowCreate&&session.payment_status==='paid') {
   order=await paidSession(env,order,session.id)
   return {orderId:order.id,url:'/order?checkout=success&orderId='+encodeURIComponent(order.id),status:order.status}
  }
  let link:URL;try { link=new URL(session.url) }catch { return fail('STRIPE_RESPONSE','Stripe did not return a hosted checkout link.',502) }
  if(link.protocol!=='https:'||link.hostname!=='checkout.stripe.com') fail('STRIPE_RESPONSE','Stripe returned an invalid checkout link.',502)
  order=await readOrder(env.DB,order.id)
  validateSession(order,session)
  if(!order.checkout) {
   try { order=await saveOrder(env,{...order,checkout:{id:session.id,url:link.href},status:order.status==='checkout_pending'?'awaiting_payment':order.status},'checkout.created') }
   catch(error) {
    const winner=await readOrder(env.DB,order.id)
    if(winner.checkout?.id!==session.id) throw error
    order=winner
   }
  }
 }
 // A demo's simulated Stripe Checkout is paid at once: confirm it as the webhook would.
 if(env.RER_DEMO==='1'&&!order.payment) order=await paidSession(env,order,order.checkout!.id)
 if(order.payment) return {orderId:order.id,url:'/order?checkout=success&orderId='+encodeURIComponent(order.id),status:order.status}
 return {orderId:order.id,url:order.checkout!.url,status:order.status}
}
