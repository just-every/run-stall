// The customer's page after Stripe Checkout. The return URL proves nothing by
// itself, so the page asks the shop, which asks Stripe (payments.ts confirmReturn).
import { useEffect, useState } from 'react'
import { request, errorMessage, money } from './api'
import { Chrome, Notice, Section } from './primitives'
import { CustomerRequests } from './customer-requests'

interface Summary { lines: { name: string; quantity: number; unitCents: number; detail: string[] }[]; shippingCents: number; totalCents: number }
type Outcome = { kind: 'checking' | 'paid' | 'waiting' | 'cancelled' | 'none'; summary?: Summary } | { kind: 'error'; message: string }

export function OrderReturn() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'checking' })
  useEffect(() => {
    const query = new URLSearchParams(location.search), orderId = query.get('orderId')
    if (query.get('checkout') === 'cancelled') return setOutcome({ kind: 'cancelled' })
    if (query.get('checkout') !== 'success' || !orderId) return setOutcome({ kind: 'none' })
    request<{ status: string; summary: Summary }>('/api/stall/checkout/confirm', { orderId })
      .then(result => setOutcome({ kind: result.status === 'paid' ? 'paid' : 'waiting', summary: result.summary }))
      .catch(error => setOutcome({ kind: 'error', message: errorMessage(error) }))
  }, [])
  if (outcome.kind === 'none') return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main st-store-narrow"><CustomerRequests /><a href="/shop">Return to the shop</a></main></div>
  const title = outcome.kind === 'paid' ? 'Thank you, your payment is confirmed' : outcome.kind === 'cancelled' ? 'Payment canceled' : 'Thanks for visiting the checkout'
  return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main st-store-narrow"><Section title={title}>
    {outcome.kind === 'checking' && <p role="status">Checking your payment with Stripe…</p>}
    {outcome.kind === 'paid' && <p>Stripe confirmed your payment. The shop is preparing your order and will ship it to the address you gave at checkout.</p>}
    {outcome.kind === 'waiting' && <p>Stripe has not confirmed this payment yet. The shop checks again every minute and prepares your order once Stripe confirms it. You do not need to pay again.</p>}
    {(outcome.kind === 'paid' || outcome.kind === 'waiting') && outcome.summary && <section aria-label="Your order" className="st-stack"><ul className="st-lines">{outcome.summary.lines.map(line => <li key={line.name}><span>{line.name} × {line.quantity}{line.detail.map(entry => <small key={entry} className="st-line-detail">{entry}</small>)}</span><strong>{money(line.quantity * line.unitCents)}</strong></li>)}</ul><div className="st-row"><span>Shipping</span><strong>{money(outcome.summary.shippingCents)}</strong></div><div className="st-total"><span>Total · USD</span><strong>{money(outcome.summary.totalCents)}</strong></div></section>}
    {outcome.kind === 'cancelled' && <p>No payment was taken. You can return to the shop and try again.</p>}
    {outcome.kind === 'error' && <Notice error>{outcome.message} The shop checks again every minute; you do not need to pay again.</Notice>}
    <a href="/order">Request order help</a>
    <a href="/shop">Return to the shop</a>
  </Section></main></div>
}
