import type { ProductValue } from './model'
import { sellables } from './listing'
import { handleOf } from './listing-checks'

/** The shopper's view of one live listing: its stocked variants plus the product facts the page shows. */
export function listingEntries(value: Omit<ProductValue, 'draft'>, stock: (sku: string) => { itemId: string; available: string } | null) {
 const details = value.details
 const items = sellables(value).flatMap(entry => {
  const held = stock(entry.sku)
  if (!held) return []
  return [{ sku: entry.sku, productSku: value.sku, name: entry.label ? `${value.name} — ${entry.label}` : value.name, description: value.description,
   ...(details?.customFields ? { customFields: details.customFields } : {}), unitCents: entry.unitCents, ...(entry.compareAtCents ? { compareAtCents: entry.compareAtCents } : {}),
   ...(entry.variant ? { variant: { label: entry.label!, options: entry.variant.options, ...(entry.variant.mediaId ? { mediaId: entry.variant.mediaId } : {}) } } : {}),
   ...(details?.personalization ? { personalization: details.personalization } : {}), ...held }]
 })
 const media = details?.media?.map(item => ({ ...item, url: `/api/stall/media/${item.id}` }))
 const product = { sku: value.sku, handle: handleOf(value), name: value.name, description: value.description, ...(details?.customFields ? { customFields: details.customFields } : {}),
  ...(details?.categories ? { categories: details.categories } : {}), ...(details?.tags ? { tags: details.tags } : {}), ...(details?.attributes ? { attributes: details.attributes } : {}),
  ...(media ? { media } : {}), ...(details?.options ? { options: details.options } : {}), ...(details?.personalization ? { personalization: details.personalization } : {}), skus: items.map(item => item.sku) }
 return { items, product }
}
