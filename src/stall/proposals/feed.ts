import type { Bindings } from '../../auth.server'
import { catalogue, decimal } from '../pier'
import { Problem } from '../model'
import type { Feed } from './model'

/** Availability is an observation from the connected stock authority, never agent copy. */
export async function validateFeedInventory(env: Bindings, feed: Feed): Promise<Feed> {
 try {
  const stock = await catalogue(env), missing: string[] = []
  const items = feed.items.map(item => {
   const current = stock.items.find(entry => entry.sku === item.id)
   if (!current) { missing.push(String(item.id)); return item }
   return { ...item, availability: decimal(current.available) > 0n ? 'in_stock' : 'out_of_stock', inventoryEvidence: { source: 'Pier', observedAt: stock.observedAt, available: current.available } }
  })
  const errors = feed.errors.filter(error => error !== 'Availability needs current connected inventory evidence before channel submission.')
  for (const sku of missing) errors.push(`No current stock evidence for ${sku}. Publish and map the product before preparing its channel draft.`)
  return { ...feed, items, errors, valid: errors.length === 0, warnings: [...feed.warnings, 'Inventory is a timestamped validation observation. Revalidate before any future channel submission.'] }
 } catch (error) {
  if (!(error instanceof Problem)) throw error
  return { ...feed, valid: false, errors: [...feed.errors, `Stock authority validation failed: ${error.code}. No availability was inferred.`] }
 }
}
