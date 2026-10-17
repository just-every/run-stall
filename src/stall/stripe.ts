import type { Bindings } from '../auth.server'
import { fail,shopCountry,shopCurrency,type Order,type Refund } from './model'
import { demoEffect } from '../modules/demo/index.mjs'
import { demoStripe } from './demo/providers'
export async function stripe(env:Bindings,path:string,form?:URLSearchParams,key?:string):Promise<any> {
 if(!env.STRIPE_SECRET_KEY) fail('STRIPE_UNAVAILABLE','Connect Stripe before accepting payments or issuing refunds.',503)
 // A demo shop works against its own simulated Stripe account (demo/providers.ts).
 return demoEffect(()=>request(env,path,form,key),()=>demoStripe(env.DB,path,form))
}
async function request(env:Bindings,path:string,form?:URLSearchParams,key?:string):Promise<any> {
 let response:Response
 try { response=await fetch('https://api.stripe.com/v1'+path,{method:form?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':'2025-06-30.basil',...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(form?{body:form.toString()}:{})}) }
 catch { return fail('STRIPE_UNAVAILABLE','Stripe did not answer. The operation is saved; retry or reconcile the same order.',503) }
 if(!response.ok) fail('STRIPE_UNAVAILABLE','Stripe refused this operation. Check the payment dashboard, then reconcile the same order.',503)
 return response.json()
}
// Stripe may discard idempotency keys after 24 hours. Never blindly repeat an unknown write after that window.
function writeWindow(at:string) { if(Date.now()-Date.parse(at)>23*3600000) fail('STRIPE_RECOVERY','This unresolved operation is outside the safe retry window. Recover its existing Stripe ID in the dashboard before continuing.',409) }
export async function createCheckout(env:Bindings,o:Order) {
 writeWindow(o.createdAt)
 const form=new URLSearchParams({mode:'payment',customer_email:o.customerEmail!,client_reference_id:o.id,'metadata[stall_order_id]':o.id,'payment_intent_data[metadata][stall_order_id]':o.id,success_url:env.AUTH_ORIGIN+'/order?checkout=success&orderId='+encodeURIComponent(o.id),cancel_url:env.AUTH_ORIGIN+'/order?checkout=cancelled&orderId='+encodeURIComponent(o.id),'shipping_address_collection[allowed_countries][0]':shopCountry})
 o.lines.forEach((l,i)=>{form.set(`line_items[${i}][quantity]`,String(l.quantity));form.set(`line_items[${i}][price_data][currency]`,shopCurrency);form.set(`line_items[${i}][price_data][unit_amount]`,String(l.unitCents));form.set(`line_items[${i}][price_data][product_data][name]`,l.name)})
 return stripe(env,'/checkout/sessions',form,`stall-checkout-${o.id}`)
}
export const checkoutSession=(env:Bindings,id:string)=>stripe(env,'/checkout/sessions/'+encodeURIComponent(id))
export async function createRefund(env:Bindings,o:Order,r:Refund) {
 writeWindow(r.startedAt!)
 return stripe(env,'/refunds',new URLSearchParams({payment_intent:o.payment!.intentId,amount:String(r.amountCents),'metadata[stall_order_id]':o.id,'metadata[stall_refund_id]':r.id}),`stall-refund-${r.id}`)
}
export const retrieveRefund=(env:Bindings,id:string)=>stripe(env,'/refunds/'+encodeURIComponent(id))
export function validateSession(o:Order,s:any,paid=false) {
 if(typeof s?.id!=='string'||!/^cs_[A-Za-z0-9_]+$/.test(s.id)||s.object!=='checkout.session'||s.mode!=='payment'||s.client_reference_id!==o.id||s.metadata?.stall_order_id!==o.id||s.currency!==shopCurrency||s.amount_total!==o.totalCents||(o.checkout&&o.checkout.id!==s.id)||(o.payment&&o.payment.sessionId!==s.id)) fail('PAYMENT_MISMATCH','Stripe session does not match this order.',400)
 if(paid&&(s.payment_status!=='paid'||s.status!=='complete'||typeof s.payment_intent!=='string'||!/^pi_[A-Za-z0-9_]+$/.test(s.payment_intent)||(o.payment&&o.payment.intentId!==s.payment_intent))) fail('PAYMENT_MISMATCH','Stripe has not confirmed the expected completed payment.',400)
}
export async function signedEvent(request:Request,env:Bindings) {
 if(!env.STRIPE_WEBHOOK_SECRET) fail('WEBHOOK_UNAVAILABLE','Stripe webhook is not configured.',503)
 const body=await rawBody(request,1000000),header=request.headers.get('stripe-signature')??''
 const parts=header.split(',').map(x=>x.trim().split('=')),times=parts.filter(x=>x[0]==='t')
 if(times.length!==1||!/^\d+$/.test(times[0][1]??'')) fail('SIGNATURE','Invalid Stripe signature.',400)
 const stamp=Number(times[0][1]);if(!Number.isSafeInteger(stamp)||Math.abs(Date.now()/1000-stamp)>300) fail('SIGNATURE','Stripe signature timestamp is outside the accepted window.',400)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 let valid=false
 for(const [kind,hex] of parts) if(kind==='v1'&&/^[a-f0-9]{64}$/.test(hex??'')) {
  const signature=Uint8Array.from(hex.match(/../g)!,x=>parseInt(x,16))
  if(await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(`${stamp}.${body}`))) valid=true
 }
 if(!valid) fail('SIGNATURE','Invalid Stripe signature.',400)
 let event:any;try { event=JSON.parse(body) }catch { return fail('INPUT','Invalid event JSON.',400) }
 if(typeof event?.id!=='string'||!/^evt_[A-Za-z0-9_]+$/.test(event.id)||typeof event.type!=='string') fail('INPUT','Invalid Stripe event.',400)
 return {event,body}
}
export async function rawBody(request:Request,limit:number) {
 if(Number(request.headers.get('content-length')??0)>limit) fail('INPUT','Request body is too large.',413)
 const reader=request.body?.getReader();if(!reader) return ''
 let size=0;const chunks:Uint8Array[]=[]
 while(true) { const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>limit) { await reader.cancel();fail('INPUT','Request body is too large.',413) };chunks.push(value) }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length }
 try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes) }catch { return fail('INPUT','Request must be valid UTF-8.',400) }
}
