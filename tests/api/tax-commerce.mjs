import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge,publish,deliverWebhook } from './network.mjs'
import { taxEdge } from './tax-edge.mjs'

export const taxAddress={line1:'1 synthetic-stall-street',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
export async function taxCommerceInstallation() {
 const pier=await pierInstallation(),stripe=stripeEdge({forward:pier.forward}),tax=taxEdge(),secret=randomUUID()
 let h
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-806',STRIPE_WEBHOOK_SECRET:secret},outboundService:request=>new URL(request.url).hostname==='api.stripe.com'&&(/^\/v1\/tax\//.test(new URL(request.url).pathname)||new URL(request.url).pathname==='/v1/account')?tax.handle(request):stripe.handle(request)})
  await publish(h,'MUG-BLUE','Blue ceramic mug',1000);await publish(h,'TOWEL-NAT','Natural linen towel',500)
  await h.command('shipping.configure',{shippingCents:200})
  const config=await h.api('/api/stall/tax/configuration')
  await h.api('/api/stall/tax/configuration',{revision:config.revision,value:{shipFrom:{...taxAddress,line1:'1200 Cedar Avenue'},categories:[{sku:'MUG-BLUE',taxCode:'txcd_99999999'},{sku:'TOWEL-NAT',taxCode:'txcd_00000000'}],thresholds:[{state:'TX',salesCents:3000,transactions:10,warningPercent:80}]}})
  const mode=await h.api('/api/stall/tax/commerce?review=1')
  await h.api('/api/stall/tax/commerce',{revision:mode.revision,enabled:true,consent:mode.consent})
  const consent=(await h.api('/api/stall/tax/mode',undefined,{as:''})).shopperConsent
  const order=async id=>(await h.api('/api/stall/state')).orders.find(o=>o.id===id)
  async function quote({destination=taxAddress,customerEmail='synthetic-stall-shopper@example.test',lines=[{sku:'MUG-BLUE',quantity:2},{sku:'TOWEL-NAT',quantity:1}],as='',...extra}={}) {
   const shippingQuote=await h.api('/api/stall/shipping/quote',{lines,postalCode:destination.postal_code},{as}),service=shippingQuote.services[0]
   const input={id:randomUUID(),destination,customerEmail,lines,shipping:{service:service.code,postalCode:destination.postal_code,quote:service.quote},consent,...extra}
   return {input,result:await h.api('/api/stall/tax/quote',input,{as})}
  }
  async function buy(quoted,{as='',pay=true}={}) {
   const {input,result}=quoted,payload={idempotencyKey:randomUUID(),customerEmail:input.customerEmail,lines:input.lines,shipping:input.shipping,expectedTotalCents:result.totalCents,taxQuoteId:result.quoteId,...(input.promotionCode?{promotionCode:input.promotionCode}:{})},started=await h.api('/api/stall/checkout',payload,{as})
   const session=[...stripe.sessions.values()].find(s=>s.client_reference_id===started.orderId);assert.ok(session)
   if(pay){stripe.pay(session.id,input.destination);const observed=await deliverWebhook(h,secret,session);assert.equal(observed.response.status,200,JSON.stringify(observed.value))}
   return {started,session,payload,order:await order(started.orderId)}
  }
  async function ship(id) {let value=await order(id);value=await h.command('shipment.prepare',{orderId:id,revision:value.revision,reference:'synthetic-stall-tax-dispatch'});return h.command('shipment.approve',{orderId:id,revision:value.revision})}
  async function refund(id,lines=[{sku:'MUG-BLUE',quantity:1}]) {let value=await order(id);value=await h.command('refund.prepare',{orderId:id,revision:value.revision,kind:'lines',lines,reason:'Returned one purchased item'});return h.command('refund.approve',{orderId:id,revision:value.revision})}
  return {h,pier,stripe,tax,secret,quote,buy,ship,refund,order,async close(){await h.close();await pier.close()}}
 }catch(error){await h?.close();await pier.close();throw error}
}
