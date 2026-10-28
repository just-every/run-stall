import { netLineCents } from './promotions/paid-values'
import type { Bindings } from '../auth.server'
import { fail,type Line,type Order } from './model'
import { products } from './store'
import { listingState } from './listing'
import { listingEntries } from './listing-view'
import { demoEffect } from '../modules/demo/index.mjs'
import { demoPier } from './demo/providers'
import { paymentsReady } from './stripe'
import { pierWrite } from './pier-work'
const SCALE=1000000n
export function decimal(value:string):bigint {
 if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,6})?$/.test(value)) fail('PIER_RESPONSE','Pier returned an invalid stock quantity.',502)
 const [whole,fraction='']=value.split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'))
}
function format(value:bigint) { return `${value/SCALE}${value%SCALE?'.'+(value%SCALE).toString().padStart(6,'0').replace(/0+$/,''):''}` }
export function pierOrigin(env:Bindings):string {
 if(!env.PIER_ORIGIN||!env.PIER_SESSION||!env.PIER_CUSTOMER_ID) fail('PIER_UNAVAILABLE','Connect Pier and select an existing shop customer before accepting orders.',503)
 let url:URL;try { url=new URL(env.PIER_ORIGIN) }catch { return fail('PIER_UNAVAILABLE','Pier origin is invalid.',503) }
 if(url.origin!==env.PIER_ORIGIN||url.username||url.password||(url.protocol!=='https:'&&!(env.AUTH_LOCAL==='true'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) fail('PIER_UNAVAILABLE','Use a secure Pier origin.',503)
 return url.origin
}
export const pierConfigured=(env:Bindings)=>Boolean(env.PIER_ORIGIN&&env.PIER_SESSION&&env.PIER_CUSTOMER_ID)
async function request(env:Bindings,base:string,path:string,body?:unknown):Promise<any> {
 let response:Response
 try { response=await fetch(base+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{cookie:env.PIER_SESSION!,origin:base,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) }
 catch { return fail('PIER_UNAVAILABLE','Pier did not answer. Reconcile this order to resume the same operation.',503) }
 const value:any=await response.json().catch(()=>null)
 if(!response.ok||value?.ok===false) {
  const reason=typeof value?.error?.message==='string'?value.error.message.slice(0,1500):undefined
  const code=typeof value?.error?.code==='string'?value.error.code:'REFUSED'
  if(response.status===401||response.status===403) fail('PIER_CREDENTIAL',reason?`Pier: ${reason}`:'Pier did not accept the saved credential. It may be expired or revoked after a restore. In Pier, open Channels, create a new key for Stall, then paste it into Stall Settings → Connect Pier.',503)
  fail(`PIER_${code}`,reason?`Pier: ${reason}`:`Pier returned HTTP ${response.status}. Check this order in Pier before reconciling.`,response.status>=500?503:409)
 }
 if(!value||typeof value!=='object') fail('PIER_RESPONSE','Pier did not return a readable response. Check its address in Settings.',502)
 return value
}
async function call(env:Bindings,path:string,body?:unknown):Promise<any> {
 const base=pierOrigin(env)
 // A demo shop works against its own simulated Pier stock desk (demo/providers.ts).
 const value:any=await demoEffect(()=>request(env,base,path,body),()=>demoPier(env.DB,path,body))
 if(value.ok===false) fail('PIER_REJECTED','Pier refused this operation. Check the order at the stock desk.',409)
 return value
}
export const pierState=(env:Bindings)=>call(env,'/api/pier/state')
export async function catalogue(env:Bindings) {
 const now=Date.now(),listings=(await products(env.DB)).filter(p=>listingState(p.value,now)==='published')
 // An unpublished shop has no stock promises to ask Pier about.
 if(!listings.length) return {items:[],products:[],observedAt:new Date().toISOString(),checkoutReady:false}
 const state=await pierState(env)
 if(!Array.isArray(state.items)||!Array.isArray(state.locations)||!Array.isArray(state.positions)||!Array.isArray(state.parties)) fail('PIER_RESPONSE','Pier stock response is incomplete.',502)
 if(!state.parties.some((p:any)=>p.id===env.PIER_CUSTOMER_ID&&p.kind==='customer')) fail('PIER_CUSTOMER','Select an existing Pier customer for shop orders.',503)
 const bins=new Set(state.locations.filter((l:any)=>l.kind==='bin').map((l:any)=>l.id))
 const stock=(sku:string)=>{
  const item=state.items.find((i:any)=>i.sku===sku&&!i.archived)
  if(!item) return null
  return {itemId:item.id as string,available:format(state.positions.filter((x:any)=>x.itemId===item.id&&x.status==='sellable'&&bins.has(x.locationId)).reduce((sum:bigint,x:any)=>sum+decimal(x.available),0n))}
 }
 const entries=listings.map(p=>listingEntries(p.value,stock)).filter(entry=>entry.items.length)
 return {items:entries.flatMap(entry=>entry.items),products:entries.map(entry=>entry.product),observedAt:new Date().toISOString(),checkoutReady:paymentsReady(env)}
}
export function assertOriginalPier(env:Bindings,order:Order) { if(pierOrigin(env)!==order.pierOrigin||env.PIER_CUSTOMER_ID!==order.pierCustomerId) fail('PIER_CHANGED','Reconnect the original Pier installation and shop customer before reconciling this order.') }
async function commandWork(env:Bindings,o:Order,command:Parameters<typeof pierWrite>[2],providerCorrelation:string) {
 assertOriginalPier(env,o)
 return pierWrite(env,{orderId:o.id,pierOrigin:o.pierOrigin,pierCustomerId:o.pierCustomerId,providerCorrelation},command,
  async original=>(await call(env,'/api/pier/commands',original)).result,
  async ()=>{ assertOriginalPier(env,o);const state=await pierState(env);if(!Array.isArray(state.orders)||!Array.isArray(state.shipments)) fail('PIER_RESPONSE','Pier recovery requires a readable current order and shipment state.',502) })
}
export async function reserveOrder(env:Bindings,o:Order) {
 assertOriginalPier(env,o)
 const result=await commandWork(env,o,{commandId:`stall-reserve-${o.id}`,type:'order.create',payload:{customerId:o.pierCustomerId,channel:'stall',currency:o.currency.toUpperCase(),lines:o.lines.flatMap(l=>{const cents=netLineCents(o,l),unit=Math.floor(cents/l.quantity),extra=cents%l.quantity;return [{itemId:l.itemId,quantity:l.quantity-extra,price:unit},{itemId:l.itemId,quantity:extra,price:unit+1}].filter(b=>b.quantity>0).map(b=>({...b,quantity:String(b.quantity),price:(b.price/100).toFixed(2)}))})}},o.id)
 if(typeof result?.id!=='string') fail('PIER_RESPONSE','Pier did not return the reserved order. Reconcile the same order to recover it.',502)
 // Pier's order contains merchandise only. Allocate that portion of the verified
 // charge to it; the separate shipping charge and gross payment remain in Stall.
 const merchandiseCents=o.lines.reduce((sum,line)=>sum+netLineCents(o,line),0)
 if(o.payment&&o.payment.source!=='staff') await commandWork(env,o,{commandId:`stall-payment-${o.id}`,type:'order.channelPayment',payload:{orderId:result.id,payment:{provider:'stripe',reference:o.payment.intentId,amount:(merchandiseCents/100).toFixed(2),currency:o.currency.toUpperCase(),paidAt:o.payment.paidAt,orderReference:o.id}}},o.payment.intentId)
 return result
}
/** An accepted exchange sets the replacement aside under its own deterministic Pier command; replay after a lost response returns the original reservation. */
export async function reserveExchange(env:Bindings,o:Order,caseId:string,lines:{sku:string;quantity:number;unitCents:number}[]) {
 assertOriginalPier(env,o)
 const commandId=`stall-exchange-${caseId}`,journaled=await env.DB.prepare('SELECT 1 FROM st_pier_work WHERE id=?').bind(commandId).first()
 const stock=await catalogue(env)
 const wanted=lines.map(line=>{
  const item=stock.items.find(entry=>entry.sku===line.sku)
  if(!item||(!journaled&&BigInt(line.quantity)*SCALE>decimal(item.available))) fail('EXCHANGE_STOCK',`${line.sku} is no longer available in the requested quantity. Refuse the exchange or offer a return.`)
  return {itemId:item.itemId,quantity:line.quantity,unitCents:line.unitCents}
 })
 const result=await commandWork(env,o,{commandId,type:'order.create',payload:{customerId:o.pierCustomerId,channel:'stall',currency:o.currency.toUpperCase(),lines:wanted.map(l=>({itemId:l.itemId,quantity:String(l.quantity),price:(l.unitCents/100).toFixed(2)}))}},caseId)
 if(typeof result?.id!=='string'||!fullyReserved(result,wanted as unknown as Line[])) fail('PIER_RESPONSE','Pier did not reserve the full replacement. Try the same decision again to recover it.',502)
 return {pierOrderId:result.id as string,lines:lines.map(({sku,quantity})=>({sku,quantity}))}
}
export function fullyReserved(result:any,lines:Line[],splitLines=false) {
 return Array.isArray(result?.lines)&&(splitLines?result.lines.length>=lines.length&&result.lines.length<=lines.length*2:result.lines.length===lines.length)&&result.lines.every((x:any)=>lines.some(l=>l.itemId===x.itemId))&&lines.every(l=>{
  const matches=result.lines.filter((x:any)=>x.itemId===l.itemId)
  return (splitLines?matches.length>=1&&matches.length<=2:matches.length===1)&&matches.reduce((n:bigint,x:any)=>n+decimal(x.quantity),0n)===BigInt(l.quantity)*SCALE&&matches.reduce((n:bigint,x:any)=>n+decimal(x.reserved),0n)===BigInt(l.quantity)*SCALE&&matches.every((x:any)=>decimal(x.quantity)>0n&&decimal(x.cancelled)===0n&&decimal(x.dispatched)===0n)
 })
}
export async function dispatchOrder(env:Bindings,o:Order) {
 assertOriginalPier(env,o)
 if(!o.reservation||!o.shipment) fail('RESERVATION','Reserve stock and prepare a shipment first.')
 const lines=o.reservation.lines.map(line=>{
  if(typeof line?.id!=='string'||!o.lines.some(l=>l.itemId===line.itemId))fail('PIER_RESPONSE','Pier order line is missing. Reconcile this order first.',502)
  return {orderLineId:line.id,quantity:String(line.quantity)}
 })
 return commandWork(env,o,{commandId:`stall-ship-${o.shipment.id}`,type:'dispatch.create',payload:{orderId:o.reservation.id,shipmentReference:o.shipment.reference,lines}},o.reservation.id)
}
