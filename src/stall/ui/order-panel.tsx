// The selected order's panel (the owner's pick): customer, lines with any
// stock shortfall, totals and payment, delivery address, shipping, then the
// next step a person must take, with the approve action as the one tangerine pill.
import type { ReactNode } from 'react'
import type { Approval, Order, Run } from './types'
import { money } from './api'
import { Badge, RecordDetail } from './primitives'
import { businessTime, countryName, humanLabel, placeLine, shortId, shortTime, usePerson } from './presentation'
import { needs, shortBy, statusLine } from './order-status'
import { RecoverForm, RefundForm, ShipForm } from './order-forms'
import { Icon } from './icons'

function ApprovalRecord({ approval }: { approval?: Approval }) { const person = usePerson(); return approval ? <p className="st-small">Approved by {person(approval.by)} · {businessTime(approval.at)} · revision {shortId(approval.revision)}</p> : null }

function NextStep({ order, busy, run, canApprove }: { order: Order; busy: boolean; run: Run; canApprove: boolean }) {
  const person = usePerson(), need = needs(order)
  const shipment = order.shipment?.status === 'draft' ? order.shipment : undefined
  const refund = order.refunds.find(refund => refund.status === 'draft')
  const by = shipment?.preparedBy ?? refund?.preparedBy
  const reconcile = (primary: boolean) => <button className={primary ? undefined : 'st-secondary'} disabled={busy} onClick={() => void run('order.reconcile', { orderId: order.id })}>Reconcile / retry pending work</button>
  const approve = shipment && canApprove ? <button disabled={busy} onClick={() => void run('shipment.approve', { orderId: order.id, revision: order.revision })}>Approve shipping · revision {shortId(order.revision)}</button>
    : refund && canApprove ? <button disabled={busy} onClick={() => void run('refund.approve', { orderId: order.id, revision: order.revision })}>Approve {money(refund.amountCents)} refund · revision {shortId(order.revision)}</button> : null
  return <>
    {need && <div className="st-note"><Icon name="spark" /><div>
      <h3>{by?.startsWith('agent:') ? 'Agent note' : 'Needs you'}</h3>
      {shipment ? <p>Shipping prepared by {person(shipment.preparedBy)}: {shipment.reference}. Approving tells Pier to dispatch the reserved stock.</p>
        : refund ? <p>Refund {money(refund.amountCents)} prepared by {person(refund.preparedBy)}: {refund.lines.map(line => `${order.lines.find(item => item.sku === line.sku)?.name ?? line.sku} × ${line.quantity}`).join(', ')}. {refund.reason}</p>
        : <p>{statusLine(order)}</p>}
      {order.shipment?.status === 'pending' && <p>Approval recorded; Pier confirmation is pending. Use reconcile to retry safely.</p>}
      {order.refunds.some(refund => ['pending', 'failed'].includes(refund.status)) && <p>Reconcile this order to retry or retrieve the provider’s latest result.</p>}
    </div></div>}
    {!need && <p className="st-next">{statusLine(order)}</p>}
    <div className="st-actions st-panel-actions">{approve}{reconcile(!approve && !!need)}</div>
  </>
}

export function OrderPanel({ order, busy, run, canApprove, previous, next, footer }: { order: Order; busy: boolean; run: Run; canApprove: boolean; footer: ReactNode; previous?: () => void; next?: () => void }) {
  const person = usePerson(), short = shortBy(order), details = order.shippingDetails, address = details?.address
  const refunded = order.refunds.filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amountCents, 0)
  return <div className="st-panel-body">
    <div className="st-panel-head"><h2>Order {shortId(order.id)}{needs(order) && <span className="st-flag" title="Needs a person" aria-hidden="true" />}</h2><div className="st-step-buttons"><button className="st-secondary" aria-label="Previous order" disabled={!previous} onClick={previous}><Icon name="left" /></button><button className="st-secondary" aria-label="Next order" disabled={!next} onClick={next}><Icon name="right" /></button></div></div>
    <div className="st-panel-customer"><div><h3>{details?.name ?? order.customerEmail ?? 'Customer details erased'}</h3><p>{placeLine(address) || (order.customerEmail ?? 'Customer details erased')}</p></div><div className="st-ordered"><span>Ordered {shortTime(order.createdAt)}</span><small>{details?.name && order.customerEmail ? order.customerEmail : `revision ${shortId(order.revision)}`}</small></div></div>
    <section className="st-panel-block"><h3>Items ({order.lines.reduce((sum, line) => sum + line.quantity, 0)})</h3>
      <ul className="st-items">{order.lines.map(line => { const gap = short[line.itemId]; return <li key={line.sku}><div><span>{line.name}</span><small>{line.sku}</small></div><span className="st-num">{money(line.unitCents)}</span><span className="st-qty">× {line.quantity}</span><span className="st-num">{money(line.quantity * line.unitCents)}</span>{gap && <p className="st-short">Short in Pier ({gap.reserved} of {gap.quantity} reserved)</p>}</li> })}</ul>
    </section>
    <section className="st-panel-block st-sums">
      <p><span>Order total · USD</span><strong>{money(order.totalCents)}</strong></p>
      <p><span>Payment</span><span>{order.payment ? `Paid ${shortTime(order.payment.paidAt)} · Stripe` : humanLabel(order.status)}</span></p>
      {!!refunded && <p><span>Refunded</span><span>−{money(refunded)}</span></p>}
    </section>
    {details && <section className="st-panel-block"><h3>Delivery address</h3><address>{details.name}<br />{address?.line1}{address?.line2 && <><br />{address.line2}</>}<br />{[placeLine(address), address?.postal_code].filter(Boolean).join(' ')}<br />{countryName(address?.country)}</address></section>}
    <section className="st-panel-block"><div className="st-row"><h3>Shipping</h3>{order.shipment && <Badge value={order.shipment.status} />}</div>
      {order.shipment ? <><p className="st-reference">{order.shipment.reference}</p><p className="st-small">Prepared by {person(order.shipment.preparedBy)}</p><ApprovalRecord approval={order.shipment.approval} /></>
        : ['reserved', 'shipped'].includes(order.status) ? <><p className="st-small">Not shipped yet. Add the carrier’s reference for a person to approve.</p><ShipForm order={order} busy={busy} run={run} /></>
        : <p className="st-small">Shipping opens once payment is confirmed and Pier holds the stock.</p>}
    </section>
    <NextStep order={order} busy={busy} run={run} canApprove={canApprove} />
    {footer}
    {order.refunds.filter(refund => refund.status !== 'draft').map(refund => <section key={refund.id} className="st-panel-block"><div className="st-row"><h3>Refund · {money(refund.amountCents)}</h3><Badge value={refund.status} /></div><p className="st-small">{refund.lines.map(line => `${line.sku} × ${line.quantity}`).join(', ')} · {refund.reason}</p><p className="st-small">Prepared by {person(refund.preparedBy)}</p><ApprovalRecord approval={refund.approval} /></section>)}
    <div className="st-panel-more">
      {!!order.payment && <RefundForm order={order} busy={busy} run={run} />}
      <RecoverForm order={order} busy={busy} run={run} />
      <RecordDetail label="Payment, stock reservation & provider details" value={{ payment: order.payment, reservation: order.reservation, shipment: order.shipment, refunds: order.refunds }} />
    </div>
  </div>
}
