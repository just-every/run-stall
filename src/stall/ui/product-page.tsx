// One product's own page: gallery, option choice, personalization, and add to basket.
import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage, money } from './api'
import { readBasket, writeBasket } from './basket'
import { Chrome, Empty, Notice, Section } from './primitives'
import { FooterMenu } from './menus'
import { CustomFields } from './product-details'
import { Personalization, type Answers } from './personalization-form'
import type { Catalogue, Item } from './shop'
import { Tooltip } from './tooltip'

const same = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value)
export function ProductPage() {
  const { handle = '' } = useParams({ strict: false }) as { handle?: string }
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({}), [shown, setShown] = useState(0), [answers, setAnswers] = useState<Answers>({}), [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false), [added, setAdded] = useState('')
  useEffect(() => { request<Catalogue>('/api/stall/catalogue').then(setCatalogue, failure => setError(errorMessage(failure))).finally(() => setLoading(false)) }, [])
  const product = catalogue?.products.find(entry => entry.handle === handle)
  const stocked = product ? catalogue!.items.filter(item => product.skus.includes(item.sku)) : []
  const options = product?.options ?? []
  const item: Item | undefined = options.length ? stocked.find(entry => entry.variant && same(entry.variant.options, picked)) : stocked[0]
  useEffect(() => { const media = item?.variant?.mediaId && product?.media?.findIndex(entry => entry.id === item.variant!.mediaId); if (typeof media === 'number' && media >= 0) setShown(media) }, [item?.sku])
  const fields = product?.personalization ?? [], addOn = fields.reduce((sum, field) => sum + (answers[field.key]?.value ? field.addOnCents ?? 0 : 0), 0)
  const unit = item ? item.unitCents + addOn : 0, count = Number(quantity), tooLong = fields.some(field => field.type === 'text' && [...(answers[field.key]?.value ?? '')].length > field.maxLength!), ready = !tooLong && !!item && Number(item.available) > 0 && Number.isSafeInteger(count) && count >= 1 && count <= Number(item.available)
  async function add() {
    if (!item || busy) return
    setBusy(true); setError(''); setAdded('')
    try {
      const personalization = Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer.value).map(([key, answer]) => [key, answer.value]))
      const line = await request<{ name: string; unitCents: number; addOnCents: number; personalization: { label: string; value: string; addOnCents: number }[] }>('/api/stall/catalogue/validate', { sku: item.sku, quantity: count, ...(fields.length ? { personalization } : {}) })
      const detail = line.personalization.map(answer => `${answer.label}: ${answer.value}${answer.addOnCents ? ` (+${money(answer.addOnCents)} each)` : ''}`)
      writeBasket([...readBasket().filter(entry => entry.sku !== item.sku), { sku: item.sku, quantity: count, ...(line.personalization.length ? { personalization, addOnCents: line.addOnCents, detail } : {}) }])
      setAdded(`${line.name} is in your basket${line.addOnCents ? ` with ${money(line.addOnCents)} of personalization per item` : ''}.`)
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false) }
  }
  const media = product?.media ?? [], current = media[shown]
  return <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main">
    {loading && <p role="status">Loading this product…</p>}
    {!loading && !product && <Empty><h3>This product is not available</h3><p>It may have been unpublished or moved. <a href="/shop">Browse the shop</a>.</p></Empty>}
    {product && <HydrationUnit><section className="st-pdp"><div className="st-gallery">
      {current ? current.kind === 'video' ? <video key={current.id} controls src={current.url} aria-label={current.alt} /> : <img key={current.id} src={current.url} alt={current.alt} /> : <div className="st-gallery-empty" aria-hidden="true" />}
      {media.length > 1 && <div className="st-thumbs" role="group" aria-label="Product images and videos">{media.map((entry, index) => <Tooltip key={entry.id} label={`Show ${entry.kind} ${index + 1}`}><button type="button" className="st-thumb" aria-pressed={index === shown} aria-label={`Show ${entry.kind} ${index + 1}: ${entry.alt}`} onClick={() => setShown(index)}>{entry.kind === 'image' ? <img src={entry.url} alt="" /> : <span aria-hidden="true">▶</span>}</button></Tooltip>)}</div>}
    </div>
    <div className="st-stack st-pdp-info"><p className="st-eyebrow">{product.categories?.join(' · ')}</p><h1>{product.name}</h1>
      <p className="st-pdp-price" aria-live="polite">{item ? <><strong>{money(unit)}</strong>{item.compareAtCents && <s><span className="st-sr-only">Was </span>{money(item.compareAtCents)}</s>}</> : options.length ? <span>Choose {options.map(option => option.name.toLowerCase()).join(' and ')} to see the price.</span> : null}</p>
      <p>{product.description}</p>
      {options.map(option => <fieldset className="st-options" key={option.name}><legend>{option.name}</legend><div className="st-option-values">{option.values.map(value => {
        const offered = stocked.some(entry => entry.variant?.options[option.name] === value && Object.entries(picked).every(([name, chosen]) => name === option.name || entry.variant!.options[name] === chosen))
        return <button type="button" key={value} className="st-option" aria-pressed={picked[option.name] === value} disabled={!offered} onClick={() => { setPicked(current => ({ ...current, [option.name]: value })); setAdded('') }}>{value}{!offered && <span className="st-sr-only"> unavailable</span>}</button>
      })}</div></fieldset>)}
      {options.length > 0 && Object.keys(picked).length === options.length && !item && <Notice error>This combination is not available. Choose another.</Notice>}
      {item && <p className="st-small">{Number(item.available) > 0 ? `${item.available} available` : 'Sold out'}{item.variant ? ` · ${item.sku}` : ''}</p>}
      <CustomFields fields={product.customFields} />
      {product.attributes?.length ? <dl className="st-attributes">{product.attributes.map(attribute => <div key={attribute.name}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></div>)}</dl> : null}
      {fields.length > 0 && <Personalization fields={fields} sku={item?.sku ?? product.skus[0]} answers={answers} setAnswers={next => { setAnswers(next); setAdded(''); setError('') }} disabled={busy} />}
      <label>Quantity<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={event => { setQuantity(event.target.value); setAdded('') }} /></label>
      {error && <Notice error>{error}</Notice>}
      {added && <Notice>{added} <a href="/shop">Review your basket and check out</a>.</Notice>}
      <div className="st-actions"><button type="button" disabled={busy || !ready} onClick={() => void add()}>{busy ? 'Checking…' : item ? `Add to basket · ${money(unit * (count || 1))}` : 'Add to basket'}</button><a className="st-secondary st-button" href="/shop">Back to the shop</a></div>
    </div></section></HydrationUnit>}
    {!product && error && !loading && <Notice error>{error}</Notice>}
    <HydrationUnit><Section title="Need something else?" className="st-store-panel"><p><a href="/shop">All products</a></p></Section></HydrationUnit>
  <FooterMenu /></main></div>
}
