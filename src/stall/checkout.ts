import { analyticsTestMode,analyticsTestSession } from './analytics/test-mode'
import { checkoutTax,claimTaxQuote } from './tax/commerce-quote'
import { publicTaxCommerce } from './tax/commerce'
import { shopperDetails } from './customers/checkout-details'
import type { CommerceAuthority } from './commerce-authority'
import type { Bindings } from '../auth.server'
import { digest,systemAudit } from './access'
import { pierOrigin } from './pier'
import { selectLines,priceSelection } from './order-selection'
import { createCheckout,paymentsReady,validateSession } from './stripe'
import { readOrder,saveOrder } from './store'
import { paidSession } from './payments'
import { email,fail,integer,shopCurrency,text,type Order } from './model'
import { promotionCode } from './promotions/model'
import { purchasePromotion,reservePromotion } from './promotions/eligibility'
import { rate } from './headless/auth'
import { checkoutAnalyticsStatements } from './analytics/capture'
import type { AnalyticsSnapshot } from './analytics/model'
/** `client` keys an unverified caller: one whose checkout email no session proves. */
export async function checkout(env:Bindings,p:any,authority?:CommerceAuthority,client?:string,verifiedCustomerEmail?:string,analytics?:AnalyticsSnapshot) {
 await authority?.check()
 if((await publicTaxCommerce(env)).requiresReview)fail('TAX_CONFIGURATION','The owner must explicitly review restored tax sale authority before accepting payments.',503)
 const key=text(p.idempotencyKey,'Checkout idempotency key',100)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) fail('INPUT','Use a fresh random UUID for each checkout and retain it when retrying.',400)
 const customerEmail=email(p.customerEmail)
 const selection=selectLines(p.lines)
 const code=p.promotionCode===undefined?undefined:promotionCode(p.promotionCode)
 if(code!==undefined&&p.expectedTotalCents===undefined) fail('REVIEW_REQUIRED','Review the promotion and exact total before creating checkout.',400)
 const checkoutKey=await digest(key),requestDigest=await digest(JSON.stringify({...(authority?.channel?{channel:authority.channel}:{}),customerEmail,lines:selection,expectedTotalCents:p.expectedTotalCents??null,taxQuoteId:p.taxQuoteId??null,...(p.shopper!==undefined?{shopper:p.shopper}:{}),...(code!==undefined?{promotionCode:code}:{}),...(p.shipping!==undefined?{shipping:p.shipping}:{})}))
 let row=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<any>()
 let order:Order,allowCreate=false
 if(row) {
  order=await readOrder(env.DB,row.id)
  if(order.requestDigest!==requestDigest||order.erasedAt) fail('IDEMPOTENCY','This checkout key belongs to a different or erased purchase. Start a new checkout.')
 } else {
  // A promotion checkout holds shared budget before payment, so an unverified client starts only a few a minute.
  if(code!==undefined&&client!==undefined) await rate(env,'promotion-checkout:'+client,5)
  const shopper=await shopperDetails(env.DB,p.shopper)
  if(shopper?.address&&shopper.address.country!=='US')fail('DESTINATION_UNAVAILABLE','This checkout currently serves US delivery only.',400)
  if(!paymentsReady(env)) fail('STRIPE_UNAVAILABLE','Connect Stripe on Settings before accepting payments.',503)
  const taxEnabled=(await publicTaxCommerce(env)).enabled
  const priced=await priceSelection(env,selection,undefined,p.shipping)
  const qualified=await purchasePromotion(env,{...p,customerEmail,promotionCode:code},priced,verifiedCustomerEmail)
  if(qualified&&p.expectedTotalCents===undefined)fail('REVIEW_REQUIRED','Review the promotion and exact total before creating checkout.',400)
  const {lines,shipping}=priced,shippingCents=priced.shippingCents-(qualified?.snapshot.shippingDiscountCents??0),netTotalCents=priced.totalCents-(qualified?.discountCents??0)
  const tax=await checkoutTax(env,p,lines,shippingCents,customerEmail,shipping,qualified?.snapshot,verifiedCustomerEmail),totalCents=tax?.totalCents??netTotalCents
  if(!tax&&p.expectedTotalCents!==undefined&&integer(p.expectedTotalCents,'Reviewed total cents',50,99999999)!==totalCents) fail('PRICE_CHANGED','The promotion or total changed. Review the current quote before paying.')
  const id=crypto.randomUUID(),revision=crypto.randomUUID()
  order={id,revision,customerEmail,...(analyticsTestMode(env)?{analyticsExcluded:'test' as const}:{}),...(authority?.channel?{channel:authority.channel}:{}),...(tax?{tax}:{}),...(shopper?{shopper}:{}),lines,totalCents,shippingCents,shipping,...(qualified?{promotion:qualified.snapshot}:{}),currency:shopCurrency,status:'checkout_pending',createdAt:new Date().toISOString(),requestDigest,checkoutKey,pierOrigin:pierOrigin(env),pierCustomerId:env.PIER_CUSTOMER_ID!,refunds:[]}
  // Unique checkout key prevents two orders even if concurrent requests observed no row.
  const files=lines.flatMap(line=>line.personalization?.flatMap(answer=>answer.fileId?[answer.fileId]:[])??[])
  try { await env.DB.batch([...(authority?.statements()??[]),...claimTaxQuote(env,order),env.DB.prepare('INSERT INTO st_orders VALUES(?,?,?)').bind(id,JSON.stringify(order),revision),...checkoutAnalyticsStatements(env,id,analytics),...(qualified?reservePromotion(env.DB,order,qualified.snapshot,qualified.customerKey):[]),systemAudit(env.DB,id,'checkout.prepared','customer'),...files.map(file=>env.DB.prepare('UPDATE st_uploads SET order_id=? WHERE id=? AND order_id IS NULL').bind(id,file)),env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM st_uploads WHERE order_id=?)=? THEN 1 ELSE 0 END').bind(id,files.length),env.DB.prepare('DELETE FROM st_guard')]);allowCreate=true;order=await readOrder(env.DB,id) }
  catch(error) {
   const winner=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<any>()
   if(!winner) {
    if(qualified&&String(error).includes('ST_PROMOTION_')) fail('PROMOTION_CHANGED','Promotion availability or authority changed. Review a new quote before paying.')
    throw error
   }
   order=await readOrder(env.DB,winner.id)
   if(order.requestDigest!==requestDigest||order.erasedAt) fail('IDEMPOTENCY','This checkout key belongs to a different or erased purchase.')
  }
 }
 if(!order.payment&&(await publicTaxCommerce(env)).enabled&&!order.tax)fail('TAX_QUOTE_REQUIRED','Taxed sales were enabled after this order was prepared. Review a fresh address-level quote and checkout.')
 if(order.tax?.exemption&&verifiedCustomerEmail!==order.customerEmail)fail('TAX_IDENTITY','Sign in with the proven customer email to use this exemption.',403)
 if(order.payment) return {orderId:order.id,url:'/order?checkout=success&orderId='+encodeURIComponent(order.id),status:order.status}
 if(!order.checkout) {
  if(order.erasedAt||!order.customerEmail) fail('ERASED','This customer record was erased.')
  const session=await createCheckout(env,order,allowCreate,authority?.check)
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
   try { order=await saveOrder(env,{...order,...(session.livemode===false?{analyticsExcluded:'test' as const}:{}),checkout:{id:session.id,url:link.href},status:order.status==='checkout_pending'?'awaiting_payment':order.status},'checkout.created',undefined,'stripe',{before:session.livemode===false?analyticsTestSession(env.DB,order):[]}) }
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
