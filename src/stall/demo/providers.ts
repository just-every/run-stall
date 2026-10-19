// A demo shop's own simulated Pier stock desk and Stripe account. Only demos
// reach this (Base's demoEffect, src/stall/pier.ts and stripe.ts): checkout,
// refunds, reservations and dispatches answer as the providers would and change
// this visitor's copy, and nothing leaves. The state lives in Base's demo table,
// which exists only in demos and is erased with the visitor's copy.
import { fail, shopCountry, shopCurrency } from '../model'
import { orderTotal, recordChannelPayment, type ChannelPayment } from './channel-payment'

export const demoPierOrigin = 'https://pier.demo.invalid'
export const demoPierCustomer = 'pier-party-web-shop'
export const demoPierKey = 'stall-demo-pier'
export const demoStripeKey = 'stall-demo-stripe'

export type PierLine = { id: string; itemId: string; quantity: string; reserved: string; cancelled: string; dispatched: string }
export type PierOrder = { id: string; reference: string; customerId: string; channel: string; total: string | null; channelPayment?: ChannelPayment; lines: PierLine[] }
export type PierShipment = { id: string; orderId: string; reference: string; createdAt: string; lines: { orderLineId: string; itemId: string; quantity: string }[] }
export type PierState = {
 items: { id: string; sku: string; name: string; archived: boolean }[]
 locations: { id: string; name: string; kind: string }[]
 positions: { id: string; itemId: string; locationId: string; status: string; available: string }[]
 parties: { id: string; name: string; kind: string }[]
 orders: PierOrder[]
 shipments: PierShipment[]
 commands: Record<string, unknown>
}
export type Address = { line1: string; line2: string; city: string; state: string; postal_code: string; country: string }
export type StripeSession = { id: string; orderId: string; email: string; amount: number; shippingCents?: number; paid: boolean; status: 'open' | 'complete' | 'expired'; intent: string | null; shipping: { name: string; address: Address } }
export type StripeRefund = { id: string; orderId: string; refundId: string; intent: string; amount: number; status: 'succeeded' }
export type StripeState = { sessions: Record<string, StripeSession>; refunds: Record<string, StripeRefund> }

async function read<T>(db: D1Database, name: string): Promise<T> {
 const row = await db.prepare('SELECT value FROM rer_demo WHERE name=?').bind(name).first<{ value: string }>()
 if (!row) fail('DEMO_PROVIDER', 'This demo shop has no simulated provider account.', 503)
 return JSON.parse(row.value)
}
const write = (db: D1Database, name: string, value: unknown) => db.prepare('INSERT INTO rer_demo(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').bind(name, JSON.stringify(value)).run()
export const hex = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '')

// Pier's commands, as the order and dispatch desk answers them.
export async function demoPier(db: D1Database, path: string, body?: any): Promise<unknown> {
 const state = await read<PierState>(db, demoPierKey)
 if (path === '/api/pier/state' && !body) { const { commands: _, ...visible } = state; return visible }
 if (path !== '/api/pier/commands' || typeof body?.commandId !== 'string') return { ok: false }
 if (state.commands[body.commandId]) return { ok: true, result: state.commands[body.commandId] }
 let result: PierOrder | PierShipment
 if (body.type === 'order.create') {
  const bins = new Set(state.locations.filter(l => l.kind === 'bin').map(l => l.id)), n = state.orders.length + 1
  if (body.payload?.customerId !== demoPierCustomer || !Array.isArray(body.payload.lines)) return { ok: false }
  const total = orderTotal(body.payload.lines)
  if (total === undefined) return { ok: false }
  const lines = body.payload.lines.map((line: { itemId: string; quantity: string }, i: number) => {
   let wanted = Number(line.quantity), reserved = 0
   for (const position of state.positions.filter(p => p.itemId === line.itemId && p.status === 'sellable' && bins.has(p.locationId))) {
    const take = Math.min(wanted, Number(position.available))
    position.available = String(Number(position.available) - take); wanted -= take; reserved += take
   }
   return { id: `pier-line-${n}-${i + 1}`, itemId: line.itemId, quantity: line.quantity, reserved: String(reserved), cancelled: '0', dispatched: '0' }
  })
  result = { id: `pier-order-${n}`, reference: `SO-${1300 + n}`, customerId: demoPierCustomer, channel: body.payload.channel ?? 'manual', total, lines }
  state.orders.push(result)
 } else if (body.type === 'order.channelPayment') {
  const order = state.orders.find(o => o.id === body.payload?.orderId)
  if (!order || !recordChannelPayment(order, body.payload.payment)) return { ok: false }
  result = structuredClone(order)
 } else if (body.type === 'dispatch.create') {
  const order = state.orders.find(o => o.id === body.payload?.orderId)
  if (!order || !Array.isArray(body.payload.lines)) return { ok: false }
  const lines = body.payload.lines.map((line: { orderLineId: string; quantity: string }) => {
   const source = order.lines.find(l => l.id === line.orderLineId)
   if (!source || Number(line.quantity) > Number(source.reserved) - Number(source.dispatched)) return null
   source.dispatched = String(Number(source.dispatched) + Number(line.quantity))
   return { orderLineId: source.id, itemId: source.itemId, quantity: line.quantity }
  })
  if (lines.includes(null)) return { ok: false }
  result = { id: `pier-shipment-${state.shipments.length + 1}`, orderId: order.id, reference: String(body.payload.shipmentReference), createdAt: new Date().toISOString(), lines }
  state.shipments.push(result)
 } else return { ok: false }
 state.commands[body.commandId] = result
 await write(db, demoPierKey, state)
 return { ok: true, result }
}

