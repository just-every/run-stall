import { Buffer } from 'node:buffer'
import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256, planD1Import, createD1ImportJob, applyD1ImportBatches, resumeD1Import,
 type D1Database, type D1ImportContext, type ImportPlan, type Json, type SourceBundle } from '../../modules/import-kit/src/d1/index'
import { stored } from '../../modules/import-kit/src/d1/jobs'
import { audit, commit } from '../access'
import type { Actor, ProductValue } from '../model'
import { strictObject } from '../facts'
import { collectionValue } from '../collections'
import { checkListing, liveSkus } from '../listing-checks'
import { pierState } from '../pier'
import { parseCSV, productImportDestination } from './csv'
import { authorizeProductImport, importAuthority, productImportPrincipal } from './context'
import { importError, stableId, validateProductValue } from './validation'
import { catalogTargets } from './native-targets'

export const catalogMapping = 'stall-catalog-v1'
export type CatalogInput = { csv: string; namespace?: string; fingerprint?: string; excludedRows?: number[]; reviewedAt?: string }
export const nativeCatalogFile = (csv: unknown) => typeof csv === 'string' &&
 /^(?:\uFEFF)?(?:"Kind"|Kind),(?:"ID"|ID),(?:"Value"|Value)(?:\r\n|\r|\n|$)/.test(csv)

export function catalogContext(db: D1Database, actor: Actor, namespace: string, reversing = false): D1ImportContext {
 return { destination: productImportDestination, namespace, mappingVersion: catalogMapping, reversalPolicy: 'preserve-conflicts',
  batchSize: 10, maxBatches: 1, storage: { database: db, targets: catalogTargets(reversing) },
  authorization: { principalId: productImportPrincipal, predicate: action => importAuthority(actor, !['read', 'plan'].includes(action)) } }
}
export function catalogProduct(input: unknown, id: string): Omit<ProductValue, 'draft' | 'approval'> {
 const p = strictObject(input, ['sku', 'name', 'description', 'unitCents', 'details', 'publication', 'publishAt', 'stockMode'], 'Catalog product')
 if (p.sku !== id) importError('CATALOG_SKU', 'The product SKU must match its row ID.')
 if (p.stockMode !== 'pier') importError('CATALOG_STOCK', 'Only Pier-tracked stock is available. Quantity changes belong to the stock authority.')
 const plain = validateProductValue({ sku: id, name: p.name, description: p.description, unitCents: p.unitCents, active: false, ...(p.details === undefined ? {} : { details: p.details }) }, true)
 if (!['draft', 'published', 'scheduled', 'archived'].includes(p.publication as string)) importError('CATALOG_PUBLICATION', 'Choose draft, published, scheduled or archived.')
 const active = p.publication === 'published' || p.publication === 'scheduled'
 if (p.publication === 'scheduled' && (typeof p.publishAt !== 'string' || !Number.isFinite(Date.parse(p.publishAt)))) importError('CATALOG_PUBLICATION', 'A scheduled product needs a valid publish time.')
 if (p.publication !== 'scheduled' && p.publishAt !== undefined) importError('CATALOG_PUBLICATION', 'Only scheduled products carry a publish time.')
 return { ...plain, active, ...(p.publication === 'archived' ? { archived: true as const } : {}), ...(p.publication === 'scheduled' ? { publishAt: new Date(p.publishAt as string).toISOString() } : {}) }
}
function source(input: CatalogInput): SourceBundle {
 const { csv } = input, namespace = stableId(input.namespace ?? 'stall-catalog', 'namespace')
 if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 256 * 1024 || Buffer.from(csv).toString('utf8') !== csv) importError('CSV_SIZE', 'Use a UTF-8 catalog file of at most 256 KiB.')
 const rows = parseCSV(csv, true), header = rows.shift()?.cells
 if (canonicalJson(header) !== canonicalJson(['Kind', 'ID', 'Value']) || !rows.length) importError('CSV_HEADERS', 'Use Kind,ID,Value with at least one record.')
 const hash = sha256(csv), artifact = 'stall-catalog.csv', seen = new Set<string>()
 const records = rows.map(({ cells, row }) => {
  if (cells.length !== 3) importError('CSV_COLUMNS', `CSV row ${row} must have three columns.`)
  const [kind, id, raw] = cells
  if (!['product', 'collection'].includes(kind)) importError('CATALOG_KIND', 'Each row is a product or collection.')
  stableId(id)
  const sourceId = `${kind}:${id}`
  if (seen.has(sourceId)) importError('CATALOG_DUPLICATE', 'List each product or collection once.')
  seen.add(sourceId)
  let payload: Json
  try { payload = { kind, id, value: JSON.parse(raw) } }
  catch { payload = { rejection: 'Value must be a JSON object.', kind, id } }
  return { namespace, kind: catalogMapping, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: hash, location: { artifact, row } }
 })
 return { records, diagnostics: [{ severity: 'warning', code: 'CATALOG_REPLACEMENT', message: 'Native catalog rows replace complete records, including prepared revisions. Publication is approved by this exact apply after current Pier validation. Tax and customs fields are merchant facts, not provider verification. Only Pier-tracked stock is supported; no quantities change.' }],
  artifacts: [{ name: artifact, sha256: hash, size: Buffer.byteLength(csv), original: { status: 'available', base64: Buffer.from(csv).toString('base64') } }] }
}
async function validatePlan(env: Bindings, plan: ImportPlan) {
 const native = await catalogTargets().list(env.DB, productImportDestination)
 const pending = plan.entries.flatMap(e => e.effects)
 const products = native.filter(row => row.targetKind === 'product').map(row => ({ id: row.targetId, value: row.value as unknown as ProductValue, revision: row.revision }))
 const combined = products.filter(p => !pending.some(e => e.targetKind === 'product' && e.targetId === p.id))
 for (const effect of pending.filter(e => e.targetKind === 'product')) combined.push({ id: effect.targetId, value: effect.value as unknown as ProductValue, revision: 'reviewed' })
 let stock: any
 for (const effect of pending) {
  if (effect.targetKind === 'product') {
   const product = effect.value as unknown as ProductValue
   await checkListing(env.DB, product, combined)
   if (product.active) {
    stock ??= await pierState(env)
    const needed = liveSkus(product)
    if (!needed.length || needed.some(sku => !stock.items?.some((item: any) => item.sku === sku && !item.archived))) importError('CATALOG_STOCK', `${effect.targetId}: every live variant must be active in Pier before publication.`)
   }
  } else collectionValue(effect.value, new Set(combined.map(p => p.id)))
 }
}

