import { humanLabel, shortId } from './presentation'
import { useEffect, useRef, useState } from 'react'
import type { Diagnostic, ImportJob, ImportPlan } from '../../modules/import-kit/src/types'
import { request, errorMessage } from './api'
import { RecordDetail, Notice, Section } from './primitives'
import { ImportJournal, type Journal } from './import-journal'
import { Dialog } from './dialog'

interface Preview { plan: ImportPlan; fingerprint: string; counts: ImportPlan['counts']; diagnostics: Diagnostic[] }

export function MoveIn({ reload }: { reload: () => Promise<void> }) {
  const [csv, setCsv] = useState('')
  const [namespace, setNamespace] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [applied, setApplied] = useState<ImportJob | null>(null)
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [journal, setJournal] = useState<Journal | null>(null)
  const [undoId, setUndoId] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function list() { const result = await request<{ jobs: ImportJob[] }>('/api/stall/imports'); setJobs(result.jobs) }
  useEffect(() => { void list().catch(error => setError(errorMessage(error))) }, [])
  async function act(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  const input = { csv, ...(namespace.trim() ? { namespace: namespace.trim() } : {}) }
  function changed() { setPreview(null); setApplied(null); setNotice('') }
  async function dryRun() { setPreview(await request<Preview>('/api/stall/imports/preview', input)); setApplied(null) }
  async function apply() {
    if (!preview) return
    const job = await request<ImportJob>('/api/stall/imports/apply', { ...input, fingerprint: preview.fingerprint })
    setApplied(job)
    setNotice(job.state === 'completed' ? 'Import completed. Products are staged for review.' : `Import is ${humanLabel(job.state)}: ${job.checkpoint} / ${job.total}. Use Resume apply to continue the next batch.`)
    await list(); await reload()
  }
  async function undo(id: string) {
    await request(`/api/stall/imports/${encodeURIComponent(id)}/undo`, {})
    const next = await request<Journal>(`/api/stall/imports/${encodeURIComponent(id)}`)
    setJournal(next); setUndoId('')
    setNotice(next.job.state === 'undone' ? 'Undo finished. Review the journal for preserved records.' : `Undo is ${humanLabel(next.job.state)}. Resume it from the journal if work remains.`)
    await list(); await reload()
  }
  async function resumeJournal() {
    if (!journal) return
    const original = journal.originals.find(original => original.kind === 'artifact' && original.original.status === 'retained')?.original
    if (!original || original.status !== 'retained') throw new Error('The original CSV is unavailable. This import cannot be resumed from its journal.')
    const bytes = Uint8Array.from(atob(original.base64), character => character.charCodeAt(0))
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const job = await request<ImportJob>('/api/stall/imports/apply', { csv: source, namespace: journal.job.namespace.replace(/:[a-f0-9]{64}$/, ''), fingerprint: journal.job.fingerprint })
    setJournal(await request<Journal>(`/api/stall/imports/${encodeURIComponent(job.id)}`))
    setNotice(job.state === 'completed' ? 'Import completed.' : `Import is ${humanLabel(job.state)}: ${job.checkpoint} / ${job.total}. Resume again to continue.`)
    await list(); await reload()
  }
  const resume = applied && !['completed', 'undone', 'rolled_back', 'undoing'].includes(applied.state)
  const canApply = preview && !preview.diagnostics.some(diagnostic => diagnostic.severity === 'error') && !applied
  return <Section id="move-in" title="Move in from Shopify">
    <p>Bring Shopify products into Stall as staged revisions. Imported products remain unpublished until a person approves them. Review a dry run before applying any changes.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <div className="st-panel st-stack">
      <div className="st-heading-row"><h2><span className="st-step-number">1.</span> Add your CSV</h2></div>
      <p className="st-small">Use a Shopify product export with Handle, Title, Body (HTML), Variant SKU, Variant Price and Published columns (only these six, in this order). Prices are imported as AUD. Review every warning; published source products are still staged for approval here.</p>
      <label>Choose a CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]
        if (file) void act(async () => { const value = await file.text(); changed(); setCsv(value) })
      }} /></label>
      <label>CSV source<textarea value={csv} rows={9} spellCheck={false} disabled={busy} onChange={event => { changed(); setCsv(event.target.value) }} /></label>
      <label>Source namespace (optional)<input value={namespace} disabled={busy} onChange={event => { changed(); setNamespace(event.target.value) }} placeholder="shopify-products" /><small>Keep the same namespace when resuming this source.</small></label>
      <div className="st-actions"><button disabled={busy || !csv.trim()} onClick={() => void act(dryRun)}>Run dry run</button></div>
      {resume && <Notice>Keep this exact CSV and reviewed fingerprint to resume job {shortId(applied.id)}. Changing the source requires a new dry run.</Notice>}
    </div>
    <div className="st-panel st-stack"><h2><span className="st-step-number">2.</span> Review & apply</h2>
      {!preview && <p>Run a dry run to review the product changes before applying them.</p>}
      {preview && <>
      <dl className="st-counts">{Object.entries(preview.counts).filter(([, value]) => typeof value === 'number').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
      {preview.diagnostics.length ? <ul className="st-diagnostics">{preview.diagnostics.map((diagnostic, index) => <li key={index}><strong>{diagnostic.severity}: {diagnostic.code}</strong><p>{diagnostic.message}</p>{diagnostic.location?.row && <small>CSV row {diagnostic.location.row}</small>}</li>)}</ul> : <p>No diagnostics reported.</p>}
      <label>Reviewed fingerprint<input readOnly value={preview.fingerprint} className="st-mono" /></label>
      <RecordDetail value={preview.plan.entries.map(entry => ({ sourceId: entry.source.sourceId, effects: entry.effects, unmapped: entry.unmapped, rejection: entry.rejection }))} label="Review planned product changes" />
      <p>Applying writes these product changes. Existing staged product details may be updated. Each request processes a bounded batch; resume until complete.</p>
      <div className="st-actions"><button disabled={busy || (!canApply && !resume)} onClick={() => void act(apply)}>{resume ? 'Resume apply' : applied?.state === 'completed' ? 'Import completed' : 'Apply reviewed import'}</button></div>
      </>}
    </div>
    <div className="st-heading-row"><h2>History</h2><button className="st-secondary" disabled={busy} onClick={() => void act(list)}>Refresh journal</button></div>
    <ImportJournal jobs={jobs} journal={journal} busy={busy} onOpen={id => void act(async () => setJournal(await request<Journal>(`/api/stall/imports/${encodeURIComponent(id)}`)))} onUndo={id => setUndoId(id)} onResume={() => void act(resumeJournal)} />
    {undoId && <Dialog title="Undo this import?" busy={busy} onClose={() => setUndoId('')}><p>Restore the before-images for job {undoId}. Later changes and orders can prevent reversal. Review the journal afterwards.</p><div className="st-actions"><button autoFocus className="st-secondary" disabled={busy} onClick={() => setUndoId('')}>Cancel</button><button className="st-danger" disabled={busy} onClick={() => { const id = undoId; setUndoId(''); void act(() => undo(id)) }}>Undo import</button></div></Dialog>}
  </Section>
}
