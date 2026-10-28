import { Buffer } from 'node:buffer'
import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256, type SourceBundle } from '../../modules/import-kit/src/d1/index'
import { configuration } from '../tax/configuration'
import { productDetails } from '../product-details'
import { collectionValue } from '../collections'
import { strictObject } from '../facts'
import { importError, stableId, validateProductValue } from './validation'
import type { Actor, ProductValue } from '../model'

export const isCatalog = (kind: string) => kind.startsWith('stall-catalog-')
export function catalogProduct(input: unknown): ProductValue & { stockMode: 'pier' } {
 const value = strictObject(input, ['sku', 'name', 'description', 'unitCents', 'active', 'details', 'stockMode', 'publishAt', 'archived'], 'Catalog product')
 if (value.stockMode !== 'pier') importError('IMPORT_STOCK_MODE', 'Only the existing Pier-tracked stock mode is supported. Quantity adjustments use the stock authority, not this file.')
 if (typeof value.active !== 'boolean' || (value.archived !== undefined && typeof value.archived !== 'boolean')) importError('PRODUCT_PUBLICATION', 'Active and archived must be booleans.')
 const base = validateProductValue({ sku: value.sku, name: value.name, description: value.description, unitCents: value.unitCents, active: false }, true)
 let publishAt: string | undefined
 if (value.publishAt !== undefined) {
  if (typeof value.publishAt !== 'string' || !Number.isFinite(Date.parse(value.publishAt))) importError('PRODUCT_PUBLICATION', 'Publication needs a valid date and time.')
  publishAt = new Date(value.publishAt).toISOString()
 }
 if ((value.archived && (value.active || publishAt)) || (publishAt && !value.active)) importError('PRODUCT_PUBLICATION', 'An archived product cannot be active or scheduled; a schedule needs an active product.')
 return { ...base, active: value.active, stockMode: 'pier', ...(value.details !== undefined ? { details: productDetails(value.details) } : {}), ...(publishAt ? { publishAt } : {}), ...(value.archived ? { archived: true } : {}) }
}
export function catalogSource(csv: string, namespace: string, rows: { cells: string[]; row: number }[]): SourceBundle {
 const hash = sha256(csv), artifact = 'stall-catalog.csv', seen = new Set<string>()
 if (!rows.length) importError('CSV_EMPTY', 'Supply at least one catalog row.')
 const records = rows.map(({ cells, row }) => {
  if (cells.length !== 3) importError('CSV_COLUMNS', `CSV row ${row} must have three columns.`)
  const [kind, id, raw] = cells
  if (!['product', 'collection', 'tax-settings'].includes(kind)) importError('CSV_KIND', 'Record Type must be product, collection or tax-settings.')
  stableId(id)
  if (seen.has(`${kind}:${id}`)) importError('CSV_IDENTITY', 'List each catalog identity once.')
  seen.add(`${kind}:${id}`)
  try {
   const value = JSON.parse(raw)
   if ((kind === 'product' ? value.sku : kind === 'collection' ? value.handle : 'shop') !== id) importError('PRODUCT_ID', 'The value identity must match ID.')
   const payload = kind === 'product' ? catalogProduct(value) : kind === 'tax-settings' ? configuration(value) : value
   // Validate collection shape here; reference checks use the complete reviewed catalog.
   if (kind === 'collection') collectionValue(value, new Set(Array.isArray(value.skus) ? value.skus : []))
   return { namespace, kind: `stall-catalog-${kind}`, sourceId: id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: hash, location: { artifact, row } }
  } catch (error) {
   const payload = { rejection: error instanceof Error ? error.message : 'Invalid catalog value.', fields: cells }
   return { namespace, kind: 'shopify-product-rejected', sourceId: `csv-row-${row}`, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: hash, location: { artifact, row } }
  }
 })
 return { records: records as SourceBundle['records'], diagnostics: [{ severity: 'warning', code: 'IMPORT_CATALOG', message: 'Review complete product and collection replacements, including publication. Only Pier-tracked stock is supported. Tax and customs facts are not provider verified.' }], artifacts: [{ name: artifact, sha256: hash, size: Buffer.byteLength(csv), original: { status: 'available', base64: Buffer.from(csv).toString('base64') } }] }
}

// Bind server-issued review time to the source, actor and installation. It is
// approval metadata, never a substitute for fresh native authority on apply.
async function mac(env: Bindings, body: string) {
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
 return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64url')
}
export async function catalogReview(env: Bindings, actor: Actor, csv: string, namespace: string | undefined, token?: string) {
 const at = token ? token.split('.')[0] : Buffer.from(new Date().toISOString()).toString('base64url')
 const body = canonicalJson([at, actor.id, actor.version, actor.scopeRevision ?? '', sha256(csv), namespace ?? 'shopify-products'])
 const signature = await mac(env, body), expected = `${at}.${signature}`
 if (token && (token !== expected || !Number.isFinite(Date.parse(Buffer.from(at, 'base64url').toString())))) importError('IMPORT_APPROVAL', 'Review this catalog again with the current credential.')
 return { token: expected, at: Buffer.from(at, 'base64url').toString() }
}
