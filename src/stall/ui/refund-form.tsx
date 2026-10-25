import { refundTaxAllocation } from '../tax/transactions-refunds'
import { Notice } from './primitives'
import { useState, type FormEvent } from 'react'
import type { Refund, RefundKind } from '../model'
import type { Order, Run } from './types'
import { money } from './api'

export function refundDescription(refund: Refund, order: Order) {
 return refund.kind === 'shipping' ? 'Shipping only · no items returned' : refund.kind === 'goodwill' ? 'Goodwill · no items returned'
  : refund.lines.map(line => `${order.lines.find(item => item.sku === line.sku)?.name ?? line.sku} × ${line.quantity}`).join(', ')
}
function cents(value: string): number {
 return /^\d+(\.\d{1,2})?$/.test(value) ? Number(value.split('.')[0]) * 100 + Number((value.split('.')[1] ?? '').padEnd(2, '0')) : NaN
}
export function RefundForm({ order, busy, run, initial, onCancel }: { order: Order; busy: boolean; run: Run; initial?: Refund; onCancel?: () => void }) {
 const [kind, setKind] = useState<RefundKind>(initial?.kind ?? 'lines')
 const [sku, setSku] = useState(initial?.lines[0]?.sku ?? order.lines[0]?.sku ?? '')
 const [quantity, setQuantity] = useState(String(initial?.lines[0]?.quantity ?? 1))
 const [amount, setAmount] = useState(initial && initial.kind !== 'lines' ? (initial.amountCents / 100).toFixed(2) : '')
 const [reason, setReason] = useState(initial?.reason ?? '')
 const committed = order.refunds.filter(refund => ['pending', 'succeeded'].includes(refund.status))
 const remaining = order.totalCents - committed.reduce((sum, refund) => sum + refund.amountCents, 0)
 const shippingRemaining = (order.shippingCents ?? 0) - committed.filter(refund => refund.kind === 'shipping').reduce((sum, refund) => sum + (refund.taxAllocation?.shippingCents??refund.amountCents), 0)
 const line = order.lines.find(item => item.sku === sku)
 const quantityLeft = (line?.quantity ?? 0) - committed.reduce((sum, refund) => sum + (refund.lines.find(item => item.sku === sku)?.quantity ?? 0), 0)
 const baseTotal = kind === 'lines' ? Number(quantity) * (line?.unitCents ?? 0) : cents(amount)
 let taxCents=0,taxProblem=''
 if(order.tax&&Number.isSafeInteger(baseTotal)&&baseTotal>0)try {taxCents=refundTaxAllocation(order,{kind,lines:kind==='lines'?[{sku,quantity:Number(quantity)}]:[],amountCents:baseTotal})?.taxCents??0}catch(error){taxProblem=error instanceof Error?error.message:'The original tax allocation needs reconciliation.'}
 const refundTotal=baseTotal+taxCents
 const valid = !taxProblem && Number.isSafeInteger(refundTotal) && refundTotal > 0 && refundTotal <= remaining && !committed.some(refund => refund.status === 'pending')
  && (kind !== 'lines' || (Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= quantityLeft))
  && (kind !== 'shipping' || baseTotal <= shippingRemaining)
 async function prepare(event: FormEvent) {
  event.preventDefault()
  if (valid && await run('refund.prepare', { orderId: order.id, revision: order.revision, kind, reason,
   ...(kind === 'lines' ? { lines: [{ sku, quantity: Number(quantity) }] } : { amountCents: baseTotal }) })) onCancel?.()
 }
 return <form className="st-stack" onSubmit={event => void prepare(event)}>
  <p className="st-small">{order.payment?.source==='staff'?'A person approves the saved amount and reason. Refund recorded by staff; Stall moved no money.':'A person approves the saved amount and reason before Stripe is called.'} A refund does not record returned stock or restock items.</p>
  <label>Refund type<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as RefundKind)}><option value="lines">Purchased items</option><option value="shipping">Shipping only</option><option value="goodwill">Goodwill</option></select></label>
  {kind === 'lines' ? <div className="st-refund-grid"><label>Order line<select value={sku} disabled={busy} onChange={event => setSku(event.target.value)}>{order.lines.map(item => <option value={item.sku} key={item.sku}>{item.name} ({item.sku})</option>)}</select></label><label>Refund quantity<input required type="number" min="1" max={quantityLeft} step="1" value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)} /></label></div>
   : <label>Refund amount · USD<input required type="text" inputMode="decimal" value={amount} disabled={busy} placeholder="5.00" onChange={event => setAmount(event.target.value)} /></label>}
  <p className="st-small">Refundable value: {money(remaining)}{kind === 'shipping' && <> · Shipping remaining: {money(shippingRemaining)}</>}. Pending refunds count against these limits.</p>
  <label>Reason<input required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
  {taxProblem&&<Notice error>{taxProblem}</Notice>}{order.tax&&!taxProblem&&<p>Includes {money(taxCents)} sales tax from the original purchase.</p>}
  <div className="st-row"><strong>Refund · {money(Number.isFinite(refundTotal) ? refundTotal : 0)}</strong><div className="st-actions"><button disabled={busy || !valid}>Prepare refund</button>{onCancel && <button type="button" className="st-secondary" disabled={busy} onClick={onCancel}>Cancel</button>}</div></div>
 </form>
}
