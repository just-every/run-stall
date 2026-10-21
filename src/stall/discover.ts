import { terms, type Merchandising } from './merchandising'
import type { Collection } from './collections'

type Item = { sku: string; unitCents: number; available: string; variant?: { options: Record<string, string> } }
type Product = { sku: string; handle: string; name: string; description?: string; listedAt?: string; categories?: string[]; tags?: string[]; attributes?: { name: string; value: string }[]; skus: string[] }
export type Source = { products: Product[]; items: Item[]; collections: { value: Collection }[]; config: Merchandising }
type Entry = { product: Product; items: { sku: string; cents: number; stocked: boolean; options: Record<string, string> }[]; words: Record<'name' | 'sku' | 'facet' | 'desc', string[]>; from: number; collections: Set<string> }
export type Filters = { q: string; collection?: string; category: string[]; tag: string[]; attr: Record<string, string[]>; option: Record<string, string[]>; min?: number; max?: number; available: boolean; sort: string; page: number }
export const pageSize = 24
const cents = (value: string | null) => { if (value === null || value === '') return undefined; if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return undefined; return Math.round(Number(value) * 100) }
const clean = (value: string) => value.slice(0, 100)
export function readFilters(params: URLSearchParams): Filters {
 const attr: Record<string, string[]> = {}, option: Record<string, string[]> = {}
 for (const key of new Set(params.keys())) {
  if (key.startsWith('attr.')) attr[key.slice(5, 65)] = params.getAll(key).slice(0, 20).map(clean)
  if (key.startsWith('option.')) option[key.slice(7, 47)] = params.getAll(key).slice(0, 30).map(clean)
 }
 const sort = ['relevance', 'featured', 'name', 'price-asc', 'price-desc', 'newest'].includes(params.get('sort') ?? '') ? params.get('sort')! : ''
 return { q: clean(params.get('q') ?? ''), collection: params.get('collection') ? clean(params.get('collection')!) : undefined, category: params.getAll('category').slice(0, 20).map(clean), tag: params.getAll('tag').slice(0, 20).map(clean), attr, option, min: cents(params.get('min')), max: cents(params.get('max')), available: params.get('available') === '1', sort, page: Math.max(1, Math.min(200, Number.parseInt(params.get('page') ?? '1', 10) || 1)) }
}
const words = (...values: (string | undefined)[]) => values.flatMap(value => value ? terms(value).split(' ').filter(Boolean) : [])
/** The text a shopper's words are matched against, and the alternatives synonyms add to the query. */
export function alternatives(query: string, groups: string[][]): string[] {
 const normal = terms(query)
 if (!normal) return []
 const found = new Set([normal])
 for (const group of groups) for (const term of group) if (` ${normal} `.includes(` ${term} `)) for (const other of group) if (other !== term) found.add(` ${normal} `.replace(` ${term} `, ` ${other} `).trim())
 return [...found].slice(0, 50)
}
function relevance(entry: Entry, alternative: string, name: string): number {
 const tokens = alternative.split(' ')
 let total = 0
 for (const token of tokens) {
  const score = Math.max(...Object.entries({ name: [10, 8], sku: [9, 7], facet: [5, 5], desc: [2, 2] }).map(([field, [exact, prefix]]) => Math.max(0, ...entry.words[field as keyof Entry['words']].map(word => word === token ? exact : word.startsWith(token) ? prefix : 0))))
  if (!score) return 0
  total += score
 }
 return total + (name === alternative ? 20 : 0)
}
function inCollection(entry: Entry, collection: Collection): boolean {
 if (collection.kind === 'manual') return !!collection.skus?.includes(entry.product.sku)
 const prices = entry.items.map(item => item.cents), lowest = Math.min(...prices)
 const test = (rule: NonNullable<Collection['rules']>[number]) => {
  if ('cents' in rule) return rule.field === 'price_min' ? lowest >= rule.cents : lowest <= rule.cents
  if ('name' in rule) return !!entry.product.attributes?.some(attribute => terms(attribute.name) === terms(rule.name) && terms(attribute.value) === terms(rule.value))
  if (rule.field === 'category') return !!entry.product.categories?.some(value => terms(value) === terms(rule.value))
  if (rule.field === 'tag') return !!entry.product.tags?.some(value => terms(value) === terms(rule.value))
  return ` ${terms(entry.product.name)} `.includes(` ${terms(rule.value)} `)
 }
 return collection.match === 'any' ? !!collection.rules?.some(test) : !!collection.rules?.every(test)
}
const same = (a: string, b: string) => terms(a) === terms(b)
/** Which groups of a filter set a product satisfies; `skip` leaves one group out (for facet counts). */
function passes(entry: Entry, f: Filters, skip = ''): boolean {
 if (skip !== 'collection' && f.collection && !entry.collections.has(f.collection)) return false
 if (skip !== 'category' && f.category.length && !f.category.some(wanted => entry.product.categories?.some(value => same(value, wanted)))) return false
 if (skip !== 'tag' && f.tag.length && !f.tag.some(wanted => entry.product.tags?.some(value => same(value, wanted)))) return false
 for (const [name, values] of Object.entries(f.attr)) if (skip !== `attr:${name}` && values.length && !values.some(wanted => entry.product.attributes?.some(attribute => same(attribute.name, name) && same(attribute.value, wanted)))) return false
 // Price, availability and options are choices of one variant, so they must hold for the same one.
 return entry.items.some(item => (skip === 'price' || ((f.min === undefined || item.cents >= f.min) && (f.max === undefined || item.cents <= f.max))) && (skip === 'available' || !f.available || item.stocked)
  && Object.entries(f.option).every(([name, values]) => skip === `option:${name}` || !values.length || values.some(wanted => Object.entries(item.options).some(([key, value]) => same(key, name) && same(value, wanted)))))
}
const tally = (values: string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
export function discover(source: Source, f: Filters) {
 const published = source.collections.map(entry => entry.value).filter(entry => entry.published)
 const entries: Entry[] = source.products.flatMap(product => {
  const items = source.items.filter(item => product.skus.includes(item.sku)).map(item => ({ sku: item.sku, cents: item.unitCents, stocked: Number(item.available) > 0, options: item.variant?.options ?? {} }))
  if (!items.length) return []
  const facets = [...(product.categories ?? []), ...(product.tags ?? []), ...(product.attributes?.flatMap(attribute => [attribute.name, attribute.value]) ?? []), ...items.flatMap(item => Object.values(item.options))]
  const entry: Entry = { product, items, words: { name: words(product.name), sku: words(product.sku, ...items.map(item => item.sku)), facet: words(...facets), desc: words(product.description) }, from: Math.min(...items.map(item => item.cents)), collections: new Set() }
  for (const collection of published) if (inCollection(entry, collection)) entry.collections.add(collection.handle)
  return [entry]
 })
 const alts = alternatives(f.q, source.config.synonyms), rule = source.config.pins.find(pin => alts.includes(pin.query))
 const scores = new Map<string, number>(), pinned = rule?.pinned ?? []
 for (const entry of entries) {
  const best = Math.max(0, ...alts.map(alt => relevance(entry, alt, terms(entry.product.name))))
  if (best) scores.set(entry.product.sku, best + (rule?.boosted.includes(entry.product.sku) ? 1000 : 0))
 }
 const base = entries.filter(entry => !alts.length || scores.has(entry.product.sku) || pinned.includes(entry.product.sku))
 const kept = (skip = '') => base.filter(entry => passes(entry, f, skip))
 const found = kept(), collection = f.collection ? published.find(entry => entry.handle === f.collection) : undefined
 const sort = f.sort || (alts.length ? 'relevance' : collection?.sort ?? 'featured')
 const order = (a: Entry, b: Entry) => {
  const pin = (entry: Entry) => { const at = pinned.indexOf(entry.product.sku); return at < 0 ? 999 : at }
  if (alts.length && pin(a) !== pin(b)) return pin(a) - pin(b)
  const byName = a.product.name.localeCompare(b.product.name) || a.product.sku.localeCompare(b.product.sku)
  if (sort === 'price-asc') return a.from - b.from || byName
  if (sort === 'price-desc') return b.from - a.from || byName
  if (sort === 'newest') return (b.product.listedAt ?? '').localeCompare(a.product.listedAt ?? '') || byName
  if (sort === 'relevance' && alts.length) return (scores.get(b.product.sku) ?? 0) - (scores.get(a.product.sku) ?? 0) || byName
  if (sort === 'featured' && collection?.kind === 'manual') return (collection.skus!.indexOf(a.product.sku)) - (collection.skus!.indexOf(b.product.sku))
  return byName
 }
 found.sort(order)
 const pages = Math.max(1, Math.ceil(found.length / pageSize)), page = Math.min(f.page, pages)
 const attrNames = [...new Set(base.flatMap(entry => entry.product.attributes?.map(attribute => attribute.name) ?? []))].sort()
 const optionNames = [...new Set(base.flatMap(entry => entry.items.flatMap(item => Object.keys(item.options))))].sort()
 const priced = kept('price').flatMap(entry => entry.items.map(item => item.cents))
 const facets = {
  collections: published.map(entry => ({ handle: entry.handle, title: entry.title, count: kept('collection').filter(product => product.collections.has(entry.handle)).length })).filter(entry => entry.count || entry.handle === f.collection),
  categories: tally(kept('category').flatMap(entry => [...new Set(entry.product.categories ?? [])])),
  tags: tally(kept('tag').flatMap(entry => [...new Set(entry.product.tags ?? [])])),
  attributes: attrNames.map(name => ({ name, values: tally(kept(`attr:${name}`).flatMap(entry => [...new Set(entry.product.attributes?.filter(attribute => attribute.name === name).map(attribute => attribute.value))])) })).filter(group => group.values.length),
  options: optionNames.map(name => ({ name, values: tally(kept(`option:${name}`).flatMap(entry => [...new Set(entry.items.map(item => item.options[name]).filter(Boolean))])) })).filter(group => group.values.length),
  price: priced.length ? { min: Math.min(...priced), max: Math.max(...priced) } : null,
  available: { inStock: kept('available').filter(entry => entry.items.some(item => item.stocked)).length, all: kept('available').length },
 }
 const popular = published.map(entry => ({ handle: entry.handle, title: entry.title, count: entries.filter(product => product.collections.has(entry.handle)).length })).filter(entry => entry.count)
 return { query: f.q, total: found.length, page, pages, pageSize, sort, order: found.slice((page - 1) * pageSize, page * pageSize).map(entry => entry.product.sku), collection: collection ? { handle: collection.handle, title: collection.title, description: collection.description } : null, facets,
  ...(found.length ? {} : { noResults: { query: f.q, suggestions: { collections: popular.slice(0, 5), categories: tally(entries.flatMap(entry => [...new Set(entry.product.categories ?? [])])).slice(0, 5) } } }) }
}
export function suggest(source: Source, query: string) {
 const alts = alternatives(query, source.config.synonyms)
 if (!alts.length) return []
 const matches = (text: string) => { const w = words(text); return alts.some(alt => alt.split(' ').every(token => w.some(word => word.startsWith(token)))) }
 const listed = source.products.filter(product => source.items.some(item => product.skus.includes(item.sku)))
 const products = listed.filter(product => matches(product.name) || product.skus.some(sku => matches(sku))).slice(0, 5).map(product => ({ kind: 'product', label: product.name, href: `/shop/${product.handle}` }))
 const lists = source.collections.map(entry => entry.value).filter(entry => entry.published && matches(entry.title)).slice(0, 2).map(entry => ({ kind: 'collection', label: entry.title, href: `/shop?collection=${encodeURIComponent(entry.handle)}` }))
 const categories = [...new Set(listed.flatMap(product => product.categories ?? []))].filter(matches).slice(0, 2).map(label => ({ kind: 'category', label, href: `/shop?category=${encodeURIComponent(label)}` }))
 return [...products, ...lists, ...categories].slice(0, 8)
}
