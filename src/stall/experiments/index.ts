import type { Bindings } from '../../auth.server'
import { audit, changed, commit, systemAudit } from '../access'
import { approval, actorLabel, fail, integer, Problem, requirePerson, text, type Actor, type Product } from '../model'
import { checkListing } from '../listing-checks'
import { sellables } from '../listing'
import { catalogue, decimal } from '../pier'
import { orders, products } from '../store'
import { proposalChanges } from '../proposals/changes'
import { applyChange, restore, snapshot, untouched } from './apply'
import { forecast } from './forecast'
import { analyze, breach, hourEnd, hourStart, measure } from './measure'
import { baselineAt, day, experimentSources, stamp, usd } from './sources'
import { productViews } from './views'
import type { Budget, Experiment, ExperimentBundle, ExperimentChange, LiveExperiment, Metrics, Stock } from './model'

const allowed = ['sku', 'revision', 'budget', 'hypothesis', 'citations', 'change']
export async function experiments(db: D1Database, sku?: string): Promise<Experiment[]> {
  const rows = sku ? await db.prepare('SELECT value_json FROM st_experiments WHERE sku=? ORDER BY rowid DESC').bind(sku).all<{ value_json: string }>() : await db.prepare('SELECT value_json FROM st_experiments ORDER BY rowid').all<{ value_json: string }>()
  return rows.results.map(row => JSON.parse(row.value_json))
}
const trialFrom = (experiment: Experiment) => hourEnd(Date.parse(experiment.startedAt!))
const trialTo = (experiment: Experiment, at: number, from: string) => { const to = hourStart(Math.min(at, Date.parse(experiment.endsAt!))); return to > from ? to : from }
async function trialMetrics(db: D1Database, experiment: Experiment, product: Product, all: Awaited<ReturnType<typeof orders>>, at: number): Promise<Metrics> {
  const from = trialFrom(experiment), to = trialTo(experiment, at, from)
  const before = experiment.change.field === 'price' ? experiment.before : undefined
  const priceBefore = before ? new Map([[experiment.sku, before.unitCents], ...(product.value.details?.variants ?? []).map(variant => [variant.sku, before.variants.find(entry => entry.sku === variant.sku)?.unitCents ?? before.unitCents] as [string, number])]) : undefined
  return measure({ sku: experiment.sku, value: product.value, orders: all, views: await productViews(db, experiment.sku, from, to), from, to, priceBefore }).metrics
}
async function productOf(db: D1Database, sku: string) { return (await products(db)).find(entry => entry.id === sku) ?? fail('NOT_FOUND', 'No such product.', 404) }

export async function experimentBundle(db: D1Database, sku: string, days: number): Promise<ExperimentBundle> {
  const all = await orders(db), found = await experimentSources(db, all, sku, days), saved = await experiments(db, sku), now = Date.now()
  const live: LiveExperiment[] = await Promise.all(saved.map(async experiment => {
    if (experiment.status !== 'running') return experiment
    const trial = await trialMetrics(db, experiment, found.product, all, now)
    return { ...experiment, live: { trial, breach: breach(experiment, trial) } }
  }))
  return { sku, revision: found.product.revision, days, sources: found.sources, unknowns: found.unknowns, metrics: found.metrics, experiments: live }
}

