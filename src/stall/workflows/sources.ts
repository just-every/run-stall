import type { Bindings } from '../../auth.server'
import { catalogue,decimal } from '../pier'
import { orders } from '../store'
import { localInstant,localParts,minute } from './time'
import type { RuleValue } from './rules'

export type Match={eventKey:string;sourceKind:string;sourceId:string;explanation:string;observedAt:string}
export function sourceSupport(trigger:RuleValue['trigger']) {
 return {available:true,reason:trigger==='customer'?'Native headless customer identities created by independently authenticated customers.':trigger==='promotion'?'Native promotion creation, change and revocation events; no promotion code is copied into work.':'Current source records; no arbitrary event ingestion.'}
}
/** Dry runs never mutate observations. Stock event episodes are persisted only
 * during active evaluation, so a dry run cannot consume a future event. */
export async function matches(env:Bindings,value:RuleValue,zone:string,at:number,observe=false):Promise<Match[]> {
 const stamp=new Date(at).toISOString(),c=value.conditions
 if(value.trigger==='promotion') {
  const rows=await env.DB.prepare(`SELECT e.id,e.resource_id FROM st_headless_events e JOIN st_promotions p ON p.id=e.resource_id WHERE e.kind='promotion' ORDER BY e.occurred_at,e.id`).all<{id:string;resource_id:string}>()
  return rows.results.map(r=>({eventKey:r.id,sourceKind:'promotion',sourceId:r.resource_id,explanation:'A native promotion was created, changed or revoked. Staff follow-up never applies or changes a promotion automatically.',observedAt:stamp}))
 }
 if(value.trigger==='scheduled_reconciliation') {
  const day=localParts(at,zone).date,instant=localInstant(day,minute(value.localTime),zone)
  return instant<=at?[{eventKey:`scheduled:${day}`,sourceKind:'schedule',sourceId:day,explanation:`Daily reconciliation at ${value.localTime} ${zone} (${new Date(instant).toISOString()}); follow-up requires a person.`,observedAt:stamp}]:[]
 }
 if(value.trigger==='low_stock') {
  const stock=await catalogue(env),out:Match[]=[]
  for(const item of stock.items) {
   if(c.sku&&c.sku!==item.sku) continue
   let eventKey=`stock:${item.sku}:${item.available}`
   if(observe) {
    const row=await env.DB.prepare(`INSERT INTO st_workflow_sources(id,fingerprint,event_key,observed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,event_key=CASE WHEN fingerprint=excluded.fingerprint THEN event_key ELSE excluded.event_key END,observed_at=excluded.observed_at RETURNING event_key`).bind('stock:'+item.sku,item.available,crypto.randomUUID(),stamp).first<{event_key:string}>()
    eventKey='stock:'+row!.event_key
   } else {
    const previous=await env.DB.prepare('SELECT event_key FROM st_workflow_sources WHERE id=? AND fingerprint=?').bind('stock:'+item.sku,item.available).first<{event_key:string}>()
    if(previous) eventKey='stock:'+previous.event_key
   }
   if(decimal(item.available)<=BigInt(c.stockAtMost!)*1000000n) out.push({eventKey,sourceKind:'stock',sourceId:item.sku,explanation:`Pier currently reports ${item.available} sellable units; threshold ${c.stockAtMost}.`,observedAt:stock.observedAt})
  }
  return out
 }
 if(value.trigger==='customer') {
  const customers=await env.DB.prepare(`SELECT c.id,c.created_at FROM st_headless_customers c JOIN oa_operators o ON o.id=c.operator_id WHERE o.status='active' ORDER BY c.id`).all<{id:string;created_at:string}>()
  return customers.results.map(r=>({eventKey:'customer:'+r.id,sourceKind:'customer',sourceId:r.id,explanation:'Current native customer identity; customer contact is not copied into tasks.',observedAt:stamp}))
 }
 if(value.trigger==='return_confirmed') {
  const rows=await env.DB.prepare(`SELECT r.id,r.order_id FROM st_return_receipts r JOIN st_orders o ON o.id=r.order_id WHERE json_extract(o.value_json,'$.erasedAt') IS NULL ORDER BY r.created_at,r.id`).all<{id:string;order_id:string}>()
  return rows.results.map(r=>({eventKey:'return.received:'+r.id,sourceKind:'return_receipt',sourceId:r.id,explanation:`Staff confirmed receipt for order ${r.order_id}. Inspect and arrange separately authorized stock work; no restock or refund is asserted.`,observedAt:stamp}))
 }
 if(value.trigger==='return_request'||value.trigger==='cancellation_request') {
  const kind=value.trigger==='return_request'?'return':'cancellation'
  const rows=await env.DB.prepare(`SELECT r.id,r.order_id FROM st_workflow_requests r JOIN st_orders o ON o.id=r.order_id WHERE r.kind=? AND json_extract(o.value_json,'$.erasedAt') IS NULL ORDER BY r.created_at,r.id`).bind(kind).all<{id:string;order_id:string}>()
  return rows.results.map(r=>({eventKey:'request:'+r.id,sourceKind:kind,sourceId:r.order_id,explanation:`Customer independently authenticated and requested ${kind} for their own current order; no refund, restock or cancellation is authorized.`,observedAt:stamp}))
 }
 const list=await orders(env.DB)
 // A workflow's own draft revision is an output, never a new order trigger.
 const prepared=await env.DB.prepare('SELECT order_id,draft_revision FROM st_workflow_drafts').all<{order_id:string;draft_revision:string}>()
 const ownRevisions=new Set(prepared.results.map(r=>`${r.order_id}:${r.draft_revision}`))
 return list.flatMap(o=>{
  if(value.trigger==='order'&&ownRevisions.has(`${o.id}:${o.revision}`)) return []
  if(o.erasedAt||(c.sku&&!o.lines.some(l=>l.sku===c.sku))||(c.status&&o.status!==c.status)||(c.minTotalCents!==undefined&&o.totalCents<c.minTotalCents)||(c.maxTotalCents!==undefined&&o.totalCents>c.maxTotalCents)) return []
  let eventKey=`order:${o.id}:${o.revision}`,explanation=`Current order revision ${o.revision}; status ${o.status}, total ${o.totalCents} USD cents.`
  if(value.trigger==='overdue_fulfillment') {
   if(!o.payment||o.status==='shipped'||o.shipment?.status==='shipped') return []
   const dates=(o.shipment?.dispatches??[]).flatMap(d=>d.shippedAt&&Number.isFinite(Date.parse(d.shippedAt))?[Date.parse(d.shippedAt)]:[])
   const base=dates.length?Math.max(...dates):Date.parse(o.payment.paidAt)
   if(!Number.isFinite(base)||at-base<=c.overdueHours!*3600000) return []
   eventKey=`overdue:${o.id}:${new Date(base).toISOString()}`
   explanation=`Paid and not completely shipped; latest dispatch/payment is older than ${c.overdueHours} elapsed hours.`
  }
  return [{eventKey,sourceKind:'order',sourceId:o.id,explanation,observedAt:stamp}]
 })
}
