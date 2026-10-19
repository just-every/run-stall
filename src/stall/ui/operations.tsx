import { useEffect, useState } from 'react'
import type { operationsSnapshot } from '../operations'
import { request, errorMessage } from './api'
import { Notice, Section, RecordDetail } from './primitives'
import { humanLabel, shortId, When } from './presentation'

type Snapshot = Awaited<ReturnType<typeof operationsSnapshot>>
export function Operations() {
 const [data, setData] = useState<Snapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
 async function load(probe = false) {
  setBusy(true); setError('')
  try { setData(await request<Snapshot>(probe ? '/api/stall/operations/probe' : '/api/stall/operations', probe ? {} : undefined)) }
  catch (error) { setError(errorMessage(error)) }
  finally { setBusy(false) }
 }
 useEffect(() => { void load() }, [])
 return <Section id="operations" title="Operations">
  <p>Check this installation and find work that needs attention. Provider checks read your accounts without taking payment, sending mail or changing stock.</p>
  <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => void load()}>Refresh operations</button><button disabled={busy} onClick={() => void load(true)}>Check providers now</button></div>
  {busy && <p role="status">Reading operations…</p>}
  {error && <Notice error>{error}</Notice>}
  {data && <div className="st-stack" aria-label="Operations observations">
   <p>Database: {data.database.ok ? 'Available' : 'Unavailable'} · checked <When at={data.database.checkedAt} />. Storage used: {data.storage?.usedBytes == null ? 'Unavailable from this runtime' : `${data.storage.usedBytes.toLocaleString()} bytes`}.</p>
   <ul className="st-connections">{Object.entries(data.providers).map(([name, provider]) => <li key={name}><div><strong>{name === 'pier' ? 'Pier stock' : 'Stripe payments'}</strong><small>{provider.configured ? 'Configured' : 'Setup required'} · {provider.lastObservation ? <>Last observed {humanLabel(provider.lastObservation.status)} · <When at={provider.lastObservation.checkedAt} /></> : 'Not checked'}</small>{provider.lastObservation && <small>{provider.lastObservation.message}</small>}</div></li>)}</ul>
   <p className="st-small">Last observations are historical, including after a restore or connection change. Check again before relying on them. Configuration alone does not verify an account.</p>
   <div><h3>Automatic payment checks</h3>{data.scheduler ? <p>Last run: {humanLabel(data.scheduler.status)} · started <When at={data.scheduler.attemptedAt} />{data.scheduler.completedAt && <> · completed <When at={data.scheduler.completedAt} /></>}. Checked {data.scheduler.checked}, confirmed {data.scheduler.confirmed}, failed {data.scheduler.failed}.{data.scheduler.lastErrorCode && <> Error: {data.scheduler.lastErrorCode}.</>}</p> : <p>No scheduled check has been observed yet.</p>}
    <p className="st-small">The minute check considers up to {data.limits.automaticPaymentsPerRun} awaiting payments created within {data.limits.automaticPaymentAgeHours} hours. A running observation without completion may indicate an interruption.</p></div>
   {data.outstanding && <div><h3>Outstanding commerce work · {data.outstanding.total}</h3>
    <p>Awaiting payment: {data.outstanding.counts?.awaitingPayment ?? 0} · eligible for automatic checks: {data.outstanding.counts?.eligiblePayment ?? 0} · outside the automatic age window: {data.outstanding.counts?.outsideAutoConfirmationAge ?? 0}.</p>
    <p>Checkout creation: {data.outstanding.counts?.checkout ?? 0} · stock/reservation: {data.outstanding.counts?.reservation ?? 0} · shipping: {data.outstanding.counts?.shipment ?? 0} · refunds: {data.outstanding.counts?.refund ?? 0}. An order may need more than one step.</p>
    {data.outstanding.orders.length ? <ul className="st-stack">{data.outstanding.orders.map(order => <li key={String(order.id)}><a href={`#orders/${encodeURIComponent(order.id)}`}>Order {shortId(String(order.id))}</a> · {humanLabel(String(order.status))} · created <When at={String(order.createdAt)} /><RecordDetail label="Original operation references" value={order} /></li>)}</ul> : <p>No outstanding commerce work.</p>}
    {data.outstanding.truncated && <Notice>Showing the oldest {data.outstanding.limit} of {data.outstanding.total} orders. Open Orders or download the complete business export for the full set.</Notice>}
    <p className="st-small">Awaiting payment and drafts are not failed effects. Review drafts or reconcile the original provider operation from its order; do not create replacement charges or shipments.</p></div>}
   {data.imports && <div><h3>Import jobs · {data.imports.outstanding} unfinished</h3><p>{data.imports.total} retained jobs. <a href="#move-in">Open the import journal</a> to inspect, resume or undo a reviewed job.</p>
    {data.imports.jobs.map(job => <p key={job.id}>Job {shortId(job.id)} · {humanLabel(job.state)} · {job.checkpoint}/{job.total}{job.hasError ? ' · Inspect its recorded error in the journal' : ''}</p>)}
    {data.imports.truncated && <Notice>Showing {data.imports.limit} of {data.imports.outstanding} unfinished imports.</Notice>}</div>}
   <details><summary>Storage, request limits and costs</summary><p>Commercial records and action history grow until you manage their retention. Cloudflare documents a per-database maximum of 500 MB on Free and 10 GB on Paid; this view does not discover your plan. Confirm your current <a href="https://developers.cloudflare.com/d1/platform/limits/" target="_blank" rel="noreferrer">D1 limits</a>. Keep private backups and monitor the database and your hosting account quotas.</p><p>Commerce JSON: {data.limits.commerceBodyBytes.toLocaleString()} bytes per request. CSV: {data.limits.importCsvBytes.toLocaleString()} bytes. Imports apply {data.limits.importBatchSize} records per batch and {data.limits.importBatchesPerRequest} batch per request. Business exports have no row cap and must fit runtime memory and response limits. No maximum store capacity is claimed.</p><p>Costs are separate: your hosting and database/storage plan, Stripe processing, Pier hosting and connected providers. Flat shipping is collected from shoppers; Stall does not buy postage. Tax, carrier, marketing, channel, ledger and AI provider work is not currently performed.</p><p>Read the repository’s <a href="https://github.com/just-every/run-stall/blob/main/docs/OPERATIONS.md" target="_blank" rel="noreferrer">operations and recovery guide</a> for exact bounds, backup steps and provider pricing links.</p></details>
  </div>}
 </Section>
}
