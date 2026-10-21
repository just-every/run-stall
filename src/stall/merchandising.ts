import type { Bindings } from '../auth.server'
import { audit, changed, commit } from './access'
import { fail, requirePerson, text, type Actor } from './model'
import { strictObject } from './facts'
import { handleName } from './collections'

export type MenuItem = { label: string; to: { type: 'collection' | 'product'; handle: string } | { type: 'link'; href: string }; children?: MenuItem[] }
export type Pin = { query: string; pinned: string[]; boosted: string[] }
export type Merchandising = { menus: { main: MenuItem[]; footer: MenuItem[] }; synonyms: string[][]; pins: Pin[] }
export const terms = (value: string) => value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const empty: Merchandising = { menus: { main: [], footer: [] }, synonyms: [], pins: [] }
export async function merchandising(db: D1Database): Promise<{ value: Merchandising; revisions: Record<string, string> }> {
 const rows = (await db.prepare('SELECT * FROM st_search_config').all<any>()).results, value = structuredClone(empty), revisions: Record<string, string> = {}
 for (const row of rows) { revisions[row.id] = row.revision; const stored = JSON.parse(row.value_json); if (row.id === 'menus') value.menus = stored; else if (row.id === 'synonyms') value.synonyms = stored; else value.pins = stored }
 return { value, revisions }
}
function item(input: unknown, depth: number): MenuItem {
 const entry = strictObject(input, ['label', 'to', 'children'], 'Menu item'), label = text(entry.label, 'Menu label', 60), to = strictObject(entry.to, ['type', 'handle', 'href'], 'Menu link')
 const target: MenuItem['to'] = to.type === 'collection' || to.type === 'product' ? { type: to.type, handle: handleName(to.handle, 'Menu handle') }
  : to.type === 'link' && typeof to.href === 'string' && /^(\/(?!\/)[\w\-./?=&%#]*|https:\/\/[^\s<>"']+)$/.test(to.href) && to.href.length <= 300 ? { type: 'link', href: to.href } : fail('INPUT', 'A menu link goes to a collection, a product, a path in this shop or an https address.', 400)
 if (entry.children === undefined) return { label, to: target }
 if (depth >= 1 || !Array.isArray(entry.children) || entry.children.length > 12) fail('INPUT', 'A menu has at most two levels and twelve items under each heading.', 400)
 return { label, to: target, children: entry.children.map(child => item(child, depth + 1)) }
}
export async function merchandisingCommand(env: Bindings, actor: Actor, type: string, p: any) {
 requirePerson(actor)
 const current = await merchandising(env.DB)
 let id: 'menus' | 'synonyms' | 'pins', value: unknown
 if (type === 'menu.save') {
  id = 'menus'
  if (p.name !== 'main' && p.name !== 'footer') fail('INPUT', 'Menus are named main or footer.', 400)
  if (!Array.isArray(p.items) || p.items.length > 12) fail('INPUT', 'A menu has at most twelve items.', 400)
  value = { ...current.value.menus, [p.name]: p.items.map((entry: unknown) => item(entry, 0)) }
 } else if (type === 'search.synonyms') {
  id = 'synonyms'
  if (!Array.isArray(p.groups) || p.groups.length > 100) fail('INPUT', 'Use at most 100 synonym groups.', 400)
  const seen = new Set<string>()
  value = p.groups.map((group: unknown) => {
   if (!Array.isArray(group) || group.length < 2 || group.length > 10) fail('INPUT', 'A synonym group lists two to ten terms.', 400)
   const words = group.map(word => terms(text(word, 'Synonym', 40)))
   if (words.some(word => !word) || new Set(words).size !== words.length || words.some(word => seen.has(word))) fail('INPUT', 'Each synonym term appears once, in one group.', 400)
   words.forEach(word => seen.add(word)); return words
  })
 } else {
  id = 'pins'
  if (!Array.isArray(p.pins) || p.pins.length > 100) fail('INPUT', 'Use at most 100 pinned searches.', 400)
  const known = new Set((await env.DB.prepare('SELECT id FROM st_products').all<{ id: string }>()).results.map(row => row.id)), seen = new Set<string>()
  const skus = (list: unknown, name: string, max: number) => { if (!Array.isArray(list) || list.length > max) fail('INPUT', `${name} lists at most ${max} products.`, 400); const out = list.map(sku => text(sku, 'Product SKU', 100)); const missing = out.find(sku => !known.has(sku)); if (missing) fail('COLLECTION_PRODUCT', `${missing} is not a product in this shop.`, 400); if (new Set(out).size !== out.length) fail('INPUT', 'List each product once.', 400); return out }
  value = p.pins.map((input: unknown): Pin => {
   const entry = strictObject(input, ['query', 'pinned', 'boosted'], 'Pinned search'), query = terms(text(entry.query, 'Search query', 80))
   if (!query || seen.has(query)) fail('INPUT', 'Each search query appears once.', 400)
   seen.add(query)
   const pinned = skus(entry.pinned ?? [], 'Pinned', 10), boosted = skus(entry.boosted ?? [], 'Boosted', 20)
   if (!pinned.length && !boosted.length) fail('INPUT', 'Pin or boost at least one product for each query.', 400)
   return { query, pinned, boosted }
  })
 }
 if (p.revision !== (current.revisions[id] ?? undefined)) fail('CHANGED', 'Refresh the shop before saving this change.')
 const revision = crypto.randomUUID(), prior = current.revisions[id]
 const write = prior ? env.DB.prepare('UPDATE st_search_config SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value), revision, id, prior) : env.DB.prepare('INSERT INTO st_search_config VALUES(?,?,?)').bind(id, JSON.stringify(value), revision)
 await commit(env.DB, actor, [write, ...(prior ? [changed(env.DB)] : []), audit(env.DB, actor, id, type)])
 return { id, value, revision }
}
