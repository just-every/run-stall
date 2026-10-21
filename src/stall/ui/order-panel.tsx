// The selected order's panel (the owner's pick): customer, lines with any
// stock shortfall, totals and payment, delivery address, shipping, then the
// next step: the Agent note above the approve pill when the shop agent prepared
// the draft. The approve pill is the panel's one tangerine fill; reconcile is
// an outline button and only shows while it has work to retry.
import { useState, type ReactNode } from 'react'
import type { Approval, Order, Run } from './types'
import { money } from './api'
import { Badge, RecordDetail } from './primitives'
import { countryName, humanLabel, placeLine, shortId, useBusinessTime, usePerson, When } from './presentation'
import { draftOf, needs, pendingWork, shortBy, statusLine } from './order-status'
import { RecoverForm, ShipForm } from './order-forms'
import { RefundForm, refundDescription } from './refund-form'
import { Icon } from './icons'
import { OrderAssignment } from './order-assignment'
import { OrderNotes } from './order-notes'
import { staffPaymentLabel,staffRefundLabel } from '../payment-labels'
import { OrderHistory } from './order-history'

type Editing = 'shipment' | 'refund' | null

function ApprovalRecord({ approval }: { approval?: Approval }) { const person = usePerson(); return approval ? <p className="st-small">Approved by {person(approval.by)} · <When at={approval.at} /> · revision {shortId(approval.revision)}</p> : null }

function Dispatches({ order }: { order: Order }) {
  return <>{order.shipment?.dispatches?.map(shipment => <div key={shipment.id}>
    <p className="st-reference">{shipment.reference}</p>
    <p className="st-small">Dispatched in Pier{shipment.shippedAt && <> · <When at={shipment.shippedAt} /></>}{shipment.deliveryStatus && <> · {humanLabel(shipment.deliveryStatus)}</>}</p>
    {shipment.tracking.map((tracking, index) => <p className="st-small" key={index}>
      {tracking.carton !== undefined && <>Carton {tracking.carton} · </>}
      {tracking.trackingUrl ? <a href={tracking.trackingUrl} target="_blank" rel="noreferrer">Track {tracking.trackingCode ?? 'shipment'}</a> : tracking.trackingCode ?? 'Tracking not supplied by Pier'}
    </p>)}
  </div>)}</>
}

function NextStep({ order, busy, run, canApprove, editing, edit }: { order: Order; busy: boolean; run: Run; canApprove: boolean; editing: Editing; edit: (to: Editing) => void }) {
  const person = usePerson(), need = needs(order), draft = draftOf(order)
  const shipment = draft?.kind === 'shipment' ? order.shipment : undefined, refund = draft?.kind === 'refund' ? draft.refund : undefined
  const approve = editing ? null : shipment && canApprove ? <button disabled={busy} onClick={() => void run('shipment.approve', { orderId: order.id, revision: order.revision })}>Approve shipping · revision {shortId(order.revision)}</button>
    : refund && canApprove ? <button disabled={busy} onClick={() => void run('refund.approve', { orderId: order.id, revision: order.revision })}>Approve {money(refund.amountCents)} refund · revision {shortId(order.revision)}</button> : null
  const failed = order.refunds.some(refund => refund.status === 'failed')
  return <>
    {need && <div className="st-note"><Icon name="spark" /><div>
      <h3>{draft?.by.startsWith('agent:') ? 'Agent note' : 'Needs you'}</h3>
      {shipment ? <p>Shipping prepared by {person(shipment.preparedBy)}: {shipment.reference}. Approving tells Pier to ship the reserved stock.</p>
        : refund ? <p>Refund {money(refund.amountCents)} prepared by {person(refund.preparedBy)}: {refundDescription(refund, order)}. {refund.reason}</p>
        : <p>{statusLine(order)}</p>}
      {order.shipment?.status === 'pending' && <p>Approval recorded; Pier confirmation is pending. Reconcile to retry safely.</p>}
      {order.refunds.some(refund => refund.status === 'pending') && <p>Reconcile this order to retrieve Stripe’s latest refund result.</p>}
      {failed && <p>Stripe did not complete a refund. Prepare a new refund if one is still owed.</p>}
    </div></div>}
    {!need && <p className="st-next">{statusLine(order)}</p>}
    {editing === 'refund' && refund && <div className="st-panel-edit"><RefundForm order={order} busy={busy} run={run} initial={refund} onCancel={() => edit(null)} /></div>}
    {(approve || draft || pendingWork(order)) && <div className="st-actions st-panel-actions">
      {approve}
      {draft && !editing && <button className="st-secondary" disabled={busy} onClick={() => edit(draft.kind)}>Edit<span className="st-sr-only"> {draft.kind === 'refund' ? 'refund' : 'shipping'}</span></button>}
      {pendingWork(order) && <button className="st-secondary" disabled={busy} onClick={() => void run('order.reconcile', { orderId: order.id })}>Reconcile</button>}
    </div>}
  </>
}

