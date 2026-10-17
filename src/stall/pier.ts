import type { Bindings } from '../auth.server'
import { fail,type Line,type Order } from './model'
import { products } from './store'
import { demoEffect } from '../modules/demo/index.mjs'
import { demoPier } from './demo/providers'
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
 if(!response.ok) fail('PIER_UNAVAILABLE','Pier refused the request. Check its connection and stock desk before reconciling.',503)
 return response.json()
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
 const listings=(await products(env.DB)).filter(p=>p.value.active)
 // An unpublished shop has no stock promises to ask Pier about.
 if(!listings.length) return {items:[],observedAt:new Date().toISOString(),checkoutReady:false}
 const state=await pierState(env)
 if(!Array.isArray(state.items)||!Array.isArray(state.locations)||!Array.isArray(state.positions)||!Array.isArray(state.parties)) fail('PIER_RESPONSE','Pier stock response is incomplete.',502)
 if(!state.parties.some((p:any)=>p.id===env.PIER_CUSTOMER_ID&&p.kind==='customer')) fail('PIER_CUSTOMER','Select an existing Pier customer for shop orders.',503)
 const bins=new Set(state.locations.filter((l:any)=>l.kind==='bin').map((l:any)=>l.id))
 const items=listings.flatMap(p=>{
  const item=state.items.find((i:any)=>i.sku===p.id&&!i.archived)
  if(!item) return []
  const available=state.positions.filter((x:any)=>x.itemId===item.id&&x.status==='sellable'&&bins.has(x.locationId)).reduce((sum:bigint,x:any)=>sum+decimal(x.available),0n)
  return [{sku:p.id,name:p.value.name,description:p.value.description,unitCents:p.value.unitCents,itemId:item.id,available:format(available)}]
 })
 return {items,observedAt:new Date().toISOString(),checkoutReady:Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET)}
}
export function assertOriginalPier(env:Bindings,order:Order) { if(pierOrigin(env)!==order.pierOrigin||env.PIER_CUSTOMER_ID!==order.pierCustomerId) fail('PIER_CHANGED','Reconnect the original Pier installation and shop customer before reconciling this order.') }
export async function reserveOrder(env:Bindings,o:Order) {
 assertOriginalPier(env,o)
 return (await call(env,'/api/pier/commands',{commandId:`stall-reserve-${o.id}`,type:'order.create',payload:{customerId:o.pierCustomerId,lines:o.lines.map(l=>({itemId:l.itemId,quantity:String(l.quantity)}))}})).result
}
export function fullyReserved(result:any,lines:Line[]) {
 return Array.isArray(result?.lines)&&result.lines.length===lines.length&&lines.every(l=>{
  const matches=result.lines.filter((x:any)=>x.itemId===l.itemId)
  return matches.length===1&&decimal(matches[0].quantity)===BigInt(l.quantity)*SCALE&&decimal(matches[0].reserved)===BigInt(l.quantity)*SCALE&&decimal(matches[0].cancelled)===0n&&decimal(matches[0].dispatched)===0n
 })
}
export async function dispatchOrder(env:Bindings,o:Order) {
 assertOriginalPier(env,o)
 if(!o.reservation||!o.shipment) fail('RESERVATION','Reserve stock and prepare a shipment first.')
 const lines=o.lines.map(l=>{
  const line=o.reservation!.lines.find(x=>x.itemId===l.itemId)
  if(typeof line?.id!=='string') fail('PIER_RESPONSE','Pier order line is missing. Reconcile this order first.',502)
  return {orderLineId:line.id,quantity:String(l.quantity)}
 })
 return (await call(env,'/api/pier/commands',{commandId:`stall-ship-${o.shipment.id}`,type:'dispatch.create',payload:{orderId:o.reservation.id,shipmentReference:o.shipment.reference,lines}})).result
}
