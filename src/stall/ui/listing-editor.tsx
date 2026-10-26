import { useState } from 'react'
import type { Listing, Media } from '../listing'
import type { ProductDetails } from '../product-details'
import { money } from './api'
import { MediaEditor } from './media-editor'
import { PersonalizationEditor, fieldRowOf, readFields, type FieldRow } from './personalization-editor'
import { VariantsEditor, readOptions, readVariants, rowOf, type OptionRow, type VariantRow } from './variants-editor'

const list = (text: string) => text.split(',').map(entry => entry.trim()).filter(Boolean)
const dollars = (value: string, name: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${name} must be dollars and cents.`); return Math.round(Number(value) * 100) }
type Attribute = { name: string; value: string }
/** The listing half of a product revision: what the shop shows and sells. */
export function useListing(initial?: ProductDetails) {
  const [handle, setHandle] = useState(initial?.handle ?? ''), [compareAt, setCompareAt] = useState(initial?.compareAtCents ? (initial.compareAtCents / 100).toFixed(2) : '')
  const [categories, setCategories] = useState(initial?.categories?.join(', ') ?? ''), [tags, setTags] = useState(initial?.tags?.join(', ') ?? ''), [customs, setCustoms] = useState(initial?.customsDescription ?? '')
  const [attributes, setAttributes] = useState<Attribute[]>(initial?.attributes ?? []), [media, setMedia] = useState<Media[]>(initial?.media ?? [])
  const [options, setOptions] = useState<OptionRow[]>(initial?.options?.map(option => ({ name: option.name, values: option.values.join(', ') })) ?? []), [variants, setVariants] = useState<VariantRow[]>(initial?.variants?.map(rowOf) ?? [])
  const [fields, setFields] = useState<FieldRow[]>(initial?.personalization?.map(fieldRowOf) ?? [])
  function read(): Listing {
    const result: Listing = { ...(initial?.seo ? { seo: initial.seo } : {}) }
    if (handle.trim()) result.handle = handle.trim()
    if (compareAt.trim()) result.compareAtCents = dollars(compareAt.trim(), 'Compare-at price')
    if (list(categories).length) result.categories = list(categories)
    if (list(tags).length) result.tags = list(tags)
    if (customs.trim()) result.customsDescription = customs.trim()
    if (attributes.length) result.attributes = attributes.map(attribute => ({ name: attribute.name.trim(), value: attribute.value.trim() }))
    if (media.length) result.media = media
    if (readOptions(options).length) { result.options = readOptions(options); result.variants = readVariants(variants) }
    if (fields.length) result.personalization = readFields(fields)
    return result
  }
  return { handle, setHandle, compareAt, setCompareAt, categories, setCategories, tags, setTags, customs, setCustoms, attributes, setAttributes, media, setMedia, options, setOptions, variants, setVariants, fields, setFields, read }
}
export function ListingEditor({ input, sku, busy }: { input: ReturnType<typeof useListing>; sku: string; busy: boolean }) {
  return <div className="st-stack">
    <details onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Shop listing: handle, categories, attributes and prices</summary><fieldset disabled={busy} className="st-stack"><legend>What shoppers see</legend>
      <div className="st-editor-grid"><label>Handle (page address)<input maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={input.handle} placeholder="linen-tee" onChange={event => input.setHandle(event.target.value)} /></label><label>Compare-at price · USD<input inputMode="decimal" value={input.compareAt} placeholder="None" onChange={event => input.setCompareAt(event.target.value)} /></label></div>
      <label>Categories (comma separated)<input value={input.categories} onChange={event => input.setCategories(event.target.value)} /></label>
      <label>Tags (comma separated)<input value={input.tags} onChange={event => input.setTags(event.target.value)} /></label>
      <label>Customs description<input maxLength={200} value={input.customs} onChange={event => input.setCustoms(event.target.value)} /></label>
      {input.attributes.map((attribute, index) => <div className="st-editor-grid" key={index}>
        <label>Attribute {index + 1} name<input required maxLength={60} value={attribute.name} onChange={event => input.setAttributes(input.attributes.map((row, at) => at === index ? { ...row, name: event.target.value } : row))} /></label>
        <label>Attribute {index + 1} value<input required maxLength={120} value={attribute.value} onChange={event => input.setAttributes(input.attributes.map((row, at) => at === index ? { ...row, value: event.target.value } : row))} /></label>
        <button type="button" className="st-secondary" onClick={() => input.setAttributes(input.attributes.filter((_, at) => at !== index))}>Remove attribute {index + 1}</button>
      </div>)}
      <button type="button" className="st-secondary" disabled={input.attributes.length >= 30} onClick={() => input.setAttributes([...input.attributes, { name: '', value: '' }])}>Add an attribute</button>
    </fieldset></details>
    <details onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Images and videos</summary><MediaEditor media={input.media} setMedia={input.setMedia} busy={busy} /></details>
    <details onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Options and variants</summary><VariantsEditor sku={sku} options={input.options} setOptions={input.setOptions} variants={input.variants} setVariants={input.setVariants} media={input.media} busy={busy} /></details>
    <details onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Personalization</summary><PersonalizationEditor rows={input.fields} setRows={input.setFields} busy={busy} /></details>
  </div>
}
export function ListingView({ details }: { details?: ProductDetails }) {
  if (!details || !(details.seo || details.handle || details.categories || details.tags || details.attributes || details.media || details.variants || details.personalization || details.compareAtCents)) return <p className="st-small">No shop listing details.</p>
  return <div className="st-stack">
    <dl>
      {details.seo?.title && <div><dt>SEO title</dt><dd>{details.seo.title}</dd></div>}
      {details.seo?.description && <div><dt>SEO description</dt><dd>{details.seo.description}</dd></div>}
      {details.handle && <div><dt>Handle</dt><dd>{details.handle}</dd></div>}
      {details.compareAtCents !== undefined && <div><dt>Compare-at price · USD</dt><dd>{money(details.compareAtCents)}</dd></div>}
      {details.categories && <div><dt>Categories</dt><dd>{details.categories.join(', ')}</dd></div>}
      {details.tags && <div><dt>Tags</dt><dd>{details.tags.join(', ')}</dd></div>}
      {details.attributes?.map(attribute => <div key={attribute.name}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></div>)}
      {details.media && <div><dt>Media</dt><dd>{details.media.map((item, index) => <span key={item.id}>{index ? ' · ' : ''}{item.kind} {index + 1}: {item.alt}</span>)}</dd></div>}
    </dl>
    {details.variants && <table><caption>Variants</caption><thead><tr><th scope="col">SKU</th><th scope="col">Options</th><th scope="col">Price</th><th scope="col">State</th></tr></thead><tbody>{details.variants.map(variant => <tr key={variant.sku}><td>{variant.sku}</td><td>{Object.values(variant.options).join(' / ')}</td><td>{variant.unitCents === undefined ? 'Product price' : money(variant.unitCents)}</td><td>{variant.archived ? 'Archived' : 'On sale'}</td></tr>)}</tbody></table>}
    {details.personalization && <ul>{details.personalization.map(field => <li key={field.key}>{field.label} · {field.type}{field.type === 'text' ? ` up to ${field.maxLength} characters` : field.type === 'choice' ? `: ${field.choices.join(', ')}` : ` ${field.fileTypes.join('/')} up to ${Math.floor(field.maxBytes / 1000)} KB`}{field.required ? ' · required' : ''}{field.addOnCents ? ` · +${money(field.addOnCents)}` : ''}</li>)}</ul>}
  </div>
}
