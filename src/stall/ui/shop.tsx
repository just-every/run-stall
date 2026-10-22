import type { CustomField } from '../product-details'
import { CustomFields } from './product-details'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage, money } from './api'
import { Chrome, Empty, Notice, ProviderLinks, Section } from './primitives'
import { useDiscovery } from './discovery'
import { Facets, NoResults, Pager, ResultsBar, SearchBox } from './discovery-views'
import { FooterMenu } from './menus'
import { readBasket, writeBasket, type BasketLine } from './basket'
import { ShippingChoice, useShippingQuote, zipOf } from './shipping-options'
import { PromotionCode, usePromotionCode } from './promotion-code'
export interface Media { id: string; kind: 'image' | 'video'; alt: string; url: string }
export interface PersonalizationField { key: string; label: string; required?: boolean; addOnCents?: number; type: 'text' | 'choice' | 'file'; maxLength?: number; choices?: string[]; fileTypes?: string[]; maxBytes?: number }
export interface Item { sku: string; productSku?: string; name: string; description?: string; unitCents: number; compareAtCents?: number; available: string; active?: boolean; customFields?: CustomField[]; variant?: { label: string; options: Record<string, string>; mediaId?: string }; personalization?: PersonalizationField[] }
export interface ShopProduct { sku: string; handle: string; name: string; description?: string; customFields?: CustomField[]; categories?: string[]; tags?: string[]; attributes?: { name: string; value: string }[]; media?: Media[]; options?: { name: string; values: string[] }[]; personalization?: PersonalizationField[]; skus: string[] }
export interface Catalogue { items: Item[]; products: ShopProduct[]; observedAt?: string; checkoutReady: boolean }
const plain = (product: ShopProduct) => !product.options?.length && !product.personalization?.length
type Extras = Record<string, Pick<BasketLine, 'personalization' | 'addOnCents' | 'detail'>>
export function Shop() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({}), [extras, setExtras] = useState<Extras>({}), [stored, setStored] = useState(false)
  const [email, setEmail] = useState(''), [review, setReview] = useState(false), [zip, setZip] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const key = useRef(''), lock = useRef(false)
  const browse = useDiscovery()
  async function load() { setLoading(true); setError(''); try { setCatalogue(await request<Catalogue>('/api/stall/catalogue')); setReview(false); void browse.reload() } catch (error) { setError(errorMessage(error)) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const lines = readBasket()
    setQuantities(Object.fromEntries(lines.map(line => [line.sku, String(line.quantity)])))
    setExtras(Object.fromEntries(lines.filter(line => line.personalization).map(line => [line.sku, { personalization: line.personalization, addOnCents: line.addOnCents, detail: line.detail }])))
    setStored(true)
  }, [])
  useEffect(() => { if (stored) writeBasket(Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([sku, quantity]) => ({ sku, quantity: Number(quantity), ...extras[sku] }))) }, [stored, quantities, extras])
  const items = (catalogue?.items ?? []).filter(item => item.active !== false)
  // The server's browse result decides which products show, in what order; the catalogue holds their stock and options.
  const shown = browse.result ? browse.result.order.flatMap(sku => catalogue?.products.filter(product => product.sku === sku) ?? []) : catalogue?.products ?? []
  const chosen = items.filter(item => Number(quantities[item.sku]) > 0)
  const subtotal = chosen.reduce((sum, item) => sum + (item.unitCents + (extras[item.sku]?.addOnCents ?? 0)) * Number(quantities[item.sku]), 0)
  const options = useShippingQuote(chosen.map(item => ({ sku: item.sku, quantity: Number(quantities[item.sku]), ...(extras[item.sku]?.personalization ? { personalization: extras[item.sku].personalization } : {}) })), zip)
  const service = options.chosen, shipping = chosen.length ? service?.cents ?? 0 : 0
  const lines = chosen.map(item => ({ sku: item.sku, quantity: Number(quantities[item.sku]), ...(extras[item.sku]?.personalization ? { personalization: extras[item.sku].personalization } : {}) }))
  const shippingInput = service ? { service: service.code, ...(zipOf(zip) ? { postalCode: zipOf(zip) } : {}), quote: service.quote } : undefined
  const promotion = usePromotionCode({ lines, customerEmail: email.trim(), shipping: shippingInput, subtotal, shippingCents: shipping })
  useEffect(() => { setReview(false); key.current = '' }, [service?.code, service?.quote])
  const total = subtotal + shipping - (promotion.applied?.discountCents ?? 0)
  const invalid = items.some(item => quantities[item.sku] && (!Number.isSafeInteger(Number(quantities[item.sku])) || Number(quantities[item.sku]) < 0 || Number(quantities[item.sku]) > Number(item.available)))
  function changed() { setReview(false); key.current = ''; setError('') }
  async function checkout(event: FormEvent) {
    event.preventDefault()
    if (lock.current || !chosen.length || invalid || !service || promotion.blocked) return
    if (!review) { setReview(true); return }
    lock.current = true; setBusy(true); setError('')
    key.current ||= crypto.randomUUID()
    try {
      const result = await request<{ url: string }>('/api/stall/checkout', { ...(promotion.applied ? { promotionCode: promotion.code.trim() } : {}), customerEmail: email.trim(), lines: chosen.map(item => ({ sku: item.sku, quantity: Number(quantities[item.sku]), ...(extras[item.sku]?.personalization ? { personalization: extras[item.sku].personalization } : {}) })), expectedTotalCents: total, shipping: { service: service!.code, ...(zipOf(zip) ? { postalCode: zipOf(zip) } : {}), quote: service!.quote }, idempotencyKey: key.current })
      const url = new URL(result.url, window.location.origin)
      if (!(url.protocol === 'https:' && url.hostname === 'checkout.stripe.com') && !(url.origin === window.location.origin && url.pathname === '/order')) throw new Error('The payment provider did not return a valid hosted Stripe checkout. Contact the shop.')
      window.location.assign(url.href)
    } catch (error) { setError(errorMessage(error)); lock.current = false; setBusy(false) }
  }
  return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main">
    <HydrationUnit><header className="st-store-heading"><p className="st-eyebrow">{browse.result?.collection ? 'Collection' : 'The shop'}</p><h1>{browse.result?.collection?.title ?? 'Choose something good.'}</h1><p>{browse.result?.collection ? browse.result.collection.description : 'Available products, current stock, and a clear total in US dollars.'}</p></header></HydrationUnit>
    <Section title="Products" className="st-store-panel"><div className="st-row"><p>Stock is checked again when you continue to payment.</p><button className="st-secondary" onClick={() => void load()} disabled={loading || busy}>Refresh availability</button></div>
      {catalogue && <div className="st-browse st-stack"><SearchBox value={browse.params.get('q') ?? ''} onSubmit={value => browse.go(next => value ? next.set('q', value) : next.delete('q'))} />
        {browse.problem && <Notice error>{browse.problem}</Notice>}
        {browse.result && <><ResultsBar result={browse.result} params={browse.params} go={browse.go} /><details className="st-filters" open={typeof matchMedia === 'undefined' ? true : !matchMedia('(max-width: 900px)').matches}><summary>Filters</summary><Facets result={browse.result} params={browse.params} go={browse.go} /></details></>}</div>}
      {loading && <p role="status">Checking available products with Pier…</p>}
      {error && <Notice error>{error}</Notice>}
      {!loading && !catalogue && <Empty><h3>The shop is not ready for orders</h3><p>Live stock and payment connections need to be available before checkout can open. Please try again later.</p></Empty>}
      {catalogue && !catalogue.checkoutReady && <Notice>Payments are not available yet. The shop owner needs to connect Stripe checkout before orders can be accepted.</Notice>}
      {catalogue && browse.result && browse.result.total === 0 && items.length > 0 && <NoResults result={browse.result} go={browse.go} />}
      {catalogue && !items.length && <Empty><h3>No products available yet</h3><p>The owner is preparing the catalog. Check back soon.</p></Empty>}
      {!loading && (!catalogue || !catalogue.checkoutReady || !items.length) && <ProviderLinks />}
      {!!items.length && !(browse.result?.total === 0) && <form className="st-shop-layout" onSubmit={event => void checkout(event)}>
        <div className="st-product-grid">{shown.map(product => {
          const stocked = items.filter(item => product.skus.includes(item.sku)), first = stocked[0]
          if (!first) return null
          const image = product.media?.find(media => media.kind === 'image'), from = Math.min(...stocked.map(item => item.unitCents)), sold = stocked.every(item => Number(item.available) <= 0)
          const simple = plain(product) && stocked.length === 1
          return <div className={`st-product st-stack${image ? ' has-image' : ''}`} key={product.sku}>
            {image && <a className="st-product-image" href={`/shop/${product.handle}`}><img src={image.url} alt={image.alt} loading="lazy" /></a>}
            <div><small>{product.sku}</small><h3><a href={`/shop/${product.handle}`}>{product.name}</a></h3></div><p>{product.description}</p><CustomFields fields={product.customFields} />
            {simple ? <><div className="st-row"><strong>{money(first.unitCents)}</strong>{first.compareAtCents && <s><span className="st-sr-only">Was </span>{money(first.compareAtCents)}</s>}<span>{Number(first.available) > 0 ? `${first.available} available` : 'Sold out'}</span></div><label><span className="st-sr-only">Quantity for {first.name}</span><input type="number" min="0" max={Math.floor(Number(first.available))} step="1" inputMode="numeric" value={quantities[first.sku] ?? ''} placeholder="0" disabled={busy || Number(first.available) <= 0} onChange={event => { changed(); setQuantities(current => ({ ...current, [first.sku]: event.target.value })) }} /></label></>
              : <><div className="st-row"><strong>{stocked.length > 1 && Math.max(...stocked.map(item => item.unitCents)) !== from ? `From ${money(from)}` : money(from)}</strong><span>{sold ? 'Sold out' : `${stocked.length} option${stocked.length === 1 ? '' : 's'} available`}</span></div><a className="st-button st-choose" href={`/shop/${product.handle}`}>Choose options<span className="st-sr-only"> for {product.name}</span></a></>}
          </div>
        })}</div>
        {browse.result && <Pager result={browse.result} goPage={browse.goPage} />}
        {invalid && <Notice error>Choose whole quantities within the available stock.</Notice>}
        <div className="st-checkout st-stack"><h3>{review ? 'Review your order' : 'Your order'}</h3><label>Email for your order<input required type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={event => { changed(); setEmail(event.target.value) }} /></label>
          {chosen.length ? <ul className="st-lines">{chosen.map(item => <li key={item.sku}><span>{item.name} × {quantities[item.sku]}{extras[item.sku]?.detail?.map(line => <small key={line} className="st-line-detail">{line}</small>)}{extras[item.sku] && <button type="button" className="st-link" disabled={busy} onClick={() => { changed(); setQuantities(current => ({ ...current, [item.sku]: '0' })); setExtras(current => { const { [item.sku]: _gone, ...rest } = current; return rest }) }}>Remove<span className="st-sr-only"> {item.name}</span></button>}</span><strong>{money((item.unitCents + (extras[item.sku]?.addOnCents ?? 0)) * Number(quantities[item.sku]))}</strong></li>)}</ul> : <p>Choose a quantity above to start your order.</p>}
          <div className="st-row"><span>Product subtotal</span><strong>{money(subtotal)}</strong></div><ShippingChoice state={options} zip={zip} setZip={value => { changed(); setZip(value) }} busy={busy} /><div className="st-row"><span>{service?.name ?? 'Shipping'}</span><strong>{service ? money(shipping) : 'Choose an option'}</strong></div>
          <PromotionCode state={promotion} busy={busy} changed={changed} />
          <div className="st-total"><span>Total · USD</span><strong>{money(total)}</strong></div><p className="st-small">This total includes the products and the shipping option you chose. Payment opens on Stripe’s secure hosted checkout. Your order is confirmed after payment is verified.</p>
          {review && <Notice>Check these quantities, your email and the exact total before continuing.</Notice>}
          <div className="st-actions"><button disabled={busy || loading || options.loading || promotion.blocked || !service || !catalogue?.checkoutReady || !chosen.length || invalid}>{busy ? 'Opening Stripe…' : review ? `Pay ${money(total)} with Stripe` : 'Review order'}</button>{review && <button type="button" className="st-secondary" disabled={busy} onClick={() => setReview(false)}>Edit order</button>}</div>
        </div>
      </form>}
    </Section>
  <FooterMenu /></main></div>
}