function budgetOf(input: unknown): Budget {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['durationDays', 'maxDiscountCents', 'maxMarginLossCents', 'maxRefundRatePercent', 'minViews', 'minOrders'].includes(key))) fail('INPUT', 'State the budget with durationDays, maxDiscountCents, maxMarginLossCents, maxRefundRatePercent, minViews and minOrders.', 400)
  const value = input as Record<string, unknown>
  return { durationDays: integer(value.durationDays, 'Duration in days', 1, 28), maxDiscountCents: integer(value.maxDiscountCents, 'Discount spend cap', 0, 100000), maxMarginLossCents: integer(value.maxMarginLossCents, 'Margin loss cap', 0, 100000), maxRefundRatePercent: integer(value.maxRefundRatePercent, 'Refund rate cap', 1, 100), minViews: integer(value.minViews, 'Minimum page views', 100, 100000), minOrders: integer(value.minOrders, 'Minimum orders', 10, 10000) }
}
function changeOf(input: unknown, sources: Awaited<ReturnType<typeof experimentSources>>['productSources']): ExperimentChange {
  const value = input as Record<string, unknown> | null
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INPUT', 'Propose one change.', 400)
  if (value.field === 'price') {
    if (Object.keys(value).some(key => !['field', 'percent'].includes(key))) fail('INPUT', 'A price experiment names only its percentage.', 400)
    const percent = integer(value.percent, 'Price change percent', -20, 20)
    if (!percent) fail('INPUT', 'A price experiment changes the price.', 400)
    return { field: 'price', percent }
  }
  if (value.field !== 'description') fail('UNSUPPORTED_CLAIM', 'An experiment changes the price or the description. Inventory, certifications and reviews cannot be invented or changed.', 400)
  const [change] = proposalChanges([{ field: 'description', value: value.value, citations: value.citations }], sources)
  return { field: 'description', value: change.value, citations: change.citations }
}
const productFence = (db: D1Database, product: Product) => db.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_products WHERE id=? AND revision=?) THEN 1 ELSE 0 END').bind(product.id, product.revision)
async function currentExperiment(db: D1Database, p: any, status: Experiment['status']) {
  const row = await db.prepare('SELECT value_json FROM st_experiments WHERE id=?').bind(text(p.id, 'Experiment ID')).first<{ value_json: string }>()
  const experiment: Experiment = row ? JSON.parse(row.value_json) : fail('NOT_FOUND', 'No such experiment.', 404)
  if (p.revision !== experiment.revision || experiment.status !== status) fail('CHANGED', 'Review the exact current experiment. Restored experiments require fresh agent preparation.')
  return experiment
}
/** Availability is a timestamped observation from the stock authority; with none, nothing starts. */
async function stockEvidence(env: Bindings, product: Product, units: number): Promise<Stock> {
  const required = Math.max(1, units * 2)
  let stock: Awaited<ReturnType<typeof catalogue>>
  try { stock = await catalogue(env) } catch (error) {
    if (error instanceof Problem) fail('STOCK_UNVERIFIED', `Stock could not be verified (${error.code}). No experiment starts without current stock evidence.`)
    throw error
  }
  const skus = sellables(product.value).map(item => item.sku)
  const available = Number(stock.items.filter(item => skus.includes(item.sku)).reduce((sum, item) => sum + decimal(item.available), 0n) / 1000000n)
  if (available < required) fail('STOCK_INFEASIBLE', `Observed stock (${available}) cannot cover twice the measured volume (${required}). Restock before testing a change that could lift demand.`)
  return { observedAt: stock.observedAt, available, required }
}

export async function experimentCommand(env: Bindings, actor: Actor, type: string, p: any) {
  if (!['owner', 'admin'].includes(actor.role) || actor.staffRole) fail('FORBIDDEN', 'Only the owner or administrator may manage experiments.', 403)
  if (type === 'experiment.prepare') return prepare(env, actor, p)
  requirePerson(actor)
  if (type === 'experiment.approve') return approve(env, actor, p)
  if (type === 'experiment.evaluate') { const experiment = await currentRunning(env.DB, p); return (await evaluate(env, experiment, Date.now(), actor)).experiment }
  if (type === 'experiment.stop') return settle(env, await currentExperiment(env.DB, p, 'running'), { kind: 'manual', reason: 'Stopped by the owner or administrator.' }, Date.now(), actor)
  return fail('COMMAND', 'Unknown experiment command.', 404)
}
async function currentRunning(db: D1Database, p: any) {
  const row = await db.prepare('SELECT value_json FROM st_experiments WHERE id=?').bind(text(p.id, 'Experiment ID')).first<{ value_json: string }>()
  const experiment: Experiment = row ? JSON.parse(row.value_json) : fail('NOT_FOUND', 'No such experiment.', 404)
  if (experiment.status !== 'running') fail('CHANGED', 'This experiment is not running.')
  return experiment
}

