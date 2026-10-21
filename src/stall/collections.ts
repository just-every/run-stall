import type { Bindings } from '../auth.server'
import { audit, changed, commit } from './access'
import { fail, integer, requirePerson, text, type Actor } from './model'
import { strictObject } from './facts'

export type Rule = { field: 'category' | 'tag' | 'title'; value: string } | { field: 'attribute'; name: string; value: string } | { field: 'price_min' | 'price_max'; cents: number }
export type Collection = { handle: string; title: string; description: string; kind: 'manual' | 'rule'; published: boolean; skus?: string[]; match?: 'all' | 'any'; rules?: Rule[]; sort?: 'manual' | 'name' | 'price-asc' | 'price-desc' | 'newest' }
export type StoredCollection = { id: string; value: Collection; revision: string }
export async function collections(db: D1Database): Promise<StoredCollection[]> {
 return (await db.prepare('SELECT * FROM st_collections ORDER BY id').all<any>()).results.map(row => ({ id: row.id, value: JSON.parse(row.value_json), revision: row.revision }))
}
export const handleName = (value: unknown, name = 'Handle') => { const handle = text(value, name, 80); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) fail('INPUT', `${name} uses lowercase letters, digits and single hyphens.`, 400); return handle }
function rule(input: unknown): Rule {
 const entry = strictObject(input, ['field', 'name', 'value', 'cents'], 'Collection rule')
 if (entry.field === 'category' || entry.field === 'tag' || entry.field === 'title') return { field: entry.field, value: text(entry.value, 'Rule value', 100) }
 if (entry.field === 'attribute') return { field: 'attribute', name: text(entry.name, 'Attribute name', 60), value: text(entry.value, 'Rule value', 120) }
 if (entry.field === 'price_min' || entry.field === 'price_max') return { field: entry.field, cents: integer(entry.cents, 'Price in cents', 0) }
 return fail('INPUT', 'A rule matches a category, tag, title, attribute or price limit.', 400)
}
export async function collectionCommand(env: Bindings, actor: Actor, type: string, p: any) {
 requirePerson(actor)
 const handle = handleName(p.handle), prior = (await collections(env.DB)).find(entry => entry.id === handle)
 if (type === 'collection.delete') {
  if (!prior || p.revision !== prior.revision) fail('CHANGED', 'Refresh this collection before removing it.')
  await commit(env.DB, actor, [env.DB.prepare('DELETE FROM st_collections WHERE id=? AND revision=?').bind(handle, prior.revision), changed(env.DB), audit(env.DB, actor, handle, 'collection.removed')])
  return { removed: handle }
 }
 if (prior ? p.revision !== prior.revision : p.revision !== undefined) fail('CHANGED', 'Refresh this collection before saving it.')
 const kind = p.kind === 'manual' || p.kind === 'rule' ? p.kind : fail('INPUT', 'A collection is manual or rule-based.', 400)
 const value: Collection = { handle, title: text(p.title, 'Title', 120), description: typeof p.description === 'string' && p.description.length <= 1000 ? p.description.trim() : fail('INPUT', 'The description may be at most 1000 characters.', 400), kind, published: p.published !== false }
 if (['manual', 'name', 'price-asc', 'price-desc', 'newest'].includes(p.sort)) value.sort = p.sort
 if (kind === 'manual') {
  if (!Array.isArray(p.skus) || p.skus.length > 500) fail('INPUT', 'A manual collection lists at most 500 products.', 400)
  const skus = p.skus.map((sku: unknown) => text(sku, 'Product SKU', 100))
  if (new Set(skus).size !== skus.length) fail('INPUT', 'List each product once.', 400)
  const known = new Set((await env.DB.prepare('SELECT id FROM st_products').all<{ id: string }>()).results.map(row => row.id))
  const missing = skus.find((sku: string) => !known.has(sku))
  if (missing) fail('COLLECTION_PRODUCT', `${missing} is not a product in this shop.`, 400)
  value.skus = skus
 } else {
  if (!Array.isArray(p.rules) || !p.rules.length || p.rules.length > 10) fail('INPUT', 'A rule-based collection needs between one and ten rules.', 400)
  value.rules = p.rules.map(rule)
  value.match = p.match === 'any' ? 'any' : 'all'
 }
 const revision = crypto.randomUUID()
 const write = prior ? env.DB.prepare('UPDATE st_collections SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value), revision, handle, prior.revision) : env.DB.prepare('INSERT INTO st_collections VALUES(?,?,?)').bind(handle, JSON.stringify(value), revision)
 await commit(env.DB, actor, [write, ...(prior ? [changed(env.DB)] : []), audit(env.DB, actor, handle, prior ? 'collection.saved' : 'collection.created')])
 return { id: handle, value, revision }
}
