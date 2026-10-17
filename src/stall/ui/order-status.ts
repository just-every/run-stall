// How the desk sorts orders into its tabs and pills. Every label is the order's
// recorded state (src/stall/model.ts); nothing here changes an order.
import type { Order } from './types'
import { humanLabel } from './presentation'

/** What a person must do next, or null when the order needs nobody. */
export function needs(order: Order): string | null {
  if (order.status === 'shortfall') return 'Shortfall'
  if (order.shipment?.status === 'draft') return 'Shipping draft'
  if (order.shipment?.status === 'pending') return 'Shipping pending'
  const refund = order.refunds.find(refund => ['draft', 'pending', 'failed'].includes(refund.status))
  if (refund) return `Refund ${refund.status}`
  if (order.status === 'paid') return 'Not reserved'
  return null
}

/** The draft a person can approve now (shipping or a refund), with who prepared it. */
export function draftOf(order: Order) {
  const shipment = order.shipment?.status === 'draft' ? order.shipment : undefined
  const refund = order.refunds.find(refund => refund.status === 'draft')
  return shipment ? { kind: 'shipment' as const, by: shipment.preparedBy } : refund ? { kind: 'refund' as const, by: refund.preparedBy, refund } : null
}
export const agentDrafted = (order: Order) => !!draftOf(order)?.by.startsWith('agent:')

/** True when reconcile has work to retry: payment or stock not settled, or a provider result still pending. */
export const pendingWork = (order: Order) => ['awaiting_payment', 'checkout_pending', 'paid', 'shortfall'].includes(order.status)
  || order.shipment?.status === 'pending' || order.refunds.some(refund => refund.status === 'pending')

export const orderTabs = [
  { id: 'needs', label: 'Needs action', counted: true, keep: (order: Order) => needs(order) !== null },
  { id: 'unfulfilled', label: 'Unfulfilled', counted: true, keep: (order: Order) => ['paid', 'reserved', 'shortfall'].includes(order.status) },
  { id: 'shipped', label: 'Shipped', counted: false, keep: (order: Order) => order.status === 'shipped' },
  { id: 'refunds', label: 'Refunds', counted: false, keep: (order: Order) => order.refunds.length > 0 },
  { id: 'checkout', label: 'Awaiting payment', counted: false, keep: (order: Order) => ['awaiting_payment', 'checkout_pending'].includes(order.status) },
  { id: 'all', label: 'All', counted: false, keep: () => true },
] as const
export type OrderTab = typeof orderTabs[number]['id']

export type Tone = 'good' | 'need' | 'bad' | undefined
export function paymentPill(order: Order): [string, Tone] {
  if (!order.payment) return ['Unpaid', undefined]
  return order.refunds.some(refund => refund.status === 'succeeded') ? ['Partly refunded', undefined] : ['Paid', 'good']
}
export function fulfilmentPill(order: Order): [string, Tone] {
  const need = needs(order)
  if (need) return [need, need === 'Refund failed' ? 'bad' : 'need']
  return [order.payment ? humanLabel(order.status) : '—', undefined]
}
/** The carrier or service of a shipping reference ("USPS Ground Advantage 9400 …" gives "USPS Ground Advantage"). */
export const carrierOf = (reference: string) => reference.match(/^(.*?[A-Za-z])\s+[A-Z]{0,4}\d[\d\s-]*$/)?.[1] ?? reference
export const itemCount = (order: Order) => { const count = order.lines.reduce((sum, line) => sum + line.quantity, 0); return `${count} item${count === 1 ? '' : 's'}` }
/** Units Pier could not hold for each order line (by Pier item id). */
export function shortBy(order: Order): Record<string, { reserved: number; quantity: number }> {
  if (order.status !== 'shortfall' || !Array.isArray(order.reservation?.lines)) return {}
  return Object.fromEntries((order.reservation.lines as { itemId?: string; quantity?: string; reserved?: string }[])
    .filter(line => line.itemId && Number(line.reserved) < Number(line.quantity))
    .map(line => [line.itemId!, { reserved: Number(line.reserved), quantity: Number(line.quantity) }]))
}
export function matches(order: Order, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const address = order.shippingDetails?.address
  return [order.id.replaceAll('-', '').slice(0, 4), order.customerEmail, order.shippingDetails?.name, address?.city, address?.state, order.shipment?.reference, ...order.lines.flatMap(line => [line.name, line.sku])]
    .some(value => value?.toLowerCase().includes(q))
}
/** The order's next step, in one sentence. */
export function statusLine(order: Order) {
  return order.status === 'awaiting_payment' || order.status === 'checkout_pending' ? 'Payment is not yet confirmed. Reconcile to check Stripe and stock reservation.'
    : order.status === 'shortfall' ? 'Payment received, but stock reservation has a shortfall. Resolve stock in Pier, then reconcile this order.'
    : order.status === 'paid' ? 'Payment received. Reconcile to complete or check the stock reservation.'
    : order.status === 'reserved' ? 'Stock reserved. Prepare shipping for a person to review.'
    : order.status === 'shipped' ? 'Shipping has been confirmed by Pier.' : 'Review the recorded provider state below.'
}