async function prepare(env: Bindings, actor: Actor, p: any) {
  if (!actor.agent) fail('AGENT_REQUIRED', 'Prepare this experiment through a personal agent credential.', 403)
  if (!p || Object.keys(p).some(key => !allowed.includes(key))) fail('UNSUPPORTED_CLAIM', 'An agent proposes the change, budget and cited reasoning. Forecasts, results and measured numbers are derived by Stall.', 400)
  const sku = text(p.sku, 'Product SKU', 100), budget = budgetOf(p.budget), all = await orders(env.DB), found = await experimentSources(env.DB, all, sku, budget.durationDays)
  if (p.revision !== found.product.revision) fail('SOURCE_CHANGED', 'Read the current measured bundle before preparing an experiment.')
  const change = changeOf(p.change, found.productSources), hypothesis = text(p.hypothesis, 'Hypothesis', 600)
  const citations = Array.isArray(p.citations) && p.citations.length && p.citations.length <= 20 ? p.citations.map((id: unknown) => text(id, 'Source citation')) : fail('UNSUPPORTED_CLAIM', 'Cite the measured data behind the hypothesis.', 400)
  if (new Set(citations).size !== citations.length || citations.some((id: string) => !found.sources.some(source => source.id === id)) || !citations.some((id: string) => id.startsWith('metric:'))) fail('UNSUPPORTED_CLAIM', 'Cite each existing measured or approved source once, including measured data.', 400)
  const id = crypto.randomUUID(), revision = crypto.randomUUID(), before = snapshot(found.product.value)
  const experiment: Experiment = {
    id, revision, sku, sourceRevision: found.product.revision, hypothesis, hypothesisCitations: citations, change, budget,
    audience: 'Every shopper who views this product while the test runs. Nobody is targeted or identified.',
    rollback: change.field === 'price' ? `Restores the earlier price (${usd(before.unitCents)} USD) when a stop rule triggers, the window ends or you stop it.` : 'Restores the earlier description when a stop rule triggers, the window ends or you stop it.',
    sources: found.sources, unknowns: found.unknowns, baseline: found.metrics, forecast: forecast(found.product.value, found.metrics, change), preparedBy: actorLabel(actor), createdAt: stamp(Date.now()), status: 'draft',
  }
  await commit(env.DB, actor, [productFence(env.DB, found.product), env.DB.prepare('INSERT INTO st_experiments VALUES(?,?,?,?)').bind(id, sku, revision, JSON.stringify(experiment)), audit(env.DB, actor, id, 'experiment.prepared')])
  return experiment
}

async function approve(env: Bindings, actor: Actor, p: any) {
  const experiment = await currentExperiment(env.DB, p, 'draft'), all = await orders(env.DB), now = Date.now()
  const product = await productOf(env.DB, experiment.sku)
  if (!product.value.approval || product.value.draft || product.revision !== experiment.sourceRevision) fail('SOURCE_CHANGED', 'The product changed after this proposal. Ask the agent to prepare a fresh experiment from the current measured bundle.')
  if ((await experiments(env.DB, experiment.sku)).some(entry => entry.status === 'running')) fail('RUNNING', 'Stop the running experiment on this product first.')
  const start = await baselineAt(env.DB, product, all, now, experiment.budget.durationDays)
  const stock = await stockEvidence(env, product, start.metrics.units)
  const applied = applyChange(product.value, experiment.change), next: Experiment = {
    ...experiment, revision: crypto.randomUUID(), status: 'running', approval: approval(actor, experiment.revision), startedAt: stamp(now), endsAt: stamp(now + experiment.budget.durationDays * day),
    stock, startBaseline: start.metrics, priorApproval: product.value.approval, before: snapshot(product.value), after: snapshot(applied),
  }
  await checkListing(env.DB, applied, await products(env.DB))
  await commit(env.DB, actor, [
    productFence(env.DB, product),
    env.DB.prepare("UPDATE st_experiments SET revision=?,value_json=? WHERE id=? AND revision=? AND json_extract(value_json,'$.status')='draft'").bind(next.revision, JSON.stringify(next), experiment.id, experiment.revision), changed(env.DB),
    env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_experiments WHERE sku=? AND id<>? AND json_extract(value_json,\'$.status\')=\'running\') THEN 0 ELSE 1 END').bind(experiment.sku, experiment.id),
    env.DB.prepare('UPDATE st_products SET revision=?,value_json=? WHERE id=? AND revision=?').bind(crypto.randomUUID(), JSON.stringify({ ...applied, approval: approval(actor, experiment.revision) }), product.id, product.revision), changed(env.DB),
    audit(env.DB, actor, experiment.id, 'experiment.started'), audit(env.DB, actor, product.id, 'product.published'),
  ])
  return next
}

