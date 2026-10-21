import { fail,type Order } from './model'
import { readOrder,orders } from './store'
import { businessTimeZone } from './preferences'

/** A partly shipped order is overdue once its latest recorded Pier dispatch is more than 7 x 24 hours old. */
export const overdueAfterMs=7*86400000
const statuses=['checkout_pending','awaiting_payment','paid','shortfall','reserved','shipped']
const shopDay=(zone:string,at:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))
function calendarDate(value:string|null,name:string) {
 if(value===null||value==='') return undefined
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) fail('INPUT',`${name} is a calendar date such as 2026-10-21.`,400)
 return value
}
/** When Pier last shipped part of the order; an unstamped dispatch falls back to payment, then placement. */
export const lastDispatchAt=(order:Order)=>order.shipment?.dispatches?.map(d=>d.shippedAt).filter((at):at is string=>!!at).sort().at(-1)??order.payment?.paidAt??order.createdAt
export const overduePartial=(order:Order,now:number)=>order.shipment?.status==='partial'&&now-Date.parse(lastDispatchAt(order))>overdueAfterMs

/** Filters combine; every given filter must match. Dates are the shop time zone's calendar days of placement, both ends inclusive. */
export async function searchOrders(db:D1Database,query:URLSearchParams,now=Date.now()):Promise<{timeZone:string;total:number;orders:Omit<Order,'requestDigest'|'checkoutKey'>[]}> {
 const timeZone=await businessTimeZone(db),status=query.get('status')||undefined,sku=query.get('sku')?.trim().toLowerCase(),customer=query.get('customer')?.trim().toLowerCase()
 const from=calendarDate(query.get('from'),'From'),to=calendarDate(query.get('to'),'To'),overdue=query.get('overdue')||undefined,channel=query.get('channel')||undefined
 if(channel&&!['online','manual'].includes(channel)) fail('INPUT','Choose Online store or Manual.',400)
 if(status&&!statuses.includes(status)) fail('INPUT','Choose a recorded order status.',400)
 if(overdue&&overdue!=='partial') fail('INPUT','Overdue work is filtered as partial (partly shipped).',400)
 if(from&&to&&from>to) fail('INPUT','The From date must not be after the To date.',400)
 const matches=(order:Order)=>{
  const day=shopDay(timeZone,order.createdAt)
  return (!channel||(order.channel??'online')===channel)&&(!status||order.status===status)&&(!sku||order.lines.some(line=>line.sku.toLowerCase()===sku))
   &&(!customer||[order.customerEmail,order.shippingDetails?.name].some(value=>value?.toLowerCase().includes(customer)))
   &&(!from||day>=from)&&(!to||day<=to)&&(!overdue||overduePartial(order,now))
 }
 const found=(await orders(db)).filter(matches)
 return {timeZone,total:found.length,orders:found.map(({requestDigest,checkoutKey,...order})=>order)}
}

/** One timeline: every audited action on the order, oldest first, with the provider references the record holds. */
export async function orderHistory(db:D1Database,orderId:string) {
 const order=await readOrder(db,orderId)
 const events=await db.prepare('SELECT id,actor,action,at FROM st_audit WHERE subject=? ORDER BY rowid').bind(order.id).all<{id:string;actor:string;action:string;at:string}>()
 return {orderId:order.id,createdAt:order.createdAt,events:events.results,references:{
  checkout:order.checkout?.id,payment:order.payment?.source==='staff'?undefined:order.payment&&{sessionId:order.payment.sessionId,intentId:order.payment.intentId},reservation:order.reservation?.reference,
  shipments:[order.shipment?.reference,...(order.shipment?.dispatches??[]).map(d=>d.reference)].filter(Boolean),refunds:order.refunds.filter(r=>r.stripeId).map(r=>r.stripeId)}}
}
