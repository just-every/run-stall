import type { Approval } from '../model'
import type { Source } from '../proposals/model'

export type Metrics = {
  from: string; to: string; views: number; limitedViews: number; orders: number; units: number
  revenueCents: number; refundedCents: number; netRevenueCents: number; costCents: number | null; marginCents: number | null
  discountSpendCents: number; conversion: number | null; refundRate: number | null; marginPerViewCents: number | null
}
export type ExperimentChange = { field: 'price'; percent: number } | { field: 'description'; value: string; citations: string[] }
export type Budget = { durationDays: number; maxDiscountCents: number; maxMarginLossCents: number; maxRefundRatePercent: number; minViews: number; minOrders: number }
export type Forecast = { assumption: string; unitsExpected: number; unitMarginBeforeCents: number | null; unitMarginAfterCents: number | null; marginDeltaCents: number | null; breakEvenConversionLiftPercent: number | null }
export type Stock = { observedAt: string; available: number; required: number }
export type Snapshot = { unitCents: number; description: string; variants: { sku: string; unitCents?: number }[] }
export type Outcome = 'inconclusive' | 'profitable' | 'margin_eroded'
export type Result = {
  outcome: Outcome; reasons: string[]; conversionLiftPercent: number | null; conversionSignificant: boolean
  marginPerViewChangeCents: number | null; conversionUpMarginDown: boolean; baseline: Metrics; trial: Metrics
}
export type Stop = { at: string; by: string; kind: 'rule' | 'ended' | 'manual'; reason: string; rolledBack: boolean }
export type Experiment = {
  id: string; revision: string; sku: string; sourceRevision: string; hypothesis: string; hypothesisCitations: string[]
  change: ExperimentChange; budget: Budget; audience: string; rollback: string; sources: Source[]; unknowns: string[]
  baseline: Metrics; forecast: Forecast; preparedBy: string; createdAt: string
  status: 'draft' | 'running' | 'stopped' | 'completed' | 'restored'
  approval?: Approval; startedAt?: string; endsAt?: string; stock?: Stock; startBaseline?: Metrics; priorApproval?: Approval
  before?: Snapshot; after?: Snapshot
  stop?: Stop; result?: Result
}
export type ExperimentBundle = { sku: string; revision: string; days: number; sources: Source[]; unknowns: string[]; metrics: Metrics; experiments: LiveExperiment[] }
export type LiveExperiment = Experiment & { live?: { trial: Metrics; breach?: string } }
