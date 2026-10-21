import { useEffect, useState } from 'react'
import { errorMessage, request } from './api'
import { humanLabel, usePerson, When } from './presentation'

type History = { events: { id: string; actor: string; action: string; at: string }[]; references: { checkout?: string; payment?: { sessionId: string; intentId: string }; reservation?: string; shipments: string[]; refunds: string[] } }

/** Every audited action on this order and the provider references it keeps, read when opened. */
export function OrderHistory({ orderId, revision }: { orderId: string; revision: string }) {
  const person = usePerson(), [history, setHistory] = useState<History | null>(null), [error, setError] = useState(''), [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    let current = true
    request<History>(`/api/stall/orders/history?orderId=${encodeURIComponent(orderId)}`).then(value => { if (current) { setHistory(value); setError('') } }).catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [open, orderId, revision])
  const refs = history?.references
  return <details className="st-panel-block" onToggle={event => setOpen(event.currentTarget.open)}><summary>Full order history</summary>
    {error && <p className="st-small" role="alert">{error}</p>}
    {history && <><ol className="st-history">{history.events.map(event => <li key={event.id}>{humanLabel(event.action)} · {person(event.actor)} · <When at={event.at} /></li>)}</ol>
      {refs && <p className="st-small">Provider references: {[refs.checkout && `Stripe checkout ${refs.checkout}`, refs.payment && `payment ${refs.payment.intentId}`, refs.reservation && `Pier reservation ${refs.reservation}`, ...refs.shipments.map(s => `shipment ${s}`), ...refs.refunds.map(r => `refund ${r}`)].filter(Boolean).join(' · ') || 'none yet'}</p>}</>}
  </details>
}
