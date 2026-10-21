import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { request, money } from './api'
import { Empty } from './primitives'
import type { Discovery, Facet } from './discovery'

interface Suggestion { kind: string; label: string; href: string }
/** A search box that offers matches as the shopper types. */
export function SearchBox({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const [text, setText] = useState(value), [items, setItems] = useState<Suggestion[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(-1)
  const id = useId(), seq = useRef(0)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    const mine = ++seq.current
    if (text.trim().length < 2) { setItems([]); return }
    const timer = setTimeout(() => { request<{ suggestions: Suggestion[] }>('/api/stall/discover/suggest?q=' + encodeURIComponent(text.trim())).then(result => { if (mine === seq.current) { setItems(result.suggestions); setActive(-1) } }, () => setItems([])) }, 150)
    return () => clearTimeout(timer)
  }, [text])
  function submit(event: FormEvent) { event.preventDefault(); setOpen(false); onSubmit(text.trim()) }
  function keys(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(current => Math.min(items.length - 1, current + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => Math.max(-1, current - 1)) }
    else if (event.key === 'Escape') setOpen(false)
    else if (event.key === 'Enter' && active >= 0 && items[active]) { event.preventDefault(); location.assign(items[active].href) }
  }
  return <form role="search" className="st-searchbox" onSubmit={submit}>
    <label htmlFor={`${id}-q`}>Search the shop</label>
    <div className="st-searchrow"><input id={`${id}-q`} type="search" role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined} autoComplete="off" maxLength={100} placeholder="Search products, SKUs and details" value={text}
      onChange={event => { setText(event.target.value); setOpen(true) }} onKeyDown={keys} onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => setOpen(true)} />
      <button>Search</button></div>
    {open && items.length > 0 && <ul id={`${id}-list`} role="listbox" aria-label="Suggestions" className="st-suggest">{items.map((item, index) => <li key={item.href + item.label} id={`${id}-o${index}`} role="option" aria-selected={index === active}><a href={item.href}><span>{item.label}</span><small>{item.kind}</small></a></li>)}</ul>}
  </form>
}
const sorts: [string, string][] = [['featured', 'Featured'], ['name', 'Name'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'], ['newest', 'Newest']]
export function Facets({ result, params, go }: { result: Discovery; params: URLSearchParams; go: (edit: (next: URLSearchParams) => void) => void }) {
  const { facets } = result, [low, setLow] = useState(params.get('min') ?? ''), [high, setHigh] = useState(params.get('max') ?? '')
  useEffect(() => { setLow(params.get('min') ?? ''); setHigh(params.get('max') ?? '') }, [params.toString()])
  const toggle = (key: string, value: string) => go(next => { const values = next.getAll(key); next.delete(key); (values.includes(value) ? values.filter(entry => entry !== value) : [...values, value]).forEach(entry => next.append(key, entry)) })
  const group = (title: string, key: string, values: Facet[]) => values.length > 0 && <fieldset key={key}><legend>{title}</legend>{values.map(entry => <label className="st-checkbox" key={entry.value}><input type="checkbox" checked={params.getAll(key).includes(entry.value)} onChange={() => toggle(key, entry.value)} />{entry.value} <span className="st-count-inline">({entry.count})</span></label>)}</fieldset>
  return <form className="st-facets st-stack" aria-label="Filter products" onSubmit={event => { event.preventDefault(); go(next => { low ? next.set('min', low) : next.delete('min'); high ? next.set('max', high) : next.delete('max') }) }}>
    {facets.collections.length > 0 && <fieldset><legend>Collection</legend><label className="st-checkbox"><input type="radio" name="collection" checked={!params.get('collection')} onChange={() => go(next => next.delete('collection'))} />All products</label>{facets.collections.map(entry => <label className="st-checkbox" key={entry.handle}><input type="radio" name="collection" checked={params.get('collection') === entry.handle} onChange={() => go(next => next.set('collection', entry.handle))} />{entry.title} <span className="st-count-inline">({entry.count})</span></label>)}</fieldset>}
    {group('Category', 'category', facets.categories)}
    {group('Tag', 'tag', facets.tags)}
    {facets.options.map(entry => group(entry.name, `option.${entry.name}`, entry.values))}
    {facets.attributes.map(entry => group(entry.name, `attr.${entry.name}`, entry.values))}
    {facets.price && <fieldset><legend>Price · USD</legend><div className="st-editor-grid"><label>Lowest price<input inputMode="decimal" value={low} placeholder={(facets.price.min / 100).toFixed(2)} onChange={event => setLow(event.target.value)} /></label><label>Highest price<input inputMode="decimal" value={high} placeholder={(facets.price.max / 100).toFixed(2)} onChange={event => setHigh(event.target.value)} /></label></div><button className="st-secondary">Apply price</button></fieldset>}
    <label className="st-checkbox"><input type="checkbox" checked={params.get('available') === '1'} onChange={event => go(next => event.target.checked ? next.set('available', '1') : next.delete('available'))} />In stock only <span className="st-count-inline">({facets.available.inStock})</span></label>
  </form>
}
export function ResultsBar({ result, params, go }: { result: Discovery; params: URLSearchParams; go: (edit: (next: URLSearchParams) => void) => void }) {
  const chips: { label: string; remove: (next: URLSearchParams) => void }[] = []
  params.forEach((value, key) => {
    if (['q', 'sort', 'page', 'collection'].includes(key)) return
    const label = key === 'min' ? `From ${money(Math.round(Number(value) * 100))}` : key === 'max' ? `Up to ${money(Math.round(Number(value) * 100))}` : key === 'available' ? 'In stock' : `${key.replace(/^(attr|option)\./, '')}: ${value}`
    chips.push({ label, remove: next => { const kept = next.getAll(key).filter(entry => entry !== value); next.delete(key); kept.forEach(entry => next.append(key, entry)) } })
  })
  const first = (result.page - 1) * 24 + 1
  return <div className="st-resultsbar st-stack">
    <div className="st-row"><p role="status" aria-live="polite" className="st-result-count">{result.total === 0 ? 'No products' : `${result.total} product${result.total === 1 ? '' : 's'}`}{result.query ? ` for “${result.query}”` : ''}{result.total > 24 ? ` · showing ${first}–${Math.min(result.total, first + 23)}` : ''}</p>
      <label className="st-sortlabel">Sort by<select value={result.sort === 'relevance' ? 'relevance' : params.get('sort') ?? result.sort} onChange={event => go(next => next.set('sort', event.target.value))}>{result.query && <option value="relevance">Relevance</option>}{sorts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    {chips.length > 0 && <ul className="st-chips" aria-label="Active filters">{chips.map(chip => <li key={chip.label}><button type="button" className="st-secondary" onClick={() => go(chip.remove)}>{chip.label}<span aria-hidden="true"> ×</span><span className="st-sr-only"> remove filter</span></button></li>)}<li><button type="button" className="st-link" onClick={() => go(next => { [...next.keys()].forEach(key => { if (key !== 'q' && key !== 'collection') next.delete(key) }) })}>Clear all filters</button></li></ul>}
  </div>
}
export function NoResults({ result, go }: { result: Discovery; go: (edit: (next: URLSearchParams) => void) => void }) {
  const suggestions = result.noResults?.suggestions
  return <Empty><h3>{result.query ? `Nothing matches “${result.query}”` : 'No products match these filters'}</h3>
    <p>Check the spelling, try fewer or different words, or remove a filter.</p>
    <div className="st-actions"><button type="button" className="st-secondary" onClick={() => go(next => { [...next.keys()].forEach(key => next.delete(key)) })}>Clear the search and filters</button></div>
    {(suggestions?.collections.length || suggestions?.categories.length) ? <p>Browse instead: {suggestions!.collections.map(entry => <a key={entry.handle} href={`/shop?collection=${encodeURIComponent(entry.handle)}`}>{entry.title}</a>).reduce<React.ReactNode[]>((all, link) => [...all, all.length ? ' · ' : '', link], [])}{suggestions!.categories.map(entry => <a key={entry.value} href={`/shop?category=${encodeURIComponent(entry.value)}`}> {entry.value}</a>)}</p> : null}</Empty>
}
export function Pager({ result, goPage }: { result: Discovery; goPage: (page: number) => void }) {
  if (result.pages < 2) return null
  return <nav className="st-pager" aria-label="Result pages"><button type="button" className="st-secondary" disabled={result.page <= 1} onClick={() => goPage(result.page - 1)}>Previous page</button><span>Page {result.page} of {result.pages}</span><button type="button" className="st-secondary" disabled={result.page >= result.pages} onClick={() => goPage(result.page + 1)}>Next page</button></nav>
}
