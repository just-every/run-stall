// The order panel's forms: prepare shipping, prepare a partial refund and
// recover a provider operation whose result was lost.
import { useState, type FormEvent } from 'react'
import type { Order, Run } from './types'
import { money } from './api'
import { humanLabel, shortId } from './presentation'

export function ShipForm({ order, busy, run }: { order: Order; busy: boolean; run: Run }) {
  const [reference, setReference] = useState('')
  async function prepare(event: FormEvent) { event.preventDefault(); await run('shipment.prepare', { orderId: order.id, reference, revision: order.revision }) }
  return <form className="st-ship-form" onSubmit={event => void prepare(event)}><label>Shipping reference<input required maxLength={200} value={reference} disabled={busy} placeholder="Carrier and tracking number" onChange={event => setReference(event.target.value)} /></label><button disabled={busy}>Prepare shipping for approval</button></form>
}

export function RefundForm({ order, busy, run }: { order: Order; busy: boolean; run: Run }) {
  const [sku, setSku] = useState(order.lines[0]?.sku ?? ''), [quantity, setQuantity] = useState('1'), [reason, setReason] = useState('')
  const line = order.lines.find(line => line.sku === sku), refundTotal = line ? Number(quantity) * line.unitCents : 0
  const valid = line && Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= line.quantity
  async function prepare(event: FormEvent) { event.preventDefault(); if (valid) await run('refund.prepare', { orderId: order.id, lines: [{ sku, quantity: Number(quantity) }], reason, revision: order.revision }) }
  return <details><summary>Prepare a one-line partial refund</summary><form className="st-stack" onSubmit={event => void prepare(event)}>
    <p className="st-small">Select the exact line and quantity to refund. A person must approve the saved revision before Stripe is called.</p>
    <div className="st-refund-grid"><label>Order line<select value={sku} disabled={busy} onChange={event => setSku(event.target.value)}>{order.lines.map(line => <option value={line.sku} key={line.sku}>{line.name} ({line.sku})</option>)}</select></label><label>Refund quantity<input required type="number" min="1" max={line?.quantity ?? 1} step="1" value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)} /></label></div>
    <label>Reason<input required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
    <div className="st-row"><strong>Refund · {money(refundTotal)}</strong><button disabled={busy || !valid || refundTotal >= order.totalCents}>Prepare partial refund</button></div>
    <small>The refund must be less than the full order total. Previous refunds are checked by the server.</small>
  </form></details>
}

export function RecoverForm({ order, busy, run }: { order: Order; busy: boolean; run: Run }) {
  const [sessionId, setSessionId] = useState(''), [refundId, setRefundId] = useState(''), [stripeRefundId, setStripeRefundId] = useState('')
  return <details><summary>Recover an existing provider operation</summary><form className="st-stack" onSubmit={event => { event.preventDefault(); void run('order.reconcile', { orderId: order.id, ...(sessionId.trim() ? { checkoutSessionId: sessionId.trim() } : {}), ...(refundId ? { refundId } : {}), ...(stripeRefundId.trim() ? { stripeRefundId: stripeRefundId.trim() } : {}) }) }}>
    <p className="st-small">If a provider timed out and its result is unknown, find the existing operation in Stripe. Supply its ID to reconcile this order. Keep the same operation; verify the recorded amount and order in Stripe first.</p>
    <label>Existing Stripe checkout session ID<input value={sessionId} disabled={busy} placeholder="cs_…" onChange={event => setSessionId(event.target.value)} /></label>
    <label>Refund being recovered<select value={refundId} disabled={busy} onChange={event => setRefundId(event.target.value)}><option value="">No refund selected</option>{order.refunds.map(refund => <option value={refund.id} key={refund.id}>Refund {shortId(refund.id)} · {money(refund.amountCents)} · {humanLabel(refund.status)}</option>)}</select></label>
    <label>Existing Stripe refund ID<input value={stripeRefundId} disabled={busy} placeholder="re_…" onChange={event => setStripeRefundId(event.target.value)} /></label>
    <div><button className="st-secondary" disabled={busy || (!sessionId.trim() && !(refundId && stripeRefundId.trim()))}>Reconcile existing provider IDs</button></div>
  </form></details>
}
