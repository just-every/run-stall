import { useEffect, useId, useRef, useState } from 'react'
import { errorMessage, request } from './api'
import { Dialog } from './dialog'
import { Badge, Notice } from './primitives'
import { shortId, When } from './presentation'

const sources = [['judge-me', 'Judge.me'], ['yotpo', 'Yotpo'], ['okendo', 'Okendo'], ['loox', 'Loox'], ['stamped', 'Stamped'], ['shopify', 'Shopify']] as const
type Source = typeof sources[number][0]
interface Product { id: string; name: string; handle: string }
interface Job { id: string; source: Source; createdAt: string; count: number; state: 'completed' | 'undone' }
interface ReviewRow {
  row: number; sourceId: string; productId: string | null; productReference: string
  rating: number; title: string; reviewerName: string; date: string; sourceVerified: boolean
  status: 'ready' | 'orphan' | 'duplicate'; reason?: string
}
interface Preview {
  fingerprint: string
  counts: { total: number; mapped: number; orphans: number; duplicates: number }
  rows: ReviewRow[]
}
const sourceLabel = (source: Source) => sources.find(([id]) => id === source)?.[1] ?? source
const base = '/api/stall/review-imports'

export function ReviewImport() {
  const heading = useId()
  const [source, setSource] = useState<Source>('judge-me')
  const [csv, setCsv] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loaded, setLoaded] = useState(false)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [excludedRows, setExcludedRows] = useState<number[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [applied, setApplied] = useState(false)
  const [undoJob, setUndoJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)

  async function list() {
    const result = await request<{ jobs: Job[]; products: Product[] }>(base)
    setJobs(result.jobs); setProducts(result.products); setLoaded(true)
  }
  useEffect(() => { void list().catch(error => setError(errorMessage(error))) }, [])
  async function act(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  function changed() {
    setPreview(null); setReviewed(false); setApplied(false)
    setMappings({}); setExcludedRows([]); setError(''); setNotice('')
  }
  async function dryRun(nextMappings = mappings, nextExcluded = excludedRows) {
    setPreview(null); setReviewed(false); setApplied(false)
    const result = await request<Preview>(`${base}/preview`, { source, csv, mappings: nextMappings, excludedRows: nextExcluded })
    setPreview(result)
  }
  async function remap(row: number, productId: string) {
    const next = { ...mappings }
    if (productId) next[String(row)] = productId
    else delete next[String(row)]
    const exclusions = excludedRows.filter(value => value !== row)
    setMappings(next); setExcludedRows(exclusions)
    await dryRun(next, exclusions)
  }
  async function exclude(row: number, checked: boolean) {
    const next = checked ? [...excludedRows, row].sort((a, b) => a - b) : excludedRows.filter(value => value !== row)
    setExcludedRows(next)
    await dryRun(mappings, next)
  }
  async function apply() {
    if (!preview || !canApply) return
    const job = await request<Job>(`${base}/apply`, { source, csv, mappings, excludedRows, fingerprint: preview.fingerprint })
    setApplied(true); setReviewed(false)
    setNotice(`Imported ${job.count} reviews from ${sourceLabel(job.source)}.`)
    await list()
  }
  async function undo() {
    if (!undoJob) return
    const job = await request<Job>(`${base}/${encodeURIComponent(undoJob.id)}/undo`, {})
    setUndoJob(null); setPreview(null); setReviewed(false)
    setNotice(`Review import ${shortId(job.id)} undone.`)
    await list()
  }
  const orphanRows = preview?.rows.filter(row => row.status === 'orphan') ?? []
  const readyCount = preview?.rows.filter(row => row.status === 'ready').length ?? 0
  const exactExclusions = orphanRows.every(row => excludedRows.includes(row.row)) && excludedRows.every(row => orphanRows.some(orphan => orphan.row === row))
  const canApply = !!preview && readyCount > 0 && exactExclusions && reviewed && !applied

  return <section className="st-stack" aria-labelledby={heading}>
    <h2 id={heading}>Bring your reviews</h2>
    <p>Import a review export, match it to your products, then review every row before applying it. A dry run makes no changes.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <div className="st-panel st-stack">
      <h3>1. Add a review export</h3>
      <label>Review source<select aria-label="Review source" value={source} disabled={busy} onChange={event => { changed(); setSource(event.target.value as Source) }}>
        {sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Choose a review CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]
        if (file) void act(async () => { const value = await file.text(); changed(); setCsv(value) })
      }} /></label>
      <label>Review CSV source<textarea rows={7} spellCheck={false} value={csv} disabled={busy} onChange={event => { changed(); setCsv(event.target.value) }} /></label>
      <div className="st-actions"><button disabled={busy || !csv.trim()} onClick={() => void act(() => dryRun())}>{busy ? 'Working…' : 'Run review dry run'}</button></div>
    </div>
    <div className="st-panel st-stack">
      <h3>2. Review and match products</h3>
      {!preview && <p>Run a dry run to see review dates, source claims and product matches.</p>}
      {preview && <>
        <dl className="st-counts">
          <div><dt>Total rows</dt><dd>{preview.counts.total}</dd></div>
          <div><dt>Mapped</dt><dd>{preview.counts.mapped}</dd></div>
          <div><dt>Orphans</dt><dd>{preview.counts.orphans}</dd></div>
          <div><dt>Duplicates</dt><dd>{preview.counts.duplicates}</dd></div>
        </dl>
        <p className="st-small">Changing a product match or exclusion runs a fresh dry run. Duplicate reviews are skipped. Imported purchase claims describe the source export.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))', gap: '1rem' }}>
          {preview.rows.map(row => <article key={row.row} className="st-panel st-stack" style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label={`Review at CSV row ${row.row}`}>
            <div className="st-heading-row"><h4>{row.title || 'Untitled review'}</h4><Badge value={row.status}>{row.status === 'orphan' ? 'Needs a product' : row.status === 'duplicate' ? 'Duplicate' : 'Ready'}</Badge></div>
            <p>{row.reviewerName || 'Unnamed reviewer'} · {row.rating} of 5 stars</p>
            <dl className="st-definition">
              <div><dt>Original date</dt><dd>{row.date ? <time dateTime={row.date}>{row.date}</time> : 'No date supplied'}</dd></div>
              <div><dt>Source claim</dt><dd>{row.sourceVerified ? `Verified purchase claimed by ${sourceLabel(source)}` : 'No verified purchase claim'}</dd></div>
              <div><dt>Source product</dt><dd>{row.productReference || 'No product reference supplied'}</dd></div>
              <div><dt>Source review</dt><dd>{row.sourceId} · CSV row {row.row}</dd></div>
            </dl>
            {row.status === 'orphan' && <Notice error>{row.reason || 'This review has no matching Stall product. Choose a product or explicitly exclude this row.'}</Notice>}
            {row.status === 'duplicate' && <p>{row.reason || 'This source review has already been imported and will be skipped.'}</p>}
            {row.status !== 'duplicate' && <label>Product for CSV row {row.row}<select value={mappings[String(row.row)] ?? ''} disabled={busy || applied || !loaded} onChange={event => { const value = event.target.value; void act(() => remap(row.row, value)) }}>
              <option value="">{row.productId ? `Automatic match: ${products.find(product => product.id === row.productId)?.name ?? row.productReference}` : 'Choose a product'}</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.handle}</option>)}
            </select></label>}
            {row.status === 'orphan' && <label className="st-checkbox"><input type="checkbox" checked={excludedRows.includes(row.row)} disabled={busy || applied} onChange={event => { const checked = event.target.checked; void act(() => exclude(row.row, checked)) }} />Exclude CSV row {row.row} from this import.</label>}
          </article>)}
        </div>
        {orphanRows.length > 0 && <p>Match each orphan to a product or check its exclusion box before applying.</p>}
        <label>Reviewed review fingerprint<input readOnly className="st-mono" value={preview.fingerprint} /></label>
        <label className="st-checkbox"><input type="checkbox" disabled={busy || applied || !exactExclusions || !readyCount} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed these rows, product matches and exclusions. Import {readyCount} reviews and exclude {excludedRows.length} orphan rows.</label>
        <div className="st-actions"><button disabled={busy || !canApply} onClick={() => void act(apply)}>{applied ? 'Reviews imported' : 'Apply reviewed reviews'}</button></div>
      </>}
    </div>
    <div className="st-heading-row"><h3>Review import history</h3><button className="st-secondary" disabled={busy} onClick={() => void act(list)}>Refresh review history</button></div>
    {!loaded && <p>Loading review import history…</p>}
    {loaded && !jobs.length && <p>No review imports yet.</p>}
    <div className="st-stack">{jobs.map(job => <article key={job.id} className="st-panel st-stack">
      <div className="st-heading-row"><h4>{sourceLabel(job.source)} · {job.count} reviews</h4><Badge value={job.state} /></div>
      <p className="st-small"><When at={job.createdAt} /> · Import {shortId(job.id)}</p>
      {job.state === 'completed' && <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => setUndoJob(job)}>Review undo<span className="st-sr-only"> for import {shortId(job.id)}</span></button></div>}
    </article>)}</div>
    {undoJob && <Dialog title="Undo this review import?" busy={busy} onClose={() => setUndoJob(null)}>
      <p>Remove the {undoJob.count} reviews imported from {sourceLabel(undoJob.source)} in job {shortId(undoJob.id)}. Existing reviews from other imports remain.</p>
      <div className="st-actions"><button autoFocus className="st-secondary" disabled={busy} onClick={() => setUndoJob(null)}>Cancel</button><button className="st-danger" disabled={busy} onClick={() => void act(undo)}>Undo review import</button></div>
    </Dialog>}
  </section>
}
