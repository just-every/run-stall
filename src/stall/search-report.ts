import { terms } from './merchandising'

const cap = 5000
/** What was searched, as normalized text with counts: no person, address or session is kept. */
export async function recordSearch(db: D1Database, query: string, results: number) {
 const normal = terms(query).slice(0, 80)
 if (!normal) return
 await db.batch([
  db.prepare('INSERT INTO st_search_terms VALUES(?,1,?,?) ON CONFLICT(query) DO UPDATE SET searches=searches+1,empty=empty+excluded.empty,last_at=excluded.last_at').bind(normal, results ? 0 : 1, new Date().toISOString()),
  db.prepare('DELETE FROM st_search_terms WHERE query IN (SELECT query FROM st_search_terms WHERE (SELECT COUNT(*) FROM st_search_terms)>? ORDER BY searches,last_at LIMIT 500)').bind(cap),
 ])
}
export async function searchReport(db: D1Database) {
 const row = (r: any) => ({ query: r.query, searches: r.searches, noResults: r.empty, lastAt: r.last_at })
 const top = (await db.prepare('SELECT * FROM st_search_terms ORDER BY searches DESC,last_at DESC LIMIT 25').all<any>()).results.map(row)
 const empty = (await db.prepare('SELECT * FROM st_search_terms WHERE empty>0 ORDER BY empty DESC,last_at DESC LIMIT 25').all<any>()).results.map(row)
 const totals = await db.prepare('SELECT COALESCE(SUM(searches),0) AS searches,COALESCE(SUM(empty),0) AS empty,COUNT(*) AS queries FROM st_search_terms').first<any>()
 return { top, noResults: empty, totals: { searches: totals.searches, noResultSearches: totals.empty, distinctQueries: totals.queries } }
}
