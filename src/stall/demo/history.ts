// Shapes the demo shop's history the way Stall records it: products with
// approvals and drafts, orders through checkout, payment, reservation, shipping
// and refunds, the Pier stock desk and Stripe account those orders went through,
// and the audit trail. Every order is checked by Stall's own provider checks
// (validateSession, fullyReserved, validateShipment) before it is written.
import { digest } from '../access'
import { fullyReserved } from '../pier'
import { validateShipment } from '../fulfilment'
import { validateSession } from '../stripe'
import { shopCountry, shopCurrency, type Approval, type Order, type Product, type ProductValue, type Refund, type Shipment } from '../model'
import { demoPierCustomer, demoPierOrigin, hex, sessionObject, type PierOrder, type PierShipment, type PierState, type StripeSession, type StripeState } from './providers'
import { agentGrant, bins, customers, orders as orderSeeds, products as productSeeds, shop, type OrderSeed } from './shop'

export type Person = { id: string; version: number }
export type Staff = { owner: Person; sam: Person }
export type Event = { subject: string; actor: string; action: string; at: string }

/** A fixed UUID-shaped id from a name, so the demo is the same on every start. */
export async function uuidFrom(name: string) {
 const h = await digest(`stall-demo:${name}`)
 return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function clock(now: Date) {
 // A Santa Fe (Mountain time, UTC-6 in the demo's season) wall-clock time `days` ago; today's orders are `minutes` ago.
 const at = (days: number, hour: number, minute = 0) => {
  if (days === 0) return new Date(now.getTime() - hour * 60000 - minute * 1000).toISOString()
  const d = new Date(now.getTime() - days * 86400000); d.setUTCHours(hour + 6, minute, 0, 0); return d.toISOString()
 }
 const later = (iso: string, minutes: number) => new Date(Math.min(Date.parse(iso) + minutes * 60000, now.getTime() - 60000)).toISOString()
 return { at, later }
}

export async function catalogue(now: Date, staff: Staff) {
 const { at } = clock(now), products: Product[] = [], events: Event[] = []
 const pier: PierState = { items: [], locations: bins.map(b => ({ id: `pier-bin-${b.toLowerCase()}`, name: `Shelf ${b}`, kind: 'bin' })).concat({ id: 'pier-dock', name: 'Packing bench', kind: 'staging' }), positions: [], parties: [{ id: demoPierCustomer, name: 'Saltbush & Clay web shop', kind: 'customer' }, { id: 'pier-party-kiln', name: 'Bright Kiln Supplies', kind: 'supplier' }], orders: [], shipments: [], commands: {} }
 for (const [i, p] of productSeeds.entries()) {
  const itemId = `pier-item-${p.sku.toLowerCase()}`
  pier.items.push({ id: itemId, sku: p.sku, name: p.name, archived: false })
  pier.positions.push({ id: `pier-position-${i + 1}`, itemId, locationId: `pier-bin-${p.bin.toLowerCase()}`, status: 'sellable', available: String(p.stock) })
  const base: ProductValue = { sku: p.sku, name: p.name, description: p.description, unitCents: p.cents, active: p.active !== false }
  const published = at(shop.since - 2, 10, i * 3), revision = await uuidFrom(`product:${p.sku}:published`)
  let value: ProductValue
  if (p.staged) value = { ...base, active: false, draft: base }
  else {
   value = { ...base, approval: { by: staff.owner.id, version: staff.owner.version, at: published, revision: await uuidFrom(`product:${p.sku}:prepared`) } }
   events.push({ subject: p.sku, actor: staff.owner.id, action: 'product.prepared', at: at(shop.since - 2, 9, i * 3) }, { subject: p.sku, actor: staff.owner.id, action: 'product.published', at: published })
  }
  if (p.draft) {
   const { by, at: days } = p.draft
   if (!p.staged) value = { ...value, draft: { ...base, unitCents: p.draft.cents ?? base.unitCents } }
   events.push({ subject: p.sku, actor: by === 'agent' ? `agent:${agentGrant.id}` : staff.sam.id, action: 'product.prepared', at: days ? at(days, 15, 10) : at(0, 95) })
  }
  products.push({ id: p.sku, value, revision: p.draft ? await uuidFrom(`product:${p.sku}:draft`) : revision })
 }
 return { products, pier, events }
}

const tracking = (n: number) => `AusPost 33KRT${String(51207 + n * 389).padStart(6, '0')}`

export async function history(now: Date, staff: Staff, pier: PierState) {
 const { at, later } = clock(now), stripe: StripeState = { sessions: {}, refunds: {} }
 const out: Order[] = [], events: Event[] = [], agent = `agent:${agentGrant.id}`
 const item = (sku: string) => pier.items.find(i => i.sku === sku)!
 const unit = (sku: string) => productSeeds.find(p => p.sku === sku)!.cents
 for (const [n, seed] of orderSeeds.entries()) {
  const [days, hour, who, picks, fate, refunded] = seed as OrderSeed
  const id = await uuidFrom(`order:${n}`), customer = customers[who], created = at(days, hour, (n * 7) % 50)
  let saves = 0
  const revision = () => uuidFrom(`order:${n}:revision:${saves}`)
  const happened = (actor: string, action: string, when: string) => { saves++; events.push({ subject: id, actor, action, at: when }) }
  const lines = picks.map(([sku, quantity]) => ({ sku, name: productSeeds.find(p => p.sku === sku)!.name, itemId: item(sku).id, quantity, unitCents: unit(sku) }))
  const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0)
  const selection = lines.map(l => ({ sku: l.sku, quantity: l.quantity })).sort((a, b) => a.sku.localeCompare(b.sku))
  const sessionId = `cs_demo_${hex(id)}`, paid = fate !== 'abandoned'
  const shipping = { name: customer.name, address: { line1: customer.line1, line2: '', city: customer.city, state: customer.state, postal_code: customer.postcode, country: shopCountry } }
  const session: StripeSession = { id: sessionId, orderId: id, email: customer.email, amount: totalCents, paid, status: paid ? 'complete' : days > 0 ? 'expired' : 'open', intent: paid ? `pi_demo_${hex(id)}` : null, shipping }
  stripe.sessions[sessionId] = session
  let order: Order = { id, revision: '', customerEmail: customer.email, lines, totalCents, currency: shopCurrency, status: 'awaiting_payment', createdAt: created, requestDigest: await digest(JSON.stringify({ customerEmail: customer.email, lines: selection, expectedTotalCents: totalCents })), checkoutKey: await digest(await uuidFrom(`order:${n}:checkout-key`)), pierOrigin: demoPierOrigin, pierCustomerId: demoPierCustomer, checkout: { id: sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` }, refunds: [] }
  happened('customer', 'checkout.prepared', created)
  happened('stripe', 'checkout.created', later(created, 1))
  if (paid) {
   const paidAt = later(created, 4)
   order = { ...order, shippingDetails: shipping, payment: { sessionId, intentId: session.intent!, paidAt }, status: 'paid' }
   happened('stripe', 'payment.confirmed', paidAt)
  }
  validateSession(order, sessionObject(session), paid)
  if (paid && fate !== 'paid') {
   const p = pier.orders.length + 1, short = fate === 'shortfall'
   const reservation: PierOrder = { id: `pier-order-${p}`, reference: `SO-${1300 + p}`, customerId: demoPierCustomer, lines: lines.map((l, i) => ({ id: `pier-line-${p}-${i + 1}`, itemId: l.itemId, quantity: String(l.quantity), reserved: String(short ? l.quantity - 1 : l.quantity), cancelled: '0', dispatched: '0' })) }
   pier.commands[`stall-reserve-${id}`] = structuredClone(reservation)
   pier.orders.push(reservation)
   if (fullyReserved(reservation, lines) === short) throw new Error(`Demo order ${n} reservation does not match its state`)
   order = { ...order, reservation: { id: reservation.id, reference: reservation.reference, lines: structuredClone(reservation.lines) }, status: short ? 'shortfall' : 'reserved' }
   happened('stripe', short ? 'stock.shortfall' : 'stock.reserved', later(created, 4))
  }
  const preparer = days <= agentGrant.created ? (n % 3 ? agent : staff.sam.id) : staff.sam.id
  const approver = n % 4 ? staff.owner : staff.sam
  if (['shipped', 'refunded', 'refund-waiting', 'packed'].includes(fate)) {
   const prepared = days >= 2 ? at(days - 1, 9, (n * 11) % 50) : later(created, 50)
   const shipment: Shipment = { id: await uuidFrom(`order:${n}:shipment`), reference: tracking(n), status: 'draft', preparedBy: preparer }
   happened(preparer, 'shipment.prepared', prepared)
   order = { ...order, shipment }
   if (fate !== 'packed') {
    const approved = later(prepared, 25), approval: Approval = { by: approver.id, version: approver.version, at: approved, revision: await revision() }
    happened(approver.id, 'shipment.approved', approved)
    const p = pier.orders.find(o => o.id === order.reservation!.id)!
    const dispatch: PierShipment = { id: `pier-shipment-${pier.shipments.length + 1}`, orderId: p.id, reference: shipment.reference, lines: lines.map(l => ({ itemId: l.itemId, quantity: String(l.quantity) })) }
    for (const line of p.lines) line.dispatched = line.reserved
    pier.shipments.push(dispatch); pier.commands[`stall-ship-${shipment.id}`] = dispatch
    order = { ...order, status: 'shipped', shipment: { ...shipment, status: 'shipped', approval, pierShipmentId: dispatch.id } }
    validateShipment(order, dispatch)
    happened(approver.id, 'shipment.shipped', later(approved, 1))
   }
  }
  if (refunded) {
   const refund: Refund = { id: await uuidFrom(`order:${n}:refund`), lines: [{ sku: refunded.sku, quantity: refunded.quantity }], amountCents: refunded.quantity * unit(refunded.sku), reason: refunded.reason, status: 'draft', preparedBy: fate === 'refund-waiting' ? agent : staff.sam.id }
   const asked = fate === 'refund-waiting' ? at(1, 16, 40) : at(Math.max(days - 4, 1), 11, 15)
   happened(refund.preparedBy, 'refund.prepared', asked)
   if (fate === 'refunded') {
    const approved = later(asked, 35), stripeId = `re_demo_${hex(refund.id)}`
    const approval: Approval = { by: staff.owner.id, version: staff.owner.version, at: approved, revision: await revision() }
    happened(staff.owner.id, 'refund.approved', approved)
    stripe.refunds[stripeId] = { id: stripeId, orderId: id, refundId: refund.id, intent: order.payment!.intentId, amount: refund.amountCents, status: 'succeeded' }
    happened(staff.owner.id, 'refund.succeeded', later(approved, 1))
    order = { ...order, refunds: [{ ...refund, status: 'succeeded', approval, startedAt: approved, stripeId }] }
   } else order = { ...order, refunds: [refund] }
  }
  out.push({ ...order, revision: await revision() })
 }
 return { orders: out, events, stripe }
}
