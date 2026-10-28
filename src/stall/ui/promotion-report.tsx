import { useEffect, useRef, useState } from 'react'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'
import { When } from './presentation'

type Entry = { orderId: string; promotionRevision: string; status: 'reserved' | 'used'; discountCents: number; orderTotalCents: number; shippingCents: number; refundedCents: number; pendingRefundCents: number; reservedAt: string; usedAt: string | null; qualificationEventId: string | null; redemptionEventId: string | null }
type Report = { taxTotals?:{paidTaxCents:number|null;refundedTaxCents:number};promotionId: string; currency: string; totals: { checkouts: number; reservedUses: number; paidUses: number; committedDiscountCents: number; grossPaidCents: number; refundedCents: number; pendingRefundCents: number; netPaidCents: number }; orders: Entry[]; nextAfter: string | null; taxNotice: string; budgetPolicy: string }
export function PromotionReport({ id }: { id: string }) {
  const [report, setReport] = useState<Report>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const loading = useRef(false)
  async function load(after = '') {
    if (loading.current) return
    loading.current = true; setBusy(true); setError('')
    try {
      const next = await request<Report>(`/api/stall/promotions/report?promotionId=${encodeURIComponent(id)}${after ? '&after=' + encodeURIComponent(after) : ''}`)
      setReport(previous => ({ ...next, orders: after && previous ? [...previous.orders, ...next.orders] : next.orders }))
    } catch (error) { setError(errorMessage(error)) }
    finally { loading.current = false; setBusy(false) }
  }
  useEffect(() => { void load() }, [id])
  return <section className="st-stack" aria-label="Promotion usage report">
    <h3>Usage report</h3>
    {error && <Notice error>{error}</Notice>}
    {busy && <p role="status">Loading usage report…</p>}
    {report && <>
      <Notice>{report.budgetPolicy}</Notice>
      <dl className="st-definition">
        <div><dt>Checkouts</dt><dd>{report.totals.checkouts} total · {report.totals.reservedUses} reserved · {report.totals.paidUses} paid</dd></div>
        <div><dt>Consumed budget</dt><dd>{money(report.totals.committedDiscountCents)}</dd></div>
        <div><dt>Gross paid</dt><dd>{money(report.totals.grossPaidCents)}</dd></div>
        <div><dt>Completed refunds</dt><dd>{money(report.totals.refundedCents)}</dd></div>
        <div><dt>Pending refunds</dt><dd>{money(report.totals.pendingRefundCents)}</dd></div>
        <div><dt>Net paid</dt><dd>{money(report.totals.netPaidCents)}</dd></div>
      </dl>
      {report.taxTotals?.paidTaxCents!==null&&report.taxTotals&&<p>Recorded tax: {money(report.taxTotals.paidTaxCents)} · Tax reversed: {money(report.taxTotals.refundedTaxCents)}</p>}
      <p>{report.taxNotice}</p><p>Showing {report.orders.length} of {report.totals.checkouts} checkouts. Totals cover all checkouts for this promotion.</p>
      {report.orders.map(entry => <details key={entry.orderId}>
        <summary>Order {entry.orderId} · {entry.status === 'used' ? 'Paid' : 'Reserved'} · {money(entry.discountCents)} discount</summary>
        <dl className="st-definition">
          <div><dt>Order</dt><dd><a href={`#orders/${entry.orderId}`}>Open order</a></dd></div>
          <div><dt>Rule revision</dt><dd>{entry.promotionRevision}</dd></div>
          <div><dt>Reserved at</dt><dd><When at={entry.reservedAt} /></dd></div>
          <div><dt>Paid at</dt><dd>{entry.usedAt ? <When at={entry.usedAt} /> : 'Not paid'}</dd></div>
          <div><dt>Order total</dt><dd>{money(entry.orderTotalCents)}{entry.status === 'reserved' ? ' · not confirmed paid' : ''}</dd></div>
          <div><dt>Paid shipping</dt><dd>{money(entry.shippingCents)}</dd></div>
          <div><dt>Completed refunds</dt><dd>{money(entry.refundedCents)}</dd></div>
          <div><dt>Pending refunds</dt><dd>{money(entry.pendingRefundCents)}</dd></div>
          <div><dt>Qualification event</dt><dd>{entry.qualificationEventId ?? 'Not recorded'}</dd></div>
          <div><dt>Redemption event</dt><dd>{entry.redemptionEventId ?? 'Not recorded'}</dd></div>
        </dl>
      </details>)}
      {report.nextAfter && <button className="st-secondary" disabled={busy} onClick={() => void load(report.nextAfter!)}>Load more orders</button>}
    </>}
    <button className="st-secondary" disabled={busy} onClick={() => void load()}>Refresh usage report</button>
  </section>
}
