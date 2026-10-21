import type { Bindings } from '../auth.server'
import { digest,systemAudit } from './access'
import { catalogue,decimal,pierOrigin } from './pier'
import { createCheckout,paymentsReady,validateSession } from './stripe'
import { readOrder,saveOrder } from './store'
import { paidSession } from './payments'
import { email,fail,integer,shopCurrency,text,type Line,type Order } from './model'
export async function checkout(env:Bindings,p:any) {
 const key=text(p.idempotencyKey,'Checkout idempotency key',100)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) fail('INPUT','Use a fresh random UUID for each checkout and retain it when retrying.',400)
 const customerEmail=email(p.customerEmail)
 if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>50) fail('LINES','Choose between one and 50 products.',400)
 const seen=new Set<string>()
 const selection=p.lines.map((l:any)=>{
  const sku=text(l.sku,'SKU',100),quantity=integer(l.quantity,'Quantity',1,1000)
  if(seen.has(sku)) fail('LINES','Each product may appear only once.',400)
  seen.add(sku);return {sku,quantity}
 }).sort((a:any,b:any)=>a.sku.localeCompare(b.sku))
 const checkoutKey=await digest(key),requestDigest=await digest(JSON.stringify({customerEmail,lines:selection,expectedTotalCents:p.expectedTotalCents??null}))
 let row=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<any>()
 let order:Order,allowCreate=false
 if(row) {
  order=await readOrder(env.DB,row.id)
  if(order.requestDigest!==requestDigest||order.erasedAt) fail('IDEMPOTENCY','This checkout key belongs to a different or erased purchase. Start a new checkout.')
 } else {
  if(!paymentsReady(env)) fail('STRIPE_UNAVAILABLE','Connect Stripe on Settings before accepting payments.',503)
  const stock=await catalogue(env)
  const lines:Line[]=selection.map((line:any)=>{
   const product=stock.items.find(i=>i.sku===line.sku)
   if(!product) fail('PRODUCT','A selected product is no longer published.')
   if(BigInt(line.quantity)*1000000n>decimal(product.available)) fail('STOCK','There is not enough available stock. Refresh the shop.')
   integer(product.unitCents,'Product unit cents',1)
   return {...line,itemId:product.itemId,name:product.name,description:product.description,unitCents:product.unitCents}
  })
  const shippingCents=stock.shippingCents
  const totalCents=lines.reduce((sum,l)=>sum+l.quantity*l.unitCents,0)+shippingCents
  integer(totalCents,'Order total cents',50,99999999)
  if(p.expectedTotalCents!==undefined&&integer(p.expectedTotalCents,'Reviewed total cents',50,99999999)!==totalCents) fail('PRICE_CHANGED','A product price or shipping charge changed. Refresh the shop and review the total before paying.')
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
