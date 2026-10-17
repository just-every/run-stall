// The customer's page after Stripe Checkout. The return URL proves nothing by
// itself, so the page asks the shop, which asks Stripe (payments.ts confirmReturn).
import { useEffect, useState } from 'react'
import { request, errorMessage } from './api'
import { Chrome, Notice, Section } from './primitives'

type Outcome = { kind: 'checking' | 'paid' | 'waiting' | 'cancelled' | 'none' } | { kind: 'error'; message: string }

export function OrderReturn() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'checking' })
  useEffect(() => {
    const query = new URLSearchParams(location.search), orderId = query.get('orderId')
    if (query.get('checkout') === 'cancelled') return setOutcome({ kind: 'cancelled' })
    if (query.get('checkout') !== 'success' || !orderId) return setOutcome({ kind: 'none' })
    request<{ status: string }>('/api/stall/checkout/confirm', { orderId })
      .then(result => setOutcome({ kind: result.status === 'paid' ? 'paid' : 'waiting' }))
      .catch(error => setOutcome({ kind: 'error', message: errorMessage(error) }))
  }, [])
  const title = outcome.kind === 'paid' ? 'Thank you, your payment is confirmed' : outcome.kind === 'cancelled' ? 'Payment canceled' : 'Thanks for visiting the checkout'
  return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main st-store-narrow"><Section title={title}>
    {outcome.kind === 'checking' && <p role="status">Checking your payment with Stripe…</p>}
    {outcome.kind === 'paid' && <p>Stripe confirmed your payment. The shop is preparing your order and will ship it to the address you gave at checkout.</p>}
    {outcome.kind === 'waiting' && <p>Stripe has not confirmed this payment yet. The shop checks again every minute and prepares your order once Stripe confirms it. You do not need to pay again.</p>}
    {outcome.kind === 'cancelled' && <p>No payment was taken. You can return to the shop and try again.</p>}
    {outcome.kind === 'none' && <p>Returning from Stripe does not confirm payment. The shop verifies each payment with Stripe before preparing an order.</p>}
    {outcome.kind === 'error' && <Notice error>{outcome.message} The shop checks again every minute; you do not need to pay again.</Notice>}
    <a href="/shop">Return to the shop</a>
  </Section></main></div>
}
