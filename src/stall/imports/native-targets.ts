import { canonicalJson, type D1Database, type D1Sql, type D1TargetAdapter, type TargetRow } from '../../modules/import-kit/src/d1/index'
import type { ProductValue } from '../model'
import { productImportDestination } from './csv'
import { importError } from './validation'

const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
function table(destination: string, kind: string) {
 if (destination !== productImportDestination || !['product', 'collection'].includes(kind)) importError('IMPORT_SCOPE', 'Unsupported native catalog record.')
 return kind === 'product' ? 'st_products' : 'st_collections'
}
const decode = (kind: string, row: any): TargetRow => ({ destination: productImportDestination, targetKind: kind, targetId: row.id, value: JSON.parse(row.value_json), revision: row.revision })
const orderEdges = `SELECT json_group_array(json_array(o.id,l.key,json_extract(l.value,'$.sku'),json_extract(l.value,'$.productSku'))) FROM st_orders o,json_each(o.value_json,'$.lines') l ORDER BY o.id,l.key`
const shippingEdges = `SELECT json_group_array(json_array(sku,profile_id)) FROM (SELECT sku,profile_id FROM st_shipping_assignments ORDER BY sku)`
const collectionEdges = `SELECT json_group_array(json_array(id,value_json,revision)) FROM (SELECT id,value_json,revision FROM st_collections ORDER BY id)`

/** Native catalog writes keep exact before-images; undo retains edited records and their dependencies. */
export function catalogTargets(reversing = false): D1TargetAdapter {
 async function read(db: D1Database, destination: string, kind: string, id: string) {
  const row = await db.prepare(`SELECT id,value_json,revision FROM ${table(destination, kind)} WHERE id=?`).bind(id).first()
  const current = row ? decode(kind, row) : undefined
  return current
 }
 return {
  read,
  matches(row, destination, kind, id) {
   const target = table(destination, kind)
   return row ? sql(`EXISTS(SELECT 1 FROM ${target} WHERE id=? AND revision=? AND json(value_json)=json(?))`, id, row.revision, JSON.stringify(row.value))
    : sql(`NOT EXISTS(SELECT 1 FROM ${target} WHERE id=?)`, id)
  },
  write(row) {
   const target = table(row.destination, row.targetKind)
   return [sql(`INSERT INTO ${target}(id,value_json,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision`, row.targetId, JSON.stringify(row.value), row.revision)]
  },
  remove(destination, kind, id) { return [sql(`DELETE FROM ${table(destination, kind)} WHERE id=?`, id)] },
  async list(db, destination) {
   const rows: TargetRow[] = []
   for (const kind of ['product', 'collection']) {
    const found = await db.prepare(`SELECT id,value_json,revision FROM ${table(destination, kind)} ORDER BY id`).all()
    rows.push(...found.results.map(row => decode(kind, row)))
   }
   return rows
  },
  matchesCount(count, destination) { table(destination, 'product'); return sql('(SELECT COUNT(*) FROM st_products)+(SELECT COUNT(*) FROM st_collections)=?', count) },
  ...(reversing ? {
   async preparePreservedUndo(db, destination, effects) {
    const orders = await db.prepare(`SELECT (${orderEdges}) AS edges`).first<{ edges: string }>()
    const collections = await db.prepare(`SELECT (${collectionEdges}) AS edges`).first<{ edges: string }>()
    const shipping = await db.prepare(`SELECT (${shippingEdges}) AS edges`).first<{ edges: string }>()
    if (!orders || !collections || !shipping) throw new Error('IMPORT_UNDO_SNAPSHOT_REQUIRED')
    const edges = JSON.parse(orders.edges) as [string, number, string, string | null][]
    const memberships = JSON.parse(collections.edges) as [string, string, string][]
    const assignments = JSON.parse(shipping.edges) as [string, string][]
    const dependencies: import('../../modules/import-kit/src/d1/undo-types').D1UndoDependency[] = []
    const observations = []
    for (const effect of effects) {
     const { targetKind: kind, targetId: id } = effect.expected, target = table(destination, kind)
     const current = await read(db, destination, kind, id) ?? null
     observations.push({ effectId: effect.provenance.id, current, entity: { table: target, recordId: id, targetId: id }, evidence: { rule: 'The complete native catalog value and revision belong to this effect.' } })
     if (kind !== 'product') continue
     const value = effect.expected.value as unknown as ProductValue
     const skus = new Set([id, ...(value.details?.variants?.map(v => v.sku) ?? [])])
     for (const [orderId, line, sku, productSku] of edges) if (skus.has(sku) || productSku === id) dependencies.push({
      requiredEffectId: effect.provenance.id, cause: { table: 'st_orders', recordId: orderId, field: `lines[${line}]`, targetId: id },
      evidence: { rule: 'Purchased products and variants remain intact.', orderId, sku } })
     const before = effect.provenance.before?.value as unknown as ProductValue | undefined
     const restoredSkus = new Set(before ? [id, ...(before.details?.variants?.map(variant => variant.sku) ?? [])] : [])
     for (const [sku, profile] of assignments) if (skus.has(sku) && !restoredSkus.has(sku)) dependencies.push({
      requiredEffectId: effect.provenance.id, cause: { table: 'st_shipping_assignments', recordId: sku, field: 'profile_id', targetId: id },
      evidence: { rule: 'Keep a product or variant needed by a retained shipping assignment.', sku, profile } })
     for (const [collectionId, raw, revision] of memberships) {
      if (!JSON.parse(raw).skus?.includes(id) || restoredSkus.has(id)) continue
      const dependent = effects.find(e => e.expected.targetKind === 'collection' && e.expected.targetId === collectionId && e.expected.revision === revision && canonicalJson(e.expected.value) === canonicalJson(JSON.parse(raw)))
      dependencies.push({ requiredEffectId: effect.provenance.id, ...(dependent ? { dependentEffectId: dependent.provenance.id } : {}),
       cause: { table: 'st_collections', recordId: collectionId, field: 'skus', targetId: id }, evidence: { rule: 'Keep products while a retained collection references them.', collectionId } })
     }
    }
    return { observations, dependencies, guards: [sql(`(${orderEdges})=?`, orders.edges), sql(`(${collectionEdges})=?`, collections.edges), sql(`(${shippingEdges})=?`, shipping.edges)] }
   },
  } : {}),
 }
}
