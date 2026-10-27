import { useEffect, useState } from 'react'
import type { HistoricalSale } from '../analytics/report-model'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'
import { When } from './presentation'

type Import = { id: string; source: string; createdAt: string; appliedAt: string | null }
type History = { format: { schema: string; description: string; example: unknown }; imports: Import[] }
type Preview = { previewId: string; source: string; rows: HistoricalSale[]; totals: { sales: number; totalCents: number; refundsCents: number }; effects: string }
export function AnalyticsHistory() {
 const [history, setHistory] = useState<History>(), [preview, setPreview] = useState<Preview>(), [input, setInput] = useState<unknown>(), [filename, setFilename] = useState(''), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
 async function reload() { setHistory(await request<History>('/api/stall/analytics/history')) }
 useEffect(() => { void reload().catch(error => setError(errorMessage(error))) }, [])
 async function read(file?: File) {
  setPreview(undefined); setReviewed(false); setInput(undefined); setFilename(''); setError(''); setNotice('')
  if (!file) return
  try { if (file.size > 2 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 2 MB.'); setInput(JSON.parse(await file.text())); setFilename(file.name) }
  catch (error) { setError(errorMessage(error)) }
 }
 async function review() {
  setBusy(true); setError(''); setNotice(''); setReviewed(false)
  try { setPreview(await request<Preview>('/api/stall/analytics/history', input)) }
  catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
 }
 async function apply() {
  if (!preview || !reviewed) return
  setBusy(true); setError(''); setNotice('')
  try { await request('/api/stall/analytics/history/apply', { previewId: preview.previewId, reviewed: true }); setNotice('Historical sales imported. Reports keep them separate from new conversion.'); setPreview(undefined); setInput(undefined); setFilename(''); setReviewed(false); await reload() }
  catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
 }
 function downloadFormat() {
  if (!history) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(history.format.example, null, 2)], { type: 'application/json' })), link = document.createElement('a')
  link.href = url; link.download = 'stall-analytics-history-format.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
 }
 return <details><summary>Import historical sales</summary><div className="st-stack">
  {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
  {history ? <><p>{history.format.description}</p><button className="st-secondary" onClick={downloadFormat}>Download JSON format</button><label>Historical sales JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void read(event.target.files?.[0])} /></label>{filename && <p>{filename}</p>}<button disabled={input === undefined || busy} onClick={() => void review()}>{busy ? 'Working…' : 'Preview historical sales'}</button></> : !error && <p role="status">Loading historical import format…</p>}
  {preview && <section className="st-stack" aria-label="Historical sales preview"><h3>Review {preview.source}</h3><p>{preview.totals.sales} sales · {money(preview.totals.totalCents)} collected · {money(preview.totals.refundsCents)} refunded</p><p>{preview.effects}</p><div className="st-report-table-wrap" role="region" aria-label="Historical import rows" tabIndex={0}><table><thead><tr>{['Source ID', 'Date', 'Channel', 'Total', 'Refunds', 'References'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{preview.rows.map(row => <tr key={row.sourceId}><th scope="row">{row.sourceId}<small>{row.lines.map(line => `${line.quantity} × ${line.name}`).join(', ')}</small></th><td><When at={row.createdAt} /></td><td>{row.channel}</td><td>{money(row.totalCents)}</td><td>{money(row.refundsCents)}</td><td>{[row.processorReference, row.accountingReference].filter(Boolean).join(' · ') || 'Not recorded'}</td></tr>)}</tbody></table></div><label className="st-checkbox"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I reviewed these historical sales and their original references.</label><button disabled={!reviewed || busy} onClick={() => void apply()}>{busy ? 'Importing…' : 'Import reviewed sales'}</button></section>}
  {history && history.imports.length > 0 && <details><summary>Historical import history</summary><ul className="st-report-lines">{history.imports.map(job => <li key={job.id}><strong>{job.source}</strong><span>{job.appliedAt ? <>Imported <When at={job.appliedAt} /></> : <>Previewed <When at={job.createdAt} /></>}</span></li>)}</ul></details>}
 </div></details>
}
