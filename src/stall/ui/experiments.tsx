import { useEffect, useState } from 'react'
import type { ExperimentBundle, LiveExperiment, Metrics } from '../experiments/model'
import type { Source } from '../proposals/model'
import type { Product, Run } from './types'
import { errorMessage, money, request } from './api'
import { Badge, Notice } from './primitives'
import { shortId, usePerson, When } from './presentation'

const wrap = { overflowWrap: 'anywhere' as const, minWidth: 0 }
const percent = (value: number | null, places = 1) => value === null ? 'Unknown' : `${(value * 100).toFixed(places)}%`
const outcomes = { inconclusive: 'Inconclusive', profitable: 'More margin per visit', margin_eroded: 'Margin eroded' }
const statuses = { draft: 'Awaiting review', running: 'Running', stopped: 'Stopped and restored', completed: 'Completed and restored', restored: 'Restored history' }

function Sources({ sources }: { sources: Source[] }) {
  return <dl className="st-stack" style={wrap}>{sources.map(source => <div key={source.id}><dt><strong>{source.label}</strong> <code className="st-small">{source.id}</code></dt><dd style={{ marginInlineStart: 0 }}>{source.value}</dd></div>)}</dl>
}
function Numbers({ title, metrics }: { title: string; metrics: Metrics }) {
  return <div className="st-stack" aria-label={title} style={wrap}><h4>{title}</h4>
    <p className="st-small"><When at={metrics.from} /> to <When at={metrics.to} /></p>
    <p>{metrics.views} page views · {metrics.orders} orders · {metrics.units} units · conversion {percent(metrics.conversion, 2)}</p>
    <p>Revenue {money(metrics.revenueCents)} · refunded {money(metrics.refundedCents)} · margin {metrics.marginCents === null ? 'unknown (cost missing)' : money(metrics.marginCents)}{metrics.discountSpendCents ? ` · discount spend ${money(metrics.discountSpendCents)}` : ''}</p>
  </div>
}