async function prepare(env: Bindings, actor: Actor, input: CatalogInput) {
 await authorizeProductImport(env.DB, actor)
 const bundle = source(input)
 const namespace = `${catalogMapping}:${bundle.records[0].namespace}:${bundle.artifacts[0].sha256}`
 const context = catalogContext(env.DB, actor, namespace)
 const native = await context.storage.targets.list(env.DB, productImportDestination)
 const known = new Set([...native.filter(p => p.targetKind === 'product').map(p => p.targetId),
  ...bundle.records.filter(r => (r.payload as any).kind === 'product').map(r => (r.payload as any).id)])
 const reviewedAt = input.reviewedAt ?? new Date().toISOString()
 if (!Number.isFinite(Date.parse(reviewedAt)) || new Date(reviewedAt).toISOString() !== reviewedAt) importError('CATALOG_REVIEW', 'Use the time returned by the dry run.')
 const scope = sha256(canonicalJson(native))
 for (const record of bundle.records) {
  record.namespace = namespace
  const payload = record.payload as any
  const previous = native.find(p => p.targetKind === payload.kind && p.targetId === payload.id) ?? null
  try {
   if (payload.rejection) throw new Error(payload.rejection)
   let value: unknown
   if (payload.kind === 'product') {
    const product = catalogProduct(payload.value, payload.id)
    value = { ...product, ...(product.active || product.archived ? { approval: { by: actor.id, version: actor.version, ...(actor.scopeRevision ? { scopeRevision: actor.scopeRevision } : {}), at: reviewedAt, revision: previous?.revision ?? 'new-catalog-record' } } : {}) }
   } else {
    strictObject(payload.value, ['handle', 'title', 'description', 'kind', 'published', 'skus', 'match', 'rules', 'sort'], 'Catalog collection')
    if (payload.value.handle !== payload.id) importError('CATALOG_COLLECTION', 'The collection handle must match its row ID.')
    value = collectionValue(payload.value, known)
   }
   record.payload = { kind: payload.kind, id: payload.id, value: value as Json, previous: previous as unknown as Json, scope }
  } catch (error) {
   record.payload = { kind: payload.kind, id: payload.id, rejection: error instanceof Error ? error.message : 'Invalid record.', previous: previous as unknown as Json, scope }
  }
  record.payloadHash = sha256(canonicalJson(record.payload))
 }
 const plan = await planD1Import(bundle, { version: catalogMapping, map(record) {
  const p = record.payload as any
  return p.rejection ? { effects: [], rejection: p.rejection } : { effects: [{ targetKind: p.kind, targetId: p.id, value: p.value, ...(p.previous ? { expectedRevision: p.previous.revision } : {}) }] }
 } }, context)
 await validatePlan(env, plan)
 return { plan, context, reviewedAt }
}
export async function previewCatalog(env: Bindings, actor: Actor, input: CatalogInput) {
 const { plan, reviewedAt } = await prepare(env, actor, { ...input, reviewedAt: undefined })
 return { plan, reviewedAt, fingerprint: plan.fingerprint, counts: plan.counts, diagnostics: plan.diagnostics }
}
export async function applyCatalog(env: Bindings, actor: Actor, input: CatalogInput) {
 await authorizeProductImport(env.DB, actor, true)
 if (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint)) importError('IMPORT_APPROVAL', 'Supply the exact reviewed fingerprint.')
 const operationKey = `stall-product-import:${input.fingerprint}`
 const prior = await env.DB.prepare('SELECT id,namespace,checkpoint,state FROM ik_jobs WHERE destination=? AND principal_id=? AND operation_key=? AND mapping_version=?').bind(productImportDestination, productImportPrincipal, operationKey, catalogMapping).first<{ id: string; namespace: string; checkpoint: number; state: string }>()
 const bundle = source(input), namespace = `${catalogMapping}:${bundle.records[0].namespace}:${bundle.artifacts[0].sha256}`
 const context = catalogContext(env.DB, actor, namespace)
 context.operationKey = operationKey
 context.reviewedFingerprint = input.fingerprint
 let plan: ImportPlan
 if (prior) {
  if (prior.namespace !== namespace) importError('IMPORT_REVIEW_CHANGED', 'Resume using the exact original source and namespace.')
  plan = (await stored(prior.id, context, 'apply')).plan
 } else {
  if (!input.reviewedAt) importError('CATALOG_REVIEW', 'Supply the time returned by the dry run.')
  plan = (await prepare(env, actor, input)).plan
  if (plan.fingerprint !== input.fingerprint) importError('IMPORT_REVIEW_CHANGED', 'The source or catalog changed. Review a fresh dry run.')
 }
 const rejected = plan.entries.filter(e => e.rejection).map(e => e.source.location.row!).sort((a, b) => a - b)
 if (!Array.isArray(input.excludedRows ?? []) || canonicalJson([...(input.excludedRows ?? [])].sort((a, b) => a - b)) !== canonicalJson(rejected) || !plan.counts.mapped) importError('IMPORT_EXCLUSIONS', 'Exclude exactly the rejected rows shown in the dry run.')
 if (plan.diagnostics.some(d => d.severity === 'error' && d.code !== 'REJECTED')) importError('IMPORT_DIAGNOSTICS', 'Resolve catalog conflicts before applying.')
 await validatePlan(env, plan)
 context.storage.targets = catalogTargets(false, { plan, jobId: prior?.id })
 let job
 if (prior) job = await resumeD1Import(prior.id, context)
 else {
  job = await createD1ImportJob(plan, context)
  context.storage.targets = catalogTargets(false, { plan, jobId: job.id })
  job = await applyD1ImportBatches(job.id, context)
 }
 if (!prior || prior.checkpoint !== job.checkpoint || prior.state !== job.state) await commit(env.DB, actor, [audit(env.DB, actor, job.id, 'catalog.applied')])
 return job
}
export async function exportCatalog(db: D1Database) {
 const rows = await catalogTargets().list(db, productImportDestination)
 const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
 const output = rows.map(row => {
  const p = row.value as unknown as ProductValue
  const value = row.targetKind === 'product' ? { sku: p.sku, name: p.name, description: p.description, unitCents: p.unitCents, stockMode: 'pier',
   publication: p.archived ? 'archived' : p.active && p.approval ? p.publishAt ? 'scheduled' : 'published' : 'draft', ...(p.publishAt ? { publishAt: p.publishAt } : {}), ...(p.details ? { details: p.details } : {}) } : row.value
  return [row.targetKind, row.targetId, JSON.stringify(value)].map(cell).join(',')
 })
 return new Response('Kind,ID,Value\n' + output.join('\n') + '\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="stall-catalog.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
