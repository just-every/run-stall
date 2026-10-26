import { fail, type Order, type Product } from '../model'
import { sellables } from '../listing'
import { proposalSources } from '../proposals/sources'
import type { Source } from '../proposals/model'
import { hourStart, measure, unitCost } from './measure'
import { productViews } from './views'
import type { Metrics } from './model'

export const day = 86400000
export const stamp = (at: number) => new Date(at).toISOString()
export const usd = (cents: number) => (cents / 100).toFixed(2)

/** The measured window before `at`: whole UTC hours, so views and orders share one boundary. */
export async function baselineAt(db: D1Database, product: Product, orders: Order[], at: number, days: number) {
  const to = hourStart(at), from = stamp(Date.parse(to) - days * day)
  return measure({ sku: product.id, value: product.value, orders, views: await productViews(db, product.id, from, to), from, to })
}
export function metricSources(metrics: Metrics, missingCost: string[], product: Product, days: number) {
  const sources: Source[] = [], add = (id: string, label: string, value: string) => sources.push({ id: `metric:${id}`, label, value, kind: 'metric' })
  add('window', `Measured window (${days} days)`, `${metrics.from} to ${metrics.to}`)
  add('views', 'Product page views counted in the window', String(metrics.views))
  add('orders', 'Paid online orders containing this product', String(metrics.orders))
  add('units', 'Units sold', String(metrics.units))
  add('revenue', 'Gross product revenue in USD', usd(metrics.revenueCents))
  add('refunds', 'Refunded product value in USD', usd(metrics.refundedCents))
  if (metrics.conversion !== null) add('conversion', 'Orders per product page view', String(metrics.conversion))
  if (metrics.costCents !== null) { add('cost', 'Recorded unit cost of units sold in USD', usd(metrics.costCents)); add('margin', 'Contribution margin after refunds in USD', usd(metrics.marginCents!)) }
  const unknowns: string[] = []
  if (missingCost.length) unknowns.push(`Unit cost is missing for ${missingCost.join(', ')}; margin is unknown until it is recorded.`)
  const items = sellables(product.value), unpriced = items.filter(item => unitCost(product.value, item.sku) === undefined)
  if (unpriced.length && !missingCost.length) unknowns.push(`Unit cost is missing for ${unpriced.map(item => item.sku).join(', ')}; a margin forecast needs it.`)
  if (!metrics.views) unknowns.push('No product page views were counted in this window, so conversion is unknown.')
  if (metrics.limitedViews) unknowns.push(`${metrics.limitedViews} views sent a Global Privacy Control or Do Not Track signal and are excluded from conversion.`)
  unknowns.push('Payment processing fees and shipping cost are not recorded here; margin excludes them. Refunded goods are assumed not resalable.')
  return { sources, unknowns }
}
export async function experimentSources(db: D1Database, orders: Order[], sku: string, days: number, at = Date.now()) {
  const source = await proposalSources(db, sku)
  if (!Number.isInteger(days) || days < 1 || days > 28) fail('INPUT', 'Measure between 1 and 28 days.', 400)
  const baseline = await baselineAt(db, source.product, orders, at, days), metric = metricSources(baseline.metrics, baseline.missingCost, source.product, days)
  return { product: source.product, productSources: source.sources, sources: [...metric.sources, ...source.sources], unknowns: metric.unknowns, metrics: baseline.metrics }
}
