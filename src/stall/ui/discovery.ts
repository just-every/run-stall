// The shop page's browse state lives in the address bar, so every result view can be shared and reloaded.
import { useCallback, useEffect, useRef, useState } from 'react'
import { request, errorMessage } from './api'

export interface Facet { value: string; count: number }
export interface Discovery {
  query: string; total: number; page: number; pages: number; sort: string; order: string[]
  collection: { handle: string; title: string; description: string } | null
  facets: { collections: { handle: string; title: string; count: number }[]; categories: Facet[]; tags: Facet[]; attributes: { name: string; values: Facet[] }[]; options: { name: string; values: Facet[] }[]; price: { min: number; max: number } | null; available: { inStock: number; all: number } }
  noResults?: { query: string; suggestions: { collections: { handle: string; title: string }[]; categories: Facet[] } }
}
export const browseKeys = ['q', 'collection', 'category', 'tag', 'min', 'max', 'available', 'sort', 'page']
export const isBrowseKey = (key: string) => browseKeys.includes(key) || key.startsWith('attr.') || key.startsWith('option.')
/** The browse part of the address, without other parameters. */
export const browseParams = (search: string) => { const all = new URLSearchParams(search), kept = new URLSearchParams(); all.forEach((value, key) => { if (isBrowseKey(key)) kept.append(key, value) }); return kept }
export function useDiscovery() {
  const [search, setSearch] = useState(''), [result, setResult] = useState<Discovery | null>(null), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false)
  const report = useRef(true), latest = useRef(0)
  useEffect(() => { setSearch(location.search); const back = () => { report.current = true; setSearch(location.search) }; addEventListener('popstate', back); return () => removeEventListener('popstate', back) }, [])
  const params = browseParams(search)
  const load = useCallback(async () => {
    const mine = ++latest.current, query = browseParams(location.search)
    if (report.current && query.get('q')) query.set('report', '1')
    report.current = false
    setBusy(true)
    try { const next = await request<Discovery>('/api/stall/discover?' + query.toString()); if (mine === latest.current) { setResult(next); setProblem('') } }
    catch (error) { if (mine === latest.current) setProblem(errorMessage(error)) }
    finally { if (mine === latest.current) setBusy(false) }
  }, [])
  useEffect(() => { if (search !== '' || result === null) void load() }, [search, load])
  /** Change the browse state: `edit` updates a copy of the current parameters. A new search term is reported once. */
  function go(edit: (next: URLSearchParams) => void) {
    const next = browseParams(location.search), before = next.get('q')
    edit(next)
    if (next.get('q') !== before) report.current = true
    next.delete('page')
    const target = next.toString()
    history.pushState(null, '', target ? `?${target}` : location.pathname); setSearch(location.search)
  }
  /** Page changes keep the other parameters. */
  function goPage(page: number) { const next = browseParams(location.search); if (page > 1) next.set('page', String(page)); else next.delete('page'); history.pushState(null, '', next.toString() ? `?${next}` : location.pathname); setSearch(location.search) }
  return { params, result, problem, busy, go, goPage, reload: load }
}
