import type { Bindings } from '../../auth.server'
import { Problem,type Order } from '../model'
import { catalogue,decimal } from '../pier'
import type { Policy } from './policy'

export type CaseLine={sku:string;name:string;quantity:number;reason?:string;toSku?:string;toName?:string}
export type CaseRow={id:string;order_id:string;kind:'cancellation'|'return'|'exchange';state:string;lines_json:string}
const day=86400000
export type LineView={sku:string;name:string;purchased:number;remaining:number;eligible:boolean;reasons:string[];exchangeOptions:{sku:string;name:string;availableQuantity:number}[]}
export const shippedAt=(order:Order)=>order.shipment?.status==='shipped'?Math.max(...(order.shipment.dispatches??[]).map(d=>Date.parse(d.shippedAt??''))):NaN
const wholeUnits=(available:string)=>Number(decimal(available)/1000000n)
/** Server-side eligibility for each purchased line. Every refusal carries the shopper-readable rule behind it. */
export async function eligibility(env:Bindings,order:Order,policy:Policy|null,cases:CaseRow[],now=Date.now()) {
 const active=cases.filter(c=>c.order_id===order.id&&['requested','accepted'].includes(c.state))
 const cancellation=!order.payment?{eligible:false,reason:'This order has no recorded payment.'}
  :order.shipment&&order.shipment.status!=='draft'?{eligible:false,reason:'Fulfillment has started, so the order can no longer be canceled. Request a return after it arrives.'}
  :{eligible:true}
 const sent=shippedAt(order),endsAt=policy&&Number.isFinite(sent)?sent+policy.windowDays*day:NaN
 let stock:{items:any[]}|null=null,stockStatus:'checked'|'unavailable'='checked'
 if(policy?.exchanges&&Number.isFinite(sent)) {try{stock=await catalogue(env)}catch(error){if(!(error instanceof Problem))throw error;stockStatus='unavailable'}}
 const lines:LineView[]=order.lines.map(line=>{
  const taken=active.filter(c=>c.kind!=='cancellation').flatMap(c=>JSON.parse(c.lines_json) as CaseLine[]).filter(l=>l.sku===line.sku).reduce((n,l)=>n+l.quantity,0)
  const refunded=order.refunds.filter(r=>['pending','succeeded'].includes(r.status)).flatMap(r=>r.lines??[]).filter(l=>l.sku===line.sku).reduce((n,l)=>n+l.quantity,0)
  const remaining=Math.max(0,line.quantity-taken-refunded),reasons:string[]=[]
  if(!policy) reasons.push('The shop has not published a return policy yet.')
  else if(policy.finalSaleSkus.includes(line.sku)||(line.productSku&&policy.finalSaleSkus.includes(line.productSku))) reasons.push('Final sale: this item cannot be returned or exchanged.')
  else if(!Number.isFinite(sent)) reasons.push('Returns open once the order has shipped. You can request cancellation until then.')
  else if(now>endsAt) reasons.push(`The ${policy.windowDays}-day return window ended on ${new Date(endsAt).toISOString().slice(0,10)}.`)
  if(!reasons.length&&!remaining) reasons.push('Every unit is already requested or refunded.')
  const product=line.productSku??stock?.items.find(item=>item.sku===line.sku)?.productSku
  const exchangeOptions=!reasons.length&&stock&&product?stock.items.filter(item=>item.productSku===product&&item.sku!==line.sku).map(item=>({sku:item.sku as string,name:item.name as string,availableQuantity:Math.min(wholeUnits(item.available),remaining)})).filter(option=>option.availableQuantity>0):[]
  return {sku:line.sku,name:line.name,purchased:line.quantity,remaining,eligible:!reasons.length,reasons,exchangeOptions}
 })
 return {orderId:order.id,cancellation,returnsOpen:Number.isFinite(sent)?{endsAt:Number.isFinite(endsAt)?new Date(endsAt).toISOString():null}:null,exchangeStock:policy?.exchanges?stockStatus:'not_offered' as const,lines}
}