export function OrderPanel({ order, staff, busy, run, canApprove, owner, previous, next, footer }: { order: Order; staff: Record<string,string>; busy: boolean; run: Run; canApprove: boolean; owner:boolean; footer: ReactNode; previous?: () => void; next?: () => void }) {
  const { shortTime } = useBusinessTime()
  const person = usePerson(), short = shortBy(order), details = order.shippingDetails, address = details?.address
  const [editing, setEditing] = useState<Editing>(null)
  const refunded = order.refunds.filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amountCents, 0)
  const shipmentDraft = order.shipment?.status === 'draft'
  return <div className="st-panel-body">
    <div className="st-panel-head"><h2>Order {shortId(order.id)}{needs(order) && <span className="st-flag" title="Needs a person" aria-hidden="true" />}</h2><div className="st-step-buttons"><button className="st-secondary" aria-label="Previous order" disabled={!previous} onClick={previous}><Icon name="left" /></button><button className="st-secondary" aria-label="Next order" disabled={!next} onClick={next}><Icon name="right" /></button></div></div>
    <div className="st-panel-customer"><div><h3>{details?.name ?? order.customerEmail ?? 'Customer details erased'}</h3><p>{placeLine(address) || (order.customerEmail ?? 'Customer details erased')}</p></div><div className="st-ordered"><span>Ordered {shortTime(order.createdAt)}</span><small>{details?.name && order.customerEmail ? order.customerEmail : `revision ${shortId(order.revision)}`}</small></div></div>
    <section className="st-panel-block"><h3>Items ({order.lines.reduce((sum, line) => sum + line.quantity, 0)})</h3>
      <ul className="st-items">{order.lines.map(line => { const gap = short[line.itemId]; return <li key={line.sku}><div><span>{line.name}</span><small>{line.sku}</small>{line.description && <small>{line.description}</small>}{line.variant && <small>{Object.entries(line.variant).map(([name, value]) => `${name}: ${value}`).join(', ')}</small>}{line.personalization?.map(answer => <small key={answer.key}>{answer.label}: {answer.fileId ? <a href={`/api/stall/uploads/${answer.fileId}`} target="_blank" rel="noreferrer">{answer.value}</a> : answer.value}{answer.addOnCents ? ` (+${money(answer.addOnCents)} each)` : ''}</small>)}</div><span className="st-num">{money(line.unitCents)}</span><span className="st-qty">× {line.quantity}</span><span className="st-num">{money(line.quantity * line.unitCents)}</span>{gap && <p className="st-short">Short in Pier ({gap.reserved} of {gap.quantity} reserved)</p>}</li> })}</ul>
    </section>
    <p className="st-small"><a href={`/api/stall/packing-slip?orderId=${encodeURIComponent(order.id)}`} target="_blank" rel="noreferrer">Open packing slip<span className="st-sr-only"> for order {shortId(order.id)} (new tab)</span></a></p>
    <p className="st-small"><a href={`/api/stall/packing-slip?orderId=${encodeURIComponent(order.id)}`} target="_blank" rel="noreferrer">Open packing slip<span className="st-sr-only"> for order {shortId(order.id)} (opens in a new tab)</span></a></p>
    <section className="st-panel-block st-sums">
      <p><span>Shipping charged</span><span>{money(order.shippingCents ?? 0)}</span></p>
      <p><span>Order total · USD</span><strong>{money(order.totalCents)}</strong></p>
      <p><span>Payment</span><span>{order.payment?.source==='staff' ? `Recorded ${shortTime(order.payment.paidAt)}` : order.payment ? `Paid ${shortTime(order.payment.paidAt)} · Stripe` : humanLabel(order.status)}</span></p>
      {order.payment?.source==='staff'&&<p className="st-small">{staffPaymentLabel}</p>}
      {order.manualPayment&&<p><span>{order.manualPayment.method.replace('_',' ')} · received {order.manualPayment.receivedOn}</span><span>{order.manualPayment.reference}</span></p>}
      {order.taxTreatment&&<p>No tax recorded</p>}
      {!!refunded && <p><span>Refunded</span><span>−{money(refunded)}</span></p>}
    </section>
    {details && <section className="st-panel-block"><h3>Delivery address</h3><address>{details.name}<br />{address?.line1}{address?.line2 && <><br />{address.line2}</>}<br />{[placeLine(address), address?.postal_code].filter(Boolean).join(' ')}<br />{countryName(address?.country)}</address></section>}
    <section className="st-panel-block"><div className="st-row"><h3>Shipping</h3>{shipmentDraft && editing !== 'shipment' ? <button className="st-link st-edit-link" disabled={busy} onClick={() => setEditing('shipment')}>Edit<span className="st-sr-only"> shipping reference</span></button> : order.shipment && <Badge value={order.shipment.status} />}</div>
      <p className="st-small">Pier handles stock and warehouse dispatch. Ship in Pier and refresh Stall to see the result. If you arrange delivery yourself, approve shipping here to record the dispatch in Pier.</p>
      {order.shipment && editing === 'shipment' ? <ShipForm order={order} busy={busy} run={run} initial={order.shipment.reference} onCancel={() => setEditing(null)} />
        : order.shipment ? <>{order.shipment.dispatches?.length ? <Dispatches order={order} /> : <p className="st-reference">{order.shipment.reference}</p>}{order.shipment.preparedBy !== 'pier' && <p className="st-small">Prepared by {person(order.shipment.preparedBy)}{shipmentDraft ? ' · awaiting approval' : ''}</p>}<ApprovalRecord approval={order.shipment.approval} /></>
        : order.status === 'reserved' ? <><p className="st-small">No dispatch recorded yet. To ship from Stall, add the carrier’s reference for a person to approve.</p><ShipForm order={order} busy={busy} run={run} /></>
        : <p className="st-small">Shipping opens once payment is confirmed and Pier holds the stock.</p>}
    </section>
    {order.refunds.filter(refund => refund.status !== 'draft').map(refund => <section key={refund.id} className="st-panel-block"><div className="st-row"><h3>Refund · {money(refund.amountCents)}</h3><Badge value={refund.status} /></div><p className="st-small">{refund.source==='staff'&&<>{staffRefundLabel}. </>}{refundDescription(refund, order)} · {refund.reason}</p><p className="st-small">Prepared by {person(refund.preparedBy)}</p><ApprovalRecord approval={refund.approval} /></section>)}
    <NextStep order={order} busy={busy} run={run} canApprove={canApprove} editing={editing} edit={setEditing} />
    {canApprove && <OrderNotes order={order} busy={busy} run={run} owner={owner} />}
    {canApprove && <OrderAssignment order={order} staff={staff} busy={busy} run={run} />}
    {canApprove && <OrderHistory orderId={order.id} revision={order.revision} />}
    {footer}
    <details className="st-more"><summary>More actions</summary>
      {!!order.payment && <details><summary>Prepare a refund</summary><RefundForm order={order} busy={busy} run={run} /></details>}
      <details><summary>Recover an existing provider operation</summary><RecoverForm order={order} busy={busy} run={run} /></details>
      <RecordDetail label="Payment, stock reservation & provider details" value={{ payment: order.payment?.source==='staff'?{...order.payment,label:staffPaymentLabel}:order.payment, manualPayment:order.manualPayment, reservation: order.reservation, shipment: order.shipment, refunds: order.refunds }} />
    </details>
  </div>
}
