import { canonicalJson, sha256, type D1TargetAdapter, type D1Sql, type TargetRow, type ImportPlan, type D1UndoSnapshot } from '../../modules/import-kit/src/d1/index'
import { configuration } from '../tax/configuration'
import { catalogProduct, isCatalog } from './catalog'
import { importError } from './validation'
import { productImportDestination } from './csv'
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
const table = (kind: string) => kind === 'product' ? 'st_products' : kind === 'collection' ? 'st_collections' : kind === 'tax-settings' ? 'st_tax_configuration' : importError('IMPORT_SCOPE', 'Unsupported catalog record.')
const scope = (destination: string, kind: string) => { if (destination !== productImportDestination) importError('IMPORT_SCOPE', 'Unsupported destination.'); return table(kind) }
const decode = (row: any, kind: string): TargetRow => ({ destination: productImportDestination, targetKind: kind, targetId: kind === 'tax-settings' ? 'shop' : row.id, revision: row.revision, value: JSON.parse(row.value_json) })
const richValue = (row: TargetRow | null) => (row?.value as any)?.stockMode === 'pier'
const orderEdges = `SELECT json_group_array(json_array(id,revision,value_json)) FROM (SELECT id,revision,value_json FROM st_orders ORDER BY id)`
export function catalogTargets(legacy: D1TargetAdapter, reversing: boolean, review?: { plan: ImportPlan; jobId: string }): D1TargetAdapter {
 const rich = new Set(review?.plan.entries.filter(e => isCatalog(e.source.kind)).flatMap(e => e.effects.map(effect => `${effect.targetKind}:${effect.targetId}`)))
 const prior = new Map(review?.plan.entries.filter(e => isCatalog(e.source.kind)).map(e => [`${e.effects[0]?.targetKind}:${e.effects[0]?.targetId}`, (e.source.payload as any).previous]))
 const adapter: D1TargetAdapter = {
  ...legacy,
  async read(db, destination, kind, id) {
   scope(destination, kind)
   if (kind === 'product') return legacy.read(db, destination, kind, id)
   const raw = await db.prepare(`SELECT id,value_json,revision FROM ${table(kind)} WHERE id=?`).bind(kind === 'tax-settings' ? 1 : id).first()
   const row = raw ? decode(raw, kind) : undefined, before = prior.get(`${kind}:${id}`)
   if (review && prior.has(`${kind}:${id}`) && canonicalJson(row ?? null) !== canonicalJson(before)) {
    const p = await db.prepare('SELECT record_json FROM ik_provenance WHERE job_id=? AND target_kind=? AND target_id=? AND reversed=0').bind(review.jobId, kind, id).first<{ record_json: string }>()
    const owned = p ? JSON.parse(p.record_json) : null
    if (!row || owned?.appliedRevision !== row.revision || owned?.valueHash !== sha256(canonicalJson(row.value))) importError('IMPORT_REVIEW_CHANGED', 'A collection changed after review. Create a fresh dry run.')
   }
   return row
  },
  matches(row, destination, kind, id) {
   const name = scope(destination, kind)
   if (kind === 'tax-settings') id = '1'
   if (kind === 'product' && !rich.has(`${kind}:${id}`) && !richValue(row)) return legacy.matches(row, destination, kind, id)
   return row ? sql(`EXISTS(SELECT 1 FROM ${name} WHERE id=? AND revision=? AND json(value_json)=json(?))`, id, row.revision, JSON.stringify(row.value)) : sql(`NOT EXISTS(SELECT 1 FROM ${name} WHERE id=?)`, id)
  },
  write(row) {
   const name = scope(row.destination, row.targetKind)
   if (row.targetKind === 'product' && !richValue(row)) return legacy.write(row)
   if (!reversing && row.targetKind === 'product') { const { approval, ...value } = row.value as any; catalogProduct(value) }
   if (!reversing && row.targetKind === 'tax-settings') configuration(row.value)
   return [sql(`INSERT INTO ${name}(id,value_json,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision`, row.targetKind === 'tax-settings' ? 1 : row.targetId, JSON.stringify(row.value), row.revision), sql("INSERT INTO st_audit VALUES(?,?,?,?,?)", crypto.randomUUID(), row.targetId, 'catalog-import', reversing ? 'catalog.reversed' : 'catalog.applied', new Date().toISOString())]
  },
  remove(destination, kind, id) { const name = scope(destination, kind); return [sql(`DELETE FROM ${name} WHERE id=?`, kind === 'tax-settings' ? 1 : id)] },
  async list(db, destination) {
   const products = await legacy.list(db, destination)
   const rows = (await db.prepare('SELECT id,value_json,revision FROM st_collections ORDER BY id').all()).results
   const tax = await db.prepare('SELECT id,value_json,revision FROM st_tax_configuration WHERE id=1').first()
   return [...products, ...rows.map(row => decode(row, 'collection')), ...(tax ? [decode(tax, 'tax-settings')] : [])]
  },
  matchesCount(count, destination) { scope(destination, 'product'); return sql('(SELECT (SELECT COUNT(*) FROM st_products)+(SELECT COUNT(*) FROM st_collections)+(SELECT COUNT(*) FROM st_tax_configuration))=?', count) },
  async preparePreservedUndo(db, destination, effects): Promise<D1UndoSnapshot> {
   const oldEffects = effects.filter(effect => effect.expected.targetKind === 'product' && !richValue(effect.expected))
   const old = oldEffects.length ? await legacy.preparePreservedUndo!(db, destination, oldEffects) : { observations: [], dependencies: [], guards: [] }
   // Read a complete, ordered reference snapshot so a newly arriving order is fenced too.
   const snapshot = await db.prepare(`SELECT (${orderEdges}) AS edges`).first<{ edges: string }>()
   const orders = JSON.parse(snapshot?.edges ?? '[]') as [string, string, string][]
   const collectionRows = (await db.prepare('SELECT id,value_json,revision FROM st_collections ORDER BY id').all<{ id: string; value_json: string; revision: string }>()).results
   const collectionSnapshot = JSON.stringify(collectionRows.map(row => [row.id,row.revision,row.value_json]))
   for (const effect of effects.filter(effect => !oldEffects.includes(effect))) {
    const expected = effect.expected, name = scope(destination, expected.targetKind)
    const raw = await db.prepare(`SELECT id,value_json,revision FROM ${name} WHERE id=?`).bind(expected.targetKind === 'tax-settings' ? 1 : expected.targetId).first()
    old.observations.push({ effectId: effect.provenance.id, current: raw ? decode(raw, expected.targetKind) : null, entity: { table: name, recordId: expected.targetId, targetId: expected.targetId }, evidence: { rule: 'The complete native value and revision must still belong to this reviewed catalog effect.' } })
    if (expected.targetKind === 'product') for (const collection of collectionRows) {
     if (JSON.parse(collection.value_json).skus?.includes(expected.targetId)) {
      const dependent = effects.find(effect => effect.expected.targetKind === 'collection' && effect.expected.targetId === collection.id)
      old.dependencies.push({ requiredEffectId: effect.provenance.id, ...(dependent ? { dependentEffectId: dependent.provenance.id } : {}), cause: { table: 'st_collections', recordId: collection.id, field: 'skus', targetId: expected.targetId }, evidence: { rule: 'A retained manual collection keeps its referenced product.', collectionId: collection.id } })
     }
    }
    if (expected.targetKind === 'tax-settings') for (const [id, , raw] of orders) {
     if (JSON.parse(raw).tax?.configRevision === expected.revision) old.dependencies.push({ requiredEffectId: effect.provenance.id, cause: { table: 'st_orders', recordId: id, field: 'tax.configRevision', targetId: expected.targetId }, evidence: { rule: 'An order keeps its original reviewed tax configuration.', orderId: id } })
    }
    if (expected.targetKind === 'product') for (const [id, , value] of orders) {
     const order = JSON.parse(value)
     for (const [line, item] of (order.lines ?? []).entries()) if ((item.productSku ?? item.sku) === expected.targetId || (expected.value as any).details?.variants?.some((v: any) => v.sku === item.sku)) old.dependencies.push({ requiredEffectId: effect.provenance.id, cause: { table: 'st_orders', recordId: id, field: `lines[${line}]`, targetId: expected.targetId }, evidence: { rule: 'A purchased product or variant keeps its catalog reference.', orderId: id, sku: item.sku } })
    }
   }
   old.guards.push(sql(`(${orderEdges})=?`, snapshot?.edges ?? '[]'), sql('(SELECT json_group_array(json_array(id,revision,value_json)) FROM (SELECT id,value_json,revision FROM st_collections ORDER BY id))=?', collectionSnapshot))
   return old
  },
 }
 return adapter
}
