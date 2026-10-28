import { checkoutAnalytics } from '../analytics/capture'
import type { Bindings } from '../../auth.server'
import { digest,changed,systemAudit } from '../access'
import { checkout } from '../checkout'
import { fail,text,type Order } from '../model'
import { selectLines,priceLines } from '../order-selection'
import { postalCodeOf,quoteShipping } from '../shipping-quote'
import { confirmReturn } from '../payments'
import { readOrder } from '../store'
import { appGuard,customerGuard,fenced,rate,type App,type Customer } from './auth'
import { now,uuid } from './common'
import { promotionCode } from '../promotions/model'
import { promotionQuote } from '../promotions/eligibility'
type Cart={id:string;app_id:string;customer_id:string;value_json:string;revision:string;created_at:string;checkout_request:string|null}
type Work={id:string;customer_id:string;operation:string;request_digest:string;commerce_key:string;cart_id:string;order_id:string|null}
const publicCart=(c:Cart)=>({id:c.id,revision:c.revision,lines:JSON.parse(c.value_json),createdAt:c.created_at,locked:Boolean(c.checkout_request)})
async function cart(env:Bindings,a:App,c:Customer,id:string) {
 const row=await env.DB.prepare('SELECT * FROM st_headless_carts WHERE id=? AND app_id=? AND customer_id=?').bind(id,a.id,c.id).first<Cart>()
 if(!row) fail('NOT_FOUND','Cart not found.',404)
 return row
}
async function work(env:Bindings,a:App,key:string,c:Customer,operation:string,fingerprint:string) {
 const row=await env.DB.prepare('SELECT * FROM st_headless_requests WHERE app_id=? AND key_hash=?').bind(a.id,key).first<Work>()
 if(row&&(row.customer_id!==c.id||row.operation!==operation||row.request_digest!==fingerprint)) fail('IDEMPOTENCY','This key is already bound to another request.',409)
 return row
}
export async function createCart(env:Bindings,a:App,c:Customer,request:Request,p:any) {
 const lines=selectLines(p.lines),key=await digest(uuid(request.headers.get('idempotency-key'),'Idempotency-Key')),fingerprint=await digest(JSON.stringify(lines))
 let previous=await work(env,a,key,c,'cart',fingerprint)
 if(!previous) {
  const id=crypto.randomUUID(),workId=crypto.randomUUID()
  await fenced(env,a,c,[env.DB.prepare('INSERT INTO st_headless_carts(id,app_id,customer_id,value_json,revision,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM st_headless_requests WHERE app_id=? AND key_hash=?)').bind(id,a.id,c.id,JSON.stringify(lines),crypto.randomUUID(),now(),a.id,key),env.DB.prepare('INSERT OR IGNORE INTO st_headless_requests(id,app_id,key_hash,customer_id,operation,request_digest,commerce_key,cart_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(workId,a.id,key,c.id,'cart',fingerprint,crypto.randomUUID(),id,now()),systemAudit(env.DB,id,'cart.created','customer:'+c.id)])
  previous=await work(env,a,key,c,'cart',fingerprint)
 }
 if(!previous) fail('CONFLICT','Cart creation did not complete.')
 return publicCart(await cart(env,a,c,previous.cart_id))
}
export async function readCart(env:Bindings,a:App,c:Customer,id:string) {const found=await cart(env,a,c,id);await fenced(env,a,c);return publicCart(found)}
export async function updateCart(env:Bindings,a:App,c:Customer,id:string,p:any) {
 const found=await cart(env,a,c,id),lines=selectLines(p.lines),revision=text(p.revision,'Cart revision',100)
 if(found.checkout_request) fail('CART_LOCKED','This cart has a prepared checkout. Create a new cart to change it.')
 const next=crypto.randomUUID()
 await fenced(env,a,c,[env.DB.prepare('UPDATE st_headless_carts SET value_json=?,revision=? WHERE id=? AND app_id=? AND customer_id=? AND revision=? AND checkout_request IS NULL').bind(JSON.stringify(lines),next,id,a.id,c.id,revision),changed(env.DB),systemAudit(env.DB,id,'cart.updated','customer:'+c.id)])
 return publicCart(await cart(env,a,c,id))
}
export async function buy(env:Bindings,a:App,c:Customer,request:Request,p:any) {
 await rate(env,'checkout:'+a.id+':'+c.id,20)
 const found=await cart(env,a,c,text(p.cartId,'Cart ID',100)),key=await digest(uuid(request.headers.get('idempotency-key'),'Idempotency-Key'))
 const code=p.promotionCode===undefined?undefined:promotionCode(p.promotionCode)
 const email=c.actor.email.toLowerCase(),fingerprint=await digest(JSON.stringify({cartId:found.id,revision:found.revision,email,expectedTotalCents:p.expectedTotalCents??null,shipping:p.shipping??null,...(code!==undefined?{promotionCode:code}:{})}))
 let previous=await work(env,a,key,c,'checkout',fingerprint)
 if(!previous) {
  if(found.checkout_request) fail('CART_LOCKED','Use the original checkout key for this cart.')
  const workId=crypto.randomUUID(),commerceKey=crypto.randomUUID()
  await fenced(env,a,c,[env.DB.prepare('INSERT OR IGNORE INTO st_headless_requests(id,app_id,key_hash,customer_id,operation,request_digest,commerce_key,checkout_hash,cart_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(workId,a.id,key,c.id,'checkout',fingerprint,commerceKey,await digest(commerceKey),found.id,now()),env.DB.prepare('UPDATE st_headless_carts SET checkout_request=(SELECT id FROM st_headless_requests WHERE app_id=? AND key_hash=?) WHERE id=? AND customer_id=? AND app_id=? AND revision=? AND (checkout_request IS NULL OR checkout_request=(SELECT id FROM st_headless_requests WHERE app_id=? AND key_hash=?))').bind(a.id,key,found.id,c.id,a.id,found.revision,a.id,key),changed(env.DB)])
  previous=await work(env,a,key,c,'checkout',fingerprint)
 }
 if(!previous) fail('CONFLICT','Checkout preparation did not complete.')
 // No separate commerce engine: the same Stripe/Pier work ledger, verified
 // payment callbacks and idempotency rules apply to both storefronts.
 await fenced(env,a,c)
 const result=await checkout(env,{customerEmail:email,lines:JSON.parse(found.value_json),idempotencyKey:previous.commerce_key,expectedTotalCents:p.expectedTotalCents,...(code!==undefined?{promotionCode:code}:{}),...(p.shipping!==undefined?{shipping:p.shipping}:{})},{check:()=>fenced(env,a,c),statements:()=>[appGuard(env,a),customerGuard(env,c)]},undefined,undefined,await checkoutAnalytics(request,env))
 await fenced(env,a,c)
 return result
}
function customerOrder(o:Order) {
 if(o.erasedAt) fail('NOT_FOUND','Order not found.',404)
 return {id:o.id,status:o.status,createdAt:o.createdAt,totalCents:o.totalCents,shippingCents:o.shippingCents??0,...(o.promotion?{promotion:o.promotion}:{}),currency:o.currency,lines:o.lines.map(l=>({sku:l.sku,name:l.name,quantity:l.quantity,unitCents:l.unitCents})),refunds:o.refunds.filter(r=>r.status==='succeeded').map(r=>({id:r.id,amountCents:r.amountCents,status:r.status})),...(o.shipment?.status==='shipped'?{shipment:{status:o.shipment.status,dispatches:o.shipment.dispatches?.map(d=>({id:d.id,shippedAt:d.shippedAt,deliveryStatus:d.deliveryStatus,tracking:d.tracking}))}}:{})}
}
export async function ownOrder(env:Bindings,a:App,c:Customer,id:string) {
 if(!await env.DB.prepare('SELECT order_id FROM st_headless_orders WHERE order_id=? AND customer_id=? AND app_id=?').bind(id,c.id,a.id).first()) fail('NOT_FOUND','Order not found.',404)
 const result=customerOrder(await readOrder(env.DB,id));await fenced(env,a,c);return result
}
export async function ownOrders(env:Bindings,a:App,c:Customer,url:URL) {
 const after=url.searchParams.get('after')??''
 const rows=await env.DB.prepare(`SELECT o.order_id FROM st_headless_orders o JOIN st_orders s ON s.id=o.order_id WHERE o.app_id=? AND o.customer_id=? AND o.order_id>? AND json_extract(s.value_json,'$.erasedAt') IS NULL ORDER BY o.order_id LIMIT 51`).bind(a.id,c.id,after).all<{order_id:string}>()
 const orders=await Promise.all(rows.results.slice(0,50).map(async r=>customerOrder(await readOrder(env.DB,r.order_id))))
 await fenced(env,a,c)
 return {orders,next:rows.results.length>50?rows.results[49].order_id:null}
}

export async function cartQuote(env:Bindings,a:App,c:Customer,id:string,p:any) {
 const found=await cart(env,a,c,id),quote=await quoteShipping(env.DB,await priceLines(env,JSON.parse(found.value_json)),postalCodeOf(p.postalCode))
 const promotion=await promotionQuote(env,{lines:JSON.parse(found.value_json),customerEmail:c.actor.email,promotionCode:p.promotionCode,shipping:p.shipping??{postalCode:p.postalCode}},c.actor.email.toLowerCase())
 await fenced(env,a,c);return {...quote,...(promotion?{promotion}:{})}
}
export async function confirmCheckout(env:Bindings,a:App,c:Customer,p:any) {
 await rate(env,'checkout:'+a.id+':'+c.id,20)
 const id=text(p.orderId,'Order ID',100);await ownOrder(env,a,c,id)
 const result=await confirmReturn(env,id);await fenced(env,a,c);return result
}
