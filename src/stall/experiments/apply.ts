import type { ProductValue } from '../model'
import type { ExperimentChange, Snapshot } from './model'

export const snapshot = (value: ProductValue): Snapshot => ({ unitCents: value.unitCents, description: value.description, variants: (value.details?.variants ?? []).map(variant => ({ sku: variant.sku, ...(variant.unitCents !== undefined ? { unitCents: variant.unitCents } : {}) })) })
const adjust = (cents: number, percent: number) => Math.max(1, Math.round(cents * (100 + percent) / 100))

/** The one bounded change an experiment makes. Nothing else on the product is touched. */
export function applyChange(value: ProductValue, change: ExperimentChange): ProductValue {
  const next = structuredClone(value)
  if (change.field === 'description') { next.description = change.value; return next }
  next.unitCents = adjust(next.unitCents, change.percent)
  for (const variant of next.details?.variants ?? []) if (variant.unitCents !== undefined) variant.unitCents = adjust(variant.unitCents, change.percent)
  return next
}
/** True while the fields the experiment changed still hold the experiment's own values. */
export function untouched(current: ProductValue, change: ExperimentChange, after: Snapshot) {
  const now = snapshot(current)
  return change.field === 'description' ? now.description === after.description : now.unitCents === after.unitCents && JSON.stringify(now.variants) === JSON.stringify(after.variants)
}
export function restore(current: ProductValue, change: ExperimentChange, before: Snapshot): ProductValue {
  const next = structuredClone(current)
  if (change.field === 'description') { next.description = before.description; return next }
  next.unitCents = before.unitCents
  for (const variant of next.details?.variants ?? []) {
    const earlier = before.variants.find(entry => entry.sku === variant.sku)
    if (earlier?.unitCents !== undefined) variant.unitCents = earlier.unitCents; else delete variant.unitCents
  }
  return next
}
