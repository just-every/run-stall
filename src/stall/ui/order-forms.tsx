// The order panel's shipping and provider-recovery forms.
import { useState, type FormEvent } from 'react'
import type { Order, Run } from './types'
import { money } from './api'
import { humanLabel, shortId } from './presentation'

export function ShipForm({ order, busy, run, initial = '', onCancel }: { order: Order; busy: boolean; run: Run; initial?: string; onCancel?: () => void }) {
  const [reference, setReference] = useState(initial)
  async function prepare(event: FormEvent) { event.preventDefault(); if (await run('shipment.prepare', { orderId: order.id, reference, revision: order.revision })) onCancel?.() }
  return <form className="st-ship-form" onSubmit={event => void prepare(event)}><label>Shipping reference<input required maxLength={200} value={reference} disabled={busy} placeholder="Carrier and tracking number" onChange={event => setReference(event.target.value)} /></label><div className="st-actions"><button disabled={busy}>Prepare shipping for approval</button>{onCancel && <button type="button" className="st-secondary" disabled={busy} onClick={onCancel}>Cancel</button>}</div></form>
}

export function RecoverForm({ order, busy, run }: { order: Order; busy: boolean; run: Run }) {
  const [sessionId, setSessionId] = useState(''), [refundId, setRefundId] = useState(''), [stripeRefundId, setStripeRefundId] = useState('')
  return <form className="st-stack" onSubmit={event => { event.preventDefault(); void run('order.reconcile', { orderId: order.id, ...(sessionId.trim() ? { checkoutSessionId: sessionId.trim() } : {}), ...(refundId ? { refundId } : {}), ...(stripeRefundId.trim() ? { stripeRefundId: stripeRefundId.trim() } : {}) }) }}>
    <p className="st-small">Reconcile first looks up an uncertain Stripe operation without sending a replacement. If it cannot find one, inspect the original account in Stripe and supply its existing ID here. Keep the same operation; verify the recorded amount and order in Stripe first.</p>
    <label>Existing Stripe checkout session ID<input value={sessionId} disabled={busy} placeholder="cs_…" onChange={event => setSessionId(event.target.value)} /></label>
    <label>Refund being recovered<select value={refundId} disabled={busy} onChange={event => setRefundId(event.target.value)}><option value="">No refund selected</option>{order.refunds.map(refund => <option value={refund.id} key={refund.id}>Refund {shortId(refund.id)} · {money(refund.amountCents)} · {humanLabel(refund.status)}</option>)}</select></label>
    <label>Existing Stripe refund ID<input value={stripeRefundId} disabled={busy} placeholder="re_…" onChange={event => setStripeRefundId(event.target.value)} /></label>
    <div><button className="st-secondary" disabled={busy || (!sessionId.trim() && !(refundId && stripeRefundId.trim()))}>Reconcile existing provider IDs</button></div>
  </form>
}
