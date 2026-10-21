import type { Media, Option, Variant } from '../listing'
import { money } from './api'

export type VariantRow = { sku: string; options: Record<string, string>; price: string; compare: string; cost: string; weight: string; length: string; width: string; height: string; hsCode: string; origin: string; customs: string; mediaId: string; archived: boolean }
export type OptionRow = { name: string; values: string }
const cents = (value: string, name: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${name} must be dollars and cents.`); return Math.round(Number(value) * 100) }
export const rowOf = (variant: Variant): VariantRow => ({ sku: variant.sku, options: variant.options, price: variant.unitCents === undefined ? '' : (variant.unitCents / 100).toFixed(2), compare: variant.compareAtCents === undefined ? '' : (variant.compareAtCents / 100).toFixed(2), cost: variant.costCents === undefined ? '' : (variant.costCents / 100).toFixed(2), weight: String(variant.weightGrams ?? ''), length: String(variant.dimensionsMm?.length ?? ''), width: String(variant.dimensionsMm?.width ?? ''), height: String(variant.dimensionsMm?.height ?? ''), hsCode: variant.hsCode ?? '', origin: variant.countryOfOrigin ?? '', customs: variant.customsDescription ?? '', mediaId: variant.mediaId ?? '', archived: !!variant.archived })
export function readOptions(rows: OptionRow[]): Option[] { return rows.filter(row => row.name.trim()).map(row => ({ name: row.name.trim(), values: row.values.split(',').map(value => value.trim()).filter(Boolean) })) }
export function readVariants(rows: VariantRow[]): Variant[] {
  return rows.map(row => {
    const variant: Variant = { sku: row.sku.trim(), options: row.options }
    if (row.price) variant.unitCents = cents(row.price, `Variant ${row.sku} price`)
    if (row.compare) variant.compareAtCents = cents(row.compare, `Variant ${row.sku} compare-at price`)
    if (row.cost) variant.costCents = cents(row.cost, `Variant ${row.sku} cost`)
    if (row.weight) variant.weightGrams = Number(row.weight)
    const size = [row.length, row.width, row.height]
    if (size.some(Boolean)) {
      if (!size.every(value => /^\d+$/.test(value) && Number(value) > 0)) throw new Error(`Variant ${row.sku} needs all three dimensions as positive whole millimeters, or none.`)
      variant.dimensionsMm = { length: Number(row.length), width: Number(row.width), height: Number(row.height) }
    }
    if (row.hsCode.trim()) variant.hsCode = row.hsCode.trim()
    if (row.origin.trim()) variant.countryOfOrigin = row.origin.trim().toUpperCase()
    if (row.customs.trim()) variant.customsDescription = row.customs.trim()
    if (row.mediaId) variant.mediaId = row.mediaId
    if (row.archived) variant.archived = true
    return variant
  })
}
function combinations(options: Option[]): Record<string, string>[] { return options.reduce<Record<string, string>[]>((rows, option) => rows.flatMap(row => option.values.map(value => ({ ...row, [option.name]: value }))), [{}]) }
const slug = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g, '')

export function VariantsEditor({ sku, options, setOptions, variants, setVariants, media, busy }: { sku: string; options: OptionRow[]; setOptions: (next: OptionRow[]) => void; variants: VariantRow[]; setVariants: (next: VariantRow[]) => void; media: Media[]; busy: boolean }) {
  const change = (index: number, patch: Partial<VariantRow>) => setVariants(variants.map((row, at) => at === index ? { ...row, ...patch } : row))
  function generate() {
    const declared = readOptions(options)
    const made = combinations(declared).map((chosen): VariantRow => {
      const kept = variants.find(row => declared.every(option => row.options[option.name] === chosen[option.name]))
      return kept ?? { sku: `${sku.trim() || 'SKU'}-${declared.map(option => slug(chosen[option.name])).join('-')}`, options: chosen, price: '', compare: '', cost: '', weight: '', length: '', width: '', height: '', hsCode: '', origin: '', customs: '', mediaId: '', archived: false }
    })
    setVariants(made)
  }
  return <fieldset className="st-stack" disabled={busy}><legend>Options and variants</legend>
    <p className="st-small">Each variant is its own SKU and must exist in Pier before publication. Leave a price blank to use the product price.</p>
    {options.map((option, index) => <div className="st-editor-grid" key={index}>
      <label>Option {index + 1} name<input maxLength={40} value={option.name} placeholder="Size" onChange={event => setOptions(options.map((row, at) => at === index ? { ...row, name: event.target.value } : row))} /></label>
      <label>Option {index + 1} values (comma separated)<input value={option.values} placeholder="S, M, L" onChange={event => setOptions(options.map((row, at) => at === index ? { ...row, values: event.target.value } : row))} /></label>
      <button type="button" className="st-secondary" onClick={() => { setOptions(options.filter((_, at) => at !== index)); setVariants([]) }}>Remove option {index + 1}</button>
    </div>)}
    <div className="st-actions"><button type="button" className="st-secondary" disabled={options.length >= 3} onClick={() => setOptions([...options, { name: '', values: '' }])}>Add an option</button><button type="button" className="st-secondary" disabled={!readOptions(options).length} onClick={generate}>Generate variants from options</button></div>
    {variants.map((row, index) => <fieldset className="st-variant st-stack" key={row.sku + index}><legend>Variant {index + 1}: {Object.values(row.options).join(' / ')}</legend>
      <div className="st-editor-grid">
        <label>Variant {index + 1} SKU<input required maxLength={100} value={row.sku} onChange={event => change(index, { sku: event.target.value })} /></label>
        <label>Variant {index + 1} price · USD<input inputMode="decimal" value={row.price} placeholder="Product price" onChange={event => change(index, { price: event.target.value })} /></label>
        <label>Variant {index + 1} compare-at price<input inputMode="decimal" value={row.compare} placeholder="None" onChange={event => change(index, { compare: event.target.value })} /></label>
        <label>Variant {index + 1} cost · USD<input inputMode="decimal" value={row.cost} placeholder="Not set" onChange={event => change(index, { cost: event.target.value })} /></label>
        <label>Variant {index + 1} weight · g<input type="number" min="1" step="1" value={row.weight} onChange={event => change(index, { weight: event.target.value })} /></label>
        {(['length', 'width', 'height'] as const).map(name => <label key={name}>Variant {index + 1} {name} · mm<input type="number" min="1" step="1" value={row[name]} onChange={event => change(index, { [name]: event.target.value })} /></label>)}
        <label>Variant {index + 1} HS code<input inputMode="numeric" value={row.hsCode} onChange={event => change(index, { hsCode: event.target.value })} /></label>
        <label>Variant {index + 1} country of origin<input maxLength={2} value={row.origin} onChange={event => change(index, { origin: event.target.value.toUpperCase() })} /></label>
      </div>
      <label>Variant {index + 1} customs description<input maxLength={200} value={row.customs} onChange={event => change(index, { customs: event.target.value })} /></label>
      <label>Variant {index + 1} image<select value={row.mediaId} onChange={event => change(index, { mediaId: event.target.value })}><option value="">Product gallery</option>{media.filter(item => item.kind === 'image').map((item, at) => <option key={item.id} value={item.id}>Image {at + 1}{item.alt ? `: ${item.alt}` : ''}</option>)}</select></label>
      <label className="st-checkbox"><input type="checkbox" checked={row.archived} onChange={event => change(index, { archived: event.target.checked })} />Archive variant {index + 1} (it keeps its order history and leaves the shop)</label>
    </fieldset>)}
    {variants.length > 0 && <p className="st-small">{variants.filter(row => !row.archived).length} of {variants.length} variants on sale{variants.some(row => row.price) ? ` · from ${money(Math.min(...variants.filter(row => row.price && !row.archived).map(row => cents(row.price, 'Price'))))}` : ''}.</p>}
  </fieldset>
}
