import { useEffect, useState } from 'react'
import { request, errorMessage } from './api'
import type { Merchandising, Product } from './types'

type Report = { top: { query: string; searches: number; noResults: number }[]; noResults: { query: string; searches: number; noResults: number }[]; totals: { searches: number; noResultSearches: number; distinctQueries: number } }
export function SearchTuning({ merchandising, products, busy, run }: { merchandising: Merchandising; products: Product[]; busy: boolean; run: (type: string, payload: unknown) => Promise<boolean> }) {
  const { value, revisions } = merchandising.config
  const [synonyms, setSynonyms] = useState(value.synonyms.map(group => group.join(', ')).join('\n')), [pins, setPins] = useState(value.pins.map(pin => ({ query: pin.query, pinned: pin.pinned.join(', '), boosted: pin.boosted.join(', ') })))
  const [report, setReport] = useState<Report | null>(null), [problem, setProblem] = useState('')
  const load = () => request<Report>('/api/stall/search-report').then(setReport, error => setProblem(errorMessage(error)))
  useEffect(() => { void load() }, [])
  const list = (text: string) => text.split(',').map(entry => entry.trim()).filter(Boolean)
  return <div className="st-stack">
    <form className="st-stack" aria-label="Search synonyms" onSubmit={event => { event.preventDefault(); void run('search.synonyms', { groups: synonyms.split('\n').map(list).filter(group => group.length), ...(revisions.synonyms ? { revision: revisions.synonyms } : {}) }) }}>
      <h3>Synonyms</h3><p className="st-small">One group per line, terms separated by commas: <code>tee, t-shirt</code>. A shopper who searches any term also finds the others.</p>
      <label>Synonym groups<textarea rows={4} value={synonyms} disabled={busy} onChange={event => setSynonyms(event.target.value)} /></label>
      <div className="st-actions"><button disabled={busy}>Save synonyms</button></div>
    </form>
    <form className="st-stack" aria-label="Pinned and boosted products" onSubmit={event => { event.preventDefault(); void run('search.pin', { pins: pins.map(pin => ({ query: pin.query, pinned: list(pin.pinned), boosted: list(pin.boosted) })), ...(revisions.pins ? { revision: revisions.pins } : {}) }) }}>
      <h3>Pinned and boosted products</h3><p className="st-small">A pinned product leads the results for that search; a boosted product ranks above other matches. Use product SKUs{products.length ? `, for example ${products[0].id}` : ''}.</p>
      {pins.map((pin, index) => <div className="st-editor-grid" key={index}>
        <label>Search {index + 1} query<input required maxLength={80} value={pin.query} disabled={busy} onChange={event => setPins(pins.map((entry, at) => at === index ? { ...entry, query: event.target.value } : entry))} /></label>
        <label>Search {index + 1} pinned SKUs<input value={pin.pinned} disabled={busy} onChange={event => setPins(pins.map((entry, at) => at === index ? { ...entry, pinned: event.target.value } : entry))} /></label>
        <label>Search {index + 1} boosted SKUs<input value={pin.boosted} disabled={busy} onChange={event => setPins(pins.map((entry, at) => at === index ? { ...entry, boosted: event.target.value } : entry))} /></label>
        <button type="button" className="st-secondary" disabled={busy} onClick={() => setPins(pins.filter((_, at) => at !== index))}>Remove search {index + 1}</button>
      </div>)}
      <button type="button" className="st-secondary" disabled={busy || pins.length >= 100} onClick={() => setPins([...pins, { query: '', pinned: '', boosted: '' }])}>Add a pinned search</button>
      <div className="st-actions"><button disabled={busy}>Save pinned products</button></div>
    </form>
    <section className="st-stack" aria-label="Search report"><div className="st-row"><h3>Search report</h3><button className="st-secondary" onClick={() => void load()}>Refresh search report</button></div>
      {problem && <p role="alert" className="st-field-error">{problem}</p>}
      {report && <><p className="st-small">{report.totals.searches} searches across {report.totals.distinctQueries} different queries; {report.totals.noResultSearches} found nothing. Only the words searched are kept, never who searched.</p>
        <div className="st-table-wrap"><table><caption>Top searches</caption><thead><tr><th scope="col">Query</th><th scope="col" className="st-num">Searches</th><th scope="col" className="st-num">With no results</th></tr></thead><tbody>{report.top.map(row => <tr key={row.query}><td>{row.query}</td><td className="st-num">{row.searches}</td><td className="st-num">{row.noResults}</td></tr>)}{!report.top.length && <tr><td colSpan={3}>No searches yet.</td></tr>}</tbody></table></div>
        <div className="st-table-wrap"><table><caption>Searches with no results</caption><thead><tr><th scope="col">Query</th><th scope="col" className="st-num">Times</th></tr></thead><tbody>{report.noResults.map(row => <tr key={row.query}><td>{row.query}</td><td className="st-num">{row.noResults}</td></tr>)}{!report.noResults.length && <tr><td colSpan={2}>Every search found something.</td></tr>}</tbody></table></div></>}
    </section>
  </div>
}