/** Ends the run and restores the earlier value, unless the merchant has since edited the same field. */
async function settle(env: Bindings, experiment: Experiment, why: { kind: 'rule' | 'ended' | 'manual'; reason: string }, at: number, actor?: Actor) {
  const product = await productOf(env.DB, experiment.sku), trial = await trialMetrics(env.DB, experiment, product, await orders(env.DB), at)
  const result = analyze(experiment.startBaseline ?? experiment.baseline, trial, experiment.budget)
  const rollBack = untouched(product.value, experiment.change, experiment.after!)
  const next: Experiment = { ...experiment, revision: crypto.randomUUID(), status: why.kind === 'ended' ? 'completed' : 'stopped', result, stop: { at: stamp(at), by: actor ? actorLabel(actor) : 'experiment-rule', kind: why.kind, reason: why.reason, rolledBack: rollBack } }
  const restored = restore(product.value, experiment.change, experiment.before!)
  if (product.value.approval?.revision === experiment.approval?.revision) { if (experiment.priorApproval) restored.approval = experiment.priorApproval; else delete restored.approval }
  const writes = [
    env.DB.prepare("UPDATE st_experiments SET revision=?,value_json=? WHERE id=? AND revision=? AND json_extract(value_json,'$.status')='running'").bind(next.revision, JSON.stringify(next), experiment.id, experiment.revision), changed(env.DB),
    ...(rollBack ? [env.DB.prepare('UPDATE st_products SET revision=?,value_json=? WHERE id=? AND revision=?').bind(crypto.randomUUID(), JSON.stringify(restored), product.id, product.revision), changed(env.DB)] : []),
  ]
  const action = `experiment.${why.kind === 'ended' ? 'completed' : 'stopped'}`
  if (actor) await commit(env.DB, actor, [...writes, audit(env.DB, actor, experiment.id, action), ...(rollBack ? [audit(env.DB, actor, product.id, 'product.published')] : [])])
  else await env.DB.batch([...writes, systemAudit(env.DB, experiment.id, action, 'experiment-rule'), ...(rollBack ? [systemAudit(env.DB, product.id, 'product.published', 'experiment-rule')] : []), env.DB.prepare('DELETE FROM st_guard')])
  return next
}

/** One evaluation: end at the window's close, halt on a preapproved rule, or report live numbers. */
export async function evaluate(env: Bindings, experiment: Experiment, at: number, actor?: Actor): Promise<{ experiment: LiveExperiment }> {
  if (at >= Date.parse(experiment.endsAt!)) return { experiment: await settle(env, experiment, { kind: 'ended', reason: 'The approved window ended; the earlier value was restored.' }, at, actor) }
  const product = await productOf(env.DB, experiment.sku), trial = await trialMetrics(env.DB, experiment, product, await orders(env.DB), at), reason = breach(experiment, trial)
  if (reason) return { experiment: await settle(env, experiment, { kind: 'rule', reason }, at, actor) }
  return { experiment: { ...experiment, live: { trial } } }
}
/** The minute's run: every running experiment is checked against its own approved stop rules. */
export async function runExperiments(env: Bindings) {
  let failure: unknown
  for (const experiment of (await experiments(env.DB)).filter(entry => entry.status === 'running')) {
    try { await evaluate(env, experiment, Date.now()) } catch (error) { failure ??= error }
  }
  if (failure) throw failure
}