export function sessionObject(s: StripeSession) {
 return { id: s.id, object: 'checkout.session', mode: 'payment', client_reference_id: s.orderId, metadata: { stall_order_id: s.orderId }, customer_email: s.email, currency: shopCurrency, amount_total: s.amount, total_details: { amount_shipping: s.shippingCents ?? 0 }, payment_status: s.paid ? 'paid' : 'unpaid', status: s.status, payment_intent: s.intent, url: s.status === 'open' ? `https://checkout.stripe.com/c/pay/${s.id}` : null, collected_information: s.paid ? { shipping_details: s.shipping } : null }
}
export const refundObject = (r: StripeRefund) => ({ id: r.id, object: 'refund', amount: r.amount, currency: shopCurrency, payment_intent: r.intent, metadata: { stall_order_id: r.orderId, stall_refund_id: r.refundId }, status: r.status })

// A demo shopper's details, as Stripe's hosted Checkout would collect them.
function shopper(email: string) {
 const name = email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Demo shopper'
 return { name, address: { line1: '412 Agua Fria Street', line2: '', city: 'Santa Fe', state: 'NM', postal_code: '87501', country: shopCountry } }
}

// Stripe's Checkout and refund endpoints. A demo's hosted Checkout is paid at once.
export async function demoStripe(db: D1Database, path: string, form?: URLSearchParams): Promise<unknown> {
 const state = await read<StripeState>(db, demoStripeKey)
 const [, kind, id] = path.split('/')
 if (kind === 'checkout' && form) {
  const orderId = form.get('metadata[stall_order_id]') ?? '', email = form.get('customer_email') ?? ''
  let amount = 0
  for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) amount += Number(form.get(`line_items[${i}][quantity]`)) * Number(form.get(`line_items[${i}][price_data][unit_amount]`))
  amount += Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]') ?? 0)
  const sessionId = `cs_demo_${hex(orderId)}`
  state.sessions[sessionId] ??= { id: sessionId, orderId, email, amount, shippingCents: Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]') ?? 0), paid: true, status: 'complete', intent: `pi_demo_${hex(orderId)}`, shipping: shopper(email) }
  await write(db, demoStripeKey, state)
  return { ...sessionObject(state.sessions[sessionId]), url: `https://checkout.stripe.com/c/pay/${sessionId}` }
 }
 if (kind === 'checkout') {
  const session = state.sessions[decodeURIComponent(path.split('/')[3] ?? '')]
  return session ? sessionObject(session) : fail('STRIPE_UNAVAILABLE', 'Stripe refused this operation. Check the payment dashboard, then reconcile the same order.', 503)
 }
 if (kind === 'refunds' && form) {
  const refundId = form.get('metadata[stall_refund_id]') ?? '', refund: StripeRefund = { id: `re_demo_${hex(refundId)}`, orderId: form.get('metadata[stall_order_id]') ?? '', refundId, intent: form.get('payment_intent') ?? '', amount: Number(form.get('amount')), status: 'succeeded' }
  state.refunds[refund.id] ??= refund
  await write(db, demoStripeKey, state)
  return refundObject(state.refunds[refund.id])
 }
 if (kind === 'refunds' && id) {
  const refund = state.refunds[decodeURIComponent(id)]
  return refund ? refundObject(refund) : fail('STRIPE_UNAVAILABLE', 'Stripe refused this operation. Check the payment dashboard, then reconcile the same order.', 503)
 }
 return fail('STRIPE_UNAVAILABLE', 'Stripe refused this operation. Check the payment dashboard, then reconcile the same order.', 503)
}
