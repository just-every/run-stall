import { fail, type Product, type ProductValue } from './model'
import { sellables } from './listing'

export const handleOf = (value: { sku: string; details?: { handle?: string } }) => value.details?.handle ?? (value.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product')
const claims = (value: Omit<ProductValue, 'draft'>) => ({ skus: [value.sku, ...(value.details?.variants?.map(variant => variant.sku) ?? [])], handle: handleOf(value) })

/** A draft may not take another product's SKU or handle, or promote a compare-at price at or below the price. */
export async function checkListing(db: D1Database, draft: Omit<ProductValue, 'draft'>, all: Product[]) {
 const own = claims(draft)
 for (const other of all.filter(product => product.id !== draft.sku)) {
  for (const value of [other.value, ...(other.value.draft ? [other.value.draft] : [])]) {
   const theirs = claims(value)
   if (own.skus.some(sku => theirs.skus.includes(sku))) fail('LISTING_SKU', `A SKU in this product is already used by ${other.id}.`, 409)
   if (own.handle === theirs.handle) fail('LISTING_HANDLE', `The handle ${own.handle} is already used by ${other.id}.`, 409)
  }
 }
 const details = draft.details
 if (details?.compareAtCents !== undefined && details.compareAtCents <= draft.unitCents) fail('LISTING_PRICE', 'The compare-at price must be higher than the price.', 400)
 for (const variant of details?.variants ?? []) {
  const price = variant.unitCents ?? draft.unitCents, compare = variant.compareAtCents ?? details?.compareAtCents
  if (compare !== undefined && compare <= price) fail('LISTING_PRICE', `Variant ${variant.sku}: the compare-at price must be higher than its price.`, 400)
 }
 if (draft.archived && (draft.active || draft.publishAt)) fail('LISTING_STATE', 'An archived product is neither active nor scheduled.', 400)
 if (draft.publishAt && (!draft.active || !Number.isFinite(Date.parse(draft.publishAt)))) fail('LISTING_STATE', 'Schedule needs an active product and a valid date and time.', 400)
 const media = details?.media?.map(item => item.id) ?? []
 if (media.length) {
  const found = (await db.prepare('SELECT id FROM st_media WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(media)).all<{ id: string }>()).results.map(row => row.id)
  if (media.some(id => !found.includes(id))) fail('LISTING_MEDIA', 'Upload each image or video again: one of this product’s media files is missing.', 409)
 }
}
export const liveSkus = (value: Omit<ProductValue, 'draft'>) => sellables(value).map(entry => entry.sku)