function Review({ experiment, product, bundleRevision, busy, canApprove, run, refresh }: { experiment: LiveExperiment; product: Product; bundleRevision: string; busy: boolean; canApprove: boolean; run: Run; refresh: () => void }) {
  const person = usePerson(), [working, setWorking] = useState(false), [error, setError] = useState('')
  const { change, budget, forecast } = experiment, stale = experiment.sourceRevision !== bundleRevision, draft = experiment.status === 'draft', running = experiment.status === 'running'
  const disabled = busy || working || (draft && stale)
  async function act(type: string) {
    setWorking(true); setError('')
    try { if (await run(type, { id: experiment.id, revision: experiment.revision })) refresh() } catch (failure) { setError(errorMessage(failure)) } finally { setWorking(false) }
  }
  const changeText = change.field === 'price' ? `Price ${change.percent > 0 ? '+' : ''}${change.percent}% from ${money(experiment.before?.unitCents ?? product.value.unitCents)} (restored afterwards)` : 'New product description'
  return <details open={draft || running} className="st-panel-block" data-experiment-id={experiment.id} style={wrap}>
    <summary>Experiment {shortId(experiment.id)} · {statuses[experiment.status]}</summary>
    <div className="st-stack">
      <p className="st-small">Prepared by {person(experiment.preparedBy)} · <When at={experiment.createdAt} /> · source revision {shortId(experiment.sourceRevision)}</p>
      {experiment.status === 'restored' && experiment.before && <Notice error>This history was restored from an archive and nothing is running. If the test was running when the archive was made, the product may still carry its trial value. Before the test the price was {money(experiment.before.unitCents)}; check the product.</Notice>}
      {stale && draft && <Notice error>The product has changed. This proposal is stale and cannot be approved. Ask the agent to prepare a fresh experiment from the current measured bundle.</Notice>}
      <h4>Hypothesis</h4><p>{experiment.hypothesis}</p>
      <details><summary>Sources for the hypothesis</summary><Sources sources={experiment.sources.filter(source => experiment.hypothesisCitations.includes(source.id))} /></details>
      <h4>Bounded change</h4><p data-change>{changeText}</p>
      {change.field === 'description' && <p>{change.value}</p>}
      <p><strong>Audience</strong><br />{experiment.audience}</p>
      <p><strong>Rollback</strong><br />{experiment.rollback}</p>
      <h4>Budget and stop rules</h4>
      <p>{budget.durationDays} days · discount spend up to {money(budget.maxDiscountCents)} · margin loss up to {money(budget.maxMarginLossCents)} · refund rate up to {budget.maxRefundRatePercent}% · at least {budget.minViews} views and {budget.minOrders} orders to call a result.</p>
      <p className="st-small">Crossing a cap halts the test and restores the earlier value. Nothing raises spend or extends the window.</p>
      <Numbers title="Measured baseline" metrics={experiment.startBaseline ?? experiment.baseline} />
      <h4>Forecast</h4>
      <p>{forecast.unitsExpected} units expected at the measured rate · {forecast.marginDeltaCents === null ? 'margin effect unknown until measured' : `margin change ${money(forecast.marginDeltaCents)}`}{forecast.breakEvenConversionLiftPercent === null ? '' : ` · break-even conversion change ${forecast.breakEvenConversionLiftPercent}%`}</p>
      <p className="st-small">{forecast.assumption}</p>
      {!!experiment.unknowns.length && <div><h4>Unknowns</h4><ul>{experiment.unknowns.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {experiment.stock && <p><strong>Stock evidence</strong><br />{experiment.stock.available} available when it started (needs {experiment.stock.required}) · <When at={experiment.stock.observedAt} /></p>}
      {experiment.live && <><Numbers title="Trial so far" metrics={experiment.live.trial} />{experiment.live.breach && <Notice error>A stop rule is crossed: {experiment.live.breach} It halts at the next check.</Notice>}</>}
      {experiment.result && <section className="st-note" aria-label="Experiment result"><div className="st-stack">
        <div className="st-row"><h4>Result</h4><Badge value={outcomes[experiment.result.outcome]} tone={experiment.result.outcome === 'profitable' ? undefined : 'need'} /></div>
        <Numbers title="Trial" metrics={experiment.result.trial} />
        <p>Conversion change {experiment.result.conversionLiftPercent === null ? 'unknown' : `${experiment.result.conversionLiftPercent}%`}{experiment.result.conversionSignificant ? '' : ' (not distinguishable from chance)'} · margin per visit change {experiment.result.marginPerViewChangeCents === null ? 'unknown' : `${money(experiment.result.marginPerViewChangeCents)}`}</p>
        {experiment.result.conversionUpMarginDown && <Notice error>Conversion rose but margin per visit fell: the lift came at the cost of margin.</Notice>}
        {!!experiment.result.reasons.length && <ul>{experiment.result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {experiment.stop && <p className="st-small">{experiment.stop.reason} {experiment.stop.rolledBack ? 'The earlier value was restored.' : 'The field was edited during the test, so Stall left it as the merchant set it.'}</p>}
      </div></section>}
      {error && <Notice error>{error}</Notice>}
      {experiment.approval && <p className="st-small">Approved by {person(experiment.approval.by)} · <When at={experiment.approval.at} /></p>}
      {draft && (canApprove ? <button disabled={disabled} onClick={() => void act('experiment.approve')}>{working ? 'Working…' : `Approve and start ${budget.durationDays}-day test`}</button> : <p>An owner or administrator must approve this exact experiment.</p>)}
      {running && canApprove && <div className="st-actions"><button className="st-secondary" disabled={disabled} onClick={() => void act('experiment.evaluate')}>Check stop rules</button><button disabled={disabled} onClick={() => void act('experiment.stop')}>Stop and restore</button></div>}
    </div>
  </details>
}

export function Experiments({ product, busy, run, canApprove }: { product: Product; busy: boolean; run: Run; canApprove: boolean }) {
  const [bundle, setBundle] = useState<ExperimentBundle | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0)
  useEffect(() => {
    let current = true
    if (!product.value.approval || product.value.draft) { setLoading(false); return }
    setLoading(true); setError('')
    void request<ExperimentBundle>(`/api/stall/experiments?sku=${encodeURIComponent(product.id)}&days=14`).then(value => { if (current) setBundle(value) }).catch(failure => { if (current) setError(errorMessage(failure)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [product.id, product.revision, version])
  if (!product.value.approval || product.value.draft) return null
  return <section className="st-panel-block st-stack" aria-label="Measured experiments" style={wrap}>
    <div className="st-row"><h3>Measured experiments</h3><button className="st-link" disabled={loading || busy} onClick={() => setVersion(value => value + 1)}>Refresh experiments</button></div>
    <p>An agent proposes a small price or description test from your measured data. You approve the exact change, audience and spend; Stall restores the earlier value when a stop rule triggers or the window ends.</p>
    <p className="st-small">Preparation requires an agent credential from <a href="#settings">Settings → Agent access</a>. Page views are anonymous counts; visitors who send a privacy signal are excluded from conversion.</p>
    {loading && <p role="status" className="st-small">Loading experiments…</p>}{error && <Notice error>{error}</Notice>}
    {bundle && <><details><summary>Measured source bundle · last {bundle.days} days · revision {shortId(bundle.revision)}</summary><Sources sources={bundle.sources} /></details>
      {!!bundle.unknowns.length && <div><h4>Unknowns</h4><ul>{bundle.unknowns.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {!bundle.experiments.length && <p className="st-small">No experiments yet. Ask your agent to prepare one using these measurements.</p>}
      {bundle.experiments.map(experiment => <Review key={experiment.id} experiment={experiment} product={product} bundleRevision={bundle.revision} busy={busy || loading} canApprove={canApprove} run={run} refresh={() => setVersion(value => value + 1)} />)}
    </>}
  </section>
}
