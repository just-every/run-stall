import type { Order, ProductValue } from '../model'
import type { Budget, Experiment, Metrics, Outcome, Result } from './model'

const sold = ['paid', 'reserved', 'shipped']
export type ViewRow = { hour: string; views: number; limited: number }
export const hourStart = (at: number) => new Date(Math.floor(at / 3600000) * 3600000).toISOString()
export const hourEnd = (at: number) => new Date(Math.ceil(at / 3600000) * 3600000).toISOString()

export function unitCost(value: ProductValue, sku: string): number | undefined {
  return value.details?.variants?.find(variant => variant.sku === sku)?.costCents ?? value.details?.costCents
}
const ofProduct = (sku: string) => (line: { sku: string; productSku?: string }) => line.productSku === sku || line.sku === sku
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places

/** Orders and counts in [from, to), both on hour boundaries. Only online paid orders count; refunds, cost and discount spend are exact line facts. */
export function measure(input: { sku: string; value: ProductValue; orders: Order[]; views: ViewRow[]; from: string; to: string; priceBefore?: Map<string, number> }): { metrics: Metrics; missingCost: string[] } {
  const { sku, value, from, to } = input, own = ofProduct(sku), missing = new Set<string>()
  let orders = 0, units = 0, revenue = 0, refunded = 0, cost = 0, discount = 0
  for (const order of input.orders) {
    if (!sold.includes(order.status) || order.channel === 'manual') continue
    const at = order.payment?.paidAt ?? order.createdAt
    if (at < from || at >= to) continue
    const lines = order.lines.filter(own)
    if (!lines.length) continue
    orders += 1
    for (const line of lines) {
      units += line.quantity; revenue += line.quantity * line.unitCents
      const unit = unitCost(value, line.sku)
      if (unit === undefined) missing.add(line.sku); else cost += unit * line.quantity
      const before = input.priceBefore?.get(line.sku)
      const base = line.unitCents - (line.addOnCents ?? 0)
      if (before !== undefined && before > base) discount += (before - base) * line.quantity
    }
    for (const refund of order.refunds) {
      if (refund.status !== 'succeeded' || (refund.kind && refund.kind !== 'lines')) continue
      for (const entry of refund.lines) {
        const line = lines.find(item => item.sku === entry.sku)
        if (line) refunded += Math.min(entry.quantity, line.quantity) * line.unitCents
      }
    }
  }
  const window = input.views.filter(row => row.hour >= from.slice(0, 13) && row.hour < to.slice(0, 13))
  const views = window.reduce((sum, row) => sum + row.views, 0), limited = window.reduce((sum, row) => sum + row.limited, 0)
  const net = revenue - refunded, known = missing.size === 0
  const margin = known ? net - cost : null
  return {
    missingCost: [...missing],
    metrics: { from, to, views, limitedViews: limited, orders, units, revenueCents: revenue, refundedCents: refunded, netRevenueCents: net, costCents: known ? cost : null, marginCents: margin, discountSpendCents: discount, conversion: views ? round(orders / views) : null, refundRate: revenue ? round(refunded / revenue) : null, marginPerViewCents: margin !== null && views ? round(margin / views, 2) : null },
  }
}

/** The decision compares conversion with a two-proportion test and contribution margin per page view; thin, uncosted or noisy evidence is reported as inconclusive. */
export function analyze(baseline: Metrics, trial: Metrics, budget: Budget): Result {
  const reasons: string[] = []
  if (baseline.views < budget.minViews || trial.views < budget.minViews) reasons.push(`Page views are below the ${budget.minViews}-view minimum in the baseline or trial window.`)
  if (baseline.orders + trial.orders < budget.minOrders) reasons.push(`Fewer than ${budget.minOrders} orders in both windows combined.`)
  if (baseline.marginCents === null || trial.marginCents === null) reasons.push('Unit cost is missing for a sold item, so margin is unknown.')
  let z = 0, significant = false
  if (baseline.views && trial.views) {
    const p1 = baseline.orders / baseline.views, p2 = trial.orders / trial.views, pooled = (baseline.orders + trial.orders) / (baseline.views + trial.views)
    const error = Math.sqrt(pooled * (1 - pooled) * (1 / baseline.views + 1 / trial.views))
    z = error > 0 ? (p2 - p1) / error : 0
    significant = Math.abs(z) >= 1.96
  }
  if (!reasons.length && !significant) reasons.push('The conversion difference is within normal variation (|z| < 1.96).')
  const lift = baseline.conversion && trial.conversion !== null ? round(((trial.conversion - baseline.conversion) / baseline.conversion) * 100, 2) : null
  const change = baseline.marginPerViewCents !== null && trial.marginPerViewCents !== null ? round(trial.marginPerViewCents - baseline.marginPerViewCents, 2) : null
  const outcome: Outcome = reasons.length ? 'inconclusive' : (change ?? 0) > 0 ? 'profitable' : 'margin_eroded'
  return { outcome, reasons, conversionLiftPercent: lift, conversionSignificant: significant, marginPerViewChangeCents: change, conversionUpMarginDown: lift !== null && lift > 0 && change !== null && change < 0, baseline, trial }
}

/** Preapproved stop rules. Spend and refund caps are hard; margin loss waits for the minimum sample so chance cannot halt a test. */
export function breach(experiment: Experiment, trial: Metrics): string | undefined {
  const { budget } = experiment, baseline = experiment.startBaseline ?? experiment.baseline
  if (trial.discountSpendCents > 0 && trial.discountSpendCents >= budget.maxDiscountCents) return `Discount spend reached the approved ${(budget.maxDiscountCents / 100).toFixed(2)} USD cap.`
  if (trial.refundedCents > 0 && trial.refundRate !== null && trial.refundRate * 100 >= budget.maxRefundRatePercent) return `The refund rate reached the approved ${budget.maxRefundRatePercent}% cap.`
  if (baseline.marginPerViewCents !== null && trial.marginCents !== null && trial.views >= budget.minViews) {
    const loss = baseline.marginPerViewCents * trial.views - trial.marginCents
    if (loss > 0 && loss >= budget.maxMarginLossCents) return `Contribution margin fell ${(loss / 100).toFixed(2)} USD below the baseline rate, reaching the approved ${(budget.maxMarginLossCents / 100).toFixed(2)} USD loss cap.`
  }
  return undefined
}
