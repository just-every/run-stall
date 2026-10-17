import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage, money } from './api'
import { Chrome, Empty, Notice, ProviderLinks, Section } from './primitives'
interface Item { sku: string; name: string; description?: string; unitCents: number; available: string; active?: boolean }
interface Catalogue { items: Item[]; observedAt?: string; checkoutReady: boolean }
export function Shop() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [email, setEmail] = useState(''), [review, setReview] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const key = useRef(''), lock = useRef(false)
  async function load() { setLoading(true); setError(''); try { setCatalogue(await request<Catalogue>('/api/stall/catalogue')); setReview(false) } catch (error) { setError(errorMessage(error)) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const items = (catalogue?.items ?? []).filter(item => item.active !== false)
  const chosen = items.filter(item => Number(quantities[item.sku]) > 0)
  const total = chosen.reduce((sum, item) => sum + item.unitCents * Number(quantities[item.sku]), 0)
  const invalid = items.some(item => quantities[item.sku] && (!Number.isSafeInteger(Number(quantities[item.sku])) || Number(quantities[item.sku]) < 0 || Number(quantities[item.sku]) > Number(item.available)))
  function changed() { setReview(false); key.current = ''; setError('') }
  async function checkout(event: FormEvent) {
    event.preventDefault()
    if (lock.current || !chosen.length || invalid) return
    if (!review) { setReview(true); return }
    lock.current = true; setBusy(true); setError('')
    key.current ||= crypto.randomUUID()
    try {
      const result = await request<{ url: string }>('/api/stall/checkout', { customerEmail: email.trim(), lines: chosen.map(item => ({ sku: item.sku, quantity: Number(quantities[item.sku]) })), expectedTotalCents: total, idempotencyKey: key.current })
      const url = new URL(result.url, window.location.origin)
      if (!(url.protocol === 'https:' && url.hostname === 'checkout.stripe.com') && !(url.origin === window.location.origin && url.pathname === '/order')) throw new Error('The payment provider did not return a valid hosted Stripe checkout. Contact the shop.')
      window.location.assign(url.href)
    } catch (error) { setError(errorMessage(error)); lock.current = false; setBusy(false) }
  }
  return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main">
    <HydrationUnit><header className="st-store-heading"><p className="st-eyebrow">The shop</p><h1>Choose something good.</h1><p>Available products, current stock, and a clear total in US dollars.</p></header></HydrationUnit>
    <Section title="Products" className="st-store-panel"><div className="st-row"><p>Stock is checked again when you continue to payment.</p><button className="st-secondary" onClick={() => void load()} disabled={loading || busy}>Refresh availability</button></div>
      {loading && <p role="status">Checking available products with Pier…</p>}
      {error && <Notice error>{error}</Notice>}
      {!loading && !catalogue && <Empty><h3>The shop is not ready for orders</h3><p>Live stock and payment connections need to be available before checkout can open. Please try again later.</p></Empty>}
      {catalogue && !catalogue.checkoutReady && <Notice>Payments are not available yet. The shop owner needs to connect Stripe checkout before orders can be accepted.</Notice>}
      {catalogue && !items.length && <Empty><h3>No products available yet</h3><p>The owner is preparing the catalog. Check back soon.</p></Empty>}
      {!loading && (!catalogue || !catalogue.checkoutReady || !items.length) && <ProviderLinks />}
      {!!items.length && <form className="st-shop-layout" onSubmit={event => void checkout(event)}>
        <div className="st-product-grid">{items.map(item => <div className="st-product st-stack" key={item.sku}><div><small>{item.sku}</small><h3>{item.name}</h3></div><p>{item.description}</p><div className="st-row"><strong>{money(item.unitCents)}</strong><span>{Number(item.available) > 0 ? `${item.available} available` : 'Sold out'}</span></div><label><span className="st-sr-only">Quantity for {item.name}</span><input type="number" min="0" max={Math.floor(Number(item.available))} step="1" inputMode="numeric" value={quantities[item.sku] ?? ''} placeholder="0" disabled={busy || Number(item.available) <= 0} onChange={event => { changed(); setQuantities(current => ({ ...current, [item.sku]: event.target.value })) }} /></label></div>)}</div>
        {invalid && <Notice error>Choose whole quantities within the available stock.</Notice>}
        <div className="st-checkout st-stack"><h3>{review ? 'Review your order' : 'Your order'}</h3><label>Email for your order<input required type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={event => { changed(); setEmail(event.target.value) }} /></label>
          {chosen.length ? <ul className="st-lines">{chosen.map(item => <li key={item.sku}><span>{item.name} × {quantities[item.sku]}</span><strong>{money(item.unitCents * Number(quantities[item.sku]))}</strong></li>)}</ul> : <p>Choose a quantity above to start your order.</p>}
          <div className="st-total"><span>Total · USD</span><strong>{money(total)}</strong></div><p className="st-small">This is the full product total. Payment opens on Stripe’s secure hosted checkout. Your order is confirmed after payment is verified.</p>
          {review && <Notice>Check these quantities, your email and the exact total before continuing.</Notice>}
          <div className="st-actions"><button disabled={busy || loading || !catalogue?.checkoutReady || !chosen.length || invalid}>{busy ? 'Opening Stripe…' : review ? `Pay ${money(total)} with Stripe` : 'Review order'}</button>{review && <button type="button" className="st-secondary" disabled={busy} onClick={() => setReview(false)}>Edit order</button>}</div>
        </div>
      </form>}
    </Section>
  </main></div>
}
