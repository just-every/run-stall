import type { ProductValue } from '../model'
import { sellables } from '../listing'
import { applyChange } from './apply'
import { unitCost } from './measure'
import type { ExperimentChange, Forecast, Metrics } from './model'

/** Derived by Stall from the measured window. An agent can propose a change but cannot supply these numbers. */
export function forecast(value: ProductValue, baseline: Metrics, change: ExperimentChange): Forecast {
  const unitsExpected = baseline.units
  if (change.field === 'description') return { assumption: 'Content change: price and cost stay the same. Its effect on conversion and margin is unknown until measured.', unitsExpected, unitMarginBeforeCents: null, unitMarginAfterCents: null, marginDeltaCents: null, breakEvenConversionLiftPercent: null }
  const before = sellables(value), after = sellables(applyChange(value, change)), mean = (values: number[]) => values.reduce((sum, item) => sum + item, 0) / (values.length || 1)
  const delta = mean(after.map((item, index) => item.unitCents - before[index].unitCents))
  const costs = before.map(item => unitCost(value, item.sku)), known = costs.every(cost => cost !== undefined)
  const m0 = known ? mean(before.map((item, index) => item.unitCents - costs[index]!)) : null, m1 = known ? mean(after.map((item, index) => item.unitCents - costs[index]!)) : null
  const breakEven = m0 !== null && m1 !== null && m1 > 0 && m0 > 0 ? Math.round((m0 / m1 - 1) * 10000) / 100 : null
  return { assumption: 'Demand is assumed unchanged at the measured rate. The break-even figure is the conversion change needed to keep the same margin per page view.', unitsExpected, unitMarginBeforeCents: m0 === null ? null : Math.round(m0), unitMarginAfterCents: m1 === null ? null : Math.round(m1), marginDeltaCents: Math.round(unitsExpected * delta), breakEvenConversionLiftPercent: breakEven }
}
