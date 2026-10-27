import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge,publish,deliverWebhook } from './network.mjs'
export function visitor(h,initial='') {
 const jar=new Map(initial.split(';').map(s=>s.trim().split('=' )).filter(([k,v])=>k&&v))
 const cookie=()=>[...jar].map(([k,v])=>k+'='+v).join('; ')
 async function call(path,body,options={}) {
  const response=await h.request(path,{as:cookie(),...(body===undefined?{}:{method:'POST',body}),...options})
  for(const c of response.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k)}
  const value=await response.json();assert.equal(response.status,options.status??200,JSON.stringify(value));return value
 }
 return {cookie,call,async consent(analytics=true){const p=await call('/api/stall/privacy');return call('/api/stall/privacy',{policyVersion:p.policyVersion,analytics,advertising:false,doNotSellOrShare:true,region:'US'})},event:(kind='visit',path='/shop',extra={},options={})=>call('/api/stall/analytics/events',{id:randomUUID(),kind,path,...extra},options)}
}
export const analyticsWindow='?from=2020-01-01&to=2030-12-31'
export async function analyticsFixture({variantProducts=false}={}) {
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward,livemode:true}),secret=randomUUID()
 let h
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-928',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
  if(variantProducts) {
   const product=await h.command('product.prepare',{sku:'STUDIO',name:'Studio goods',description:'Made in the studio',unitCents:1000,active:true,details:{options:[{name:'Style',values:['Mug','Towel']}],variants:[{sku:'MUG-BLUE',options:{Style:'Mug'},unitCents:1000},{sku:'TOWEL-NAT',options:{Style:'Towel'},unitCents:500}]}})
   await h.command('product.approve',{sku:'STUDIO',revision:product.revision})
  }else{await publish(h,'MUG-BLUE','Blue ceramic mug',1000);await publish(h,'TOWEL-NAT','Natural linen towel',500)}
  await h.command('shipping.configure',{shippingCents:200})
  const order=async id=>(await h.api('/api/stall/state')).orders.find(o=>o.id===id)
  async function buy(v,{lines=[{sku:'MUG-BLUE',quantity:2}],pay=true,extra={}}={}) {
   const payload={customerEmail:'synthetic-stall-928@example.test',lines,idempotencyKey:randomUUID(),...extra}
   const result=await v.call('/api/stall/checkout',payload)
   const session=[...edge.sessions.values()].find(s=>s.client_reference_id===result.orderId);assert.ok(session)
   if(pay){edge.pay(session.id);const delivered=await deliverWebhook(h,secret,session);assert.equal(delivered.response.status,200,JSON.stringify(delivered.value))}
   return {payload,result,session,order:await order(result.orderId)}
  }
  async function refund(id,lines=[{sku:'MUG-BLUE',quantity:1}]) {let o=await order(id);o=await h.command('shipment.prepare',{orderId:id,revision:o.revision,reference:'synthetic-stall-928-dispatch'});o=await h.command('shipment.approve',{orderId:id,revision:o.revision});o=await h.command('refund.prepare',{orderId:id,revision:o.revision,lines,reason:'Return recorded goods'});return h.command('refund.approve',{orderId:id,revision:o.revision})}
  return {h,pier,edge,secret,order,buy,refund,async close(){await h.close();await pier.close()}}
 }catch(e){await h?.close();await pier.close();throw e}
}
