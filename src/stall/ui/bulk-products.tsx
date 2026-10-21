import { useRef, useState } from 'react'
import type { Diagnostic, ImportJob, ImportPlan } from '../../modules/import-kit/src/types'
import type { Product } from './types'
import { errorMessage, money, request } from './api'
import { Notice, RecordDetail, Section } from './primitives'
import { humanLabel, shortId } from './presentation'

type Row = { sku: string; selected: boolean; name: string; description: string; price: string }
type Preview = { plan: ImportPlan; fingerprint: string; diagnostics: Diagnostic[] }
const csvCell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
// The shared import accepts HTML descriptions. Encode native plain text before
// crossing that boundary so literal markup is preserved, never interpreted.
const htmlText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
function source(rows: Row[]) {
  return 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\n' + rows.filter(row => row.selected).map((row, index) =>
    [`bulk-${index + 1}`, row.name, htmlText(row.description), row.sku, row.price, 'FALSE'].map(csvCell).join(',')).join('\n') + '\n'
}

/** Bounded bulk edits use the same exact-review, custody and undo engine as CSV. */
export function BulkProducts({ products, reload, close }: { products: Product[]; reload: () => Promise<void>; close: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => products.filter(product => !product.value.active).map(product => ({ sku: product.id, selected: false,
    name: product.value.name, description: product.value.description, price: (product.value.unitCents / 100).toFixed(2) })))
  const [preview, setPreview] = useState<Preview | null>(null), [csv, setCsv] = useState(''), [job, setJob] = useState<ImportJob | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false)
  const selected = rows.filter(row => row.selected), valid = selected.length > 0 && selected.length <= 200 && selected.every(row =>
    row.name.trim() && row.name.length <= 160 && row.description.length <= 4000 && /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(row.price) && Number(row.price) > 0)
  function edit(index: number, patch: Partial<Row>) {
    setRows(rows.map((row, at) => at === index ? { ...row, ...patch } : row)); setPreview(null); setJob(null); setNotice('')
  }
  async function act(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function review() {
    const csv = source(rows)
    const result = await request<Preview>('/api/stall/imports/preview', { csv, namespace: 'stall-catalog-bulk' })
    setCsv(csv); setPreview(result); setJob(null)
  }
  async function apply() {
    if (!preview) return
    const result = await request<ImportJob>('/api/stall/imports/apply', { csv, namespace: 'stall-catalog-bulk', fingerprint: preview.fingerprint })
    setJob(result)
    setNotice(result.state === 'completed' ? 'Bulk edit completed. Products remain unpublished; prepare and approve publication separately.' : `Bulk edit is ${humanLabel(result.state)}: ${result.checkpoint} / ${result.total}. Resume the reviewed edit to continue.`)
    await reload()
  }
  const changes = preview?.plan.entries.flatMap(entry => entry.effects.map(effect => ({
    after: effect.value as unknown as Product['value'],
    before: (entry.source.payload as unknown as { previous: { value: Product['value'] } | null }).previous?.value,
  }))) ?? []
  const unfinished = job && ['queued', 'applying', 'failed'].includes(job.state)
  return <Section title="Bulk edit staged products">
    <p>Edit names, plain-text descriptions and USD prices for up to 200 unpublished products (256 KiB of generated CSV per edit). Published products, products used in orders and products with current or prepared optional details cannot be changed here. Edit products with optional details in Products. Existing prepared revisions are replaced by the reviewed staged values; publication still needs its separate native approval. Descriptions trim leading and trailing whitespace; review the resulting text below.</p>
    <p className="st-small">Every apply retains its original rows and before-images in the <a href="#move-in">Move in import journal</a>. Resume or undo there after leaving this editor. Later native edits, publication or orders protect products from undo.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {!rows.length ? <p>No unpublished products are available for bulk editing.</p> : <form className="st-stack" onSubmit={event => { event.preventDefault(); void act(review) }}>
      <fieldset disabled={busy || !!job}><legend>Select products and edit their staged values</legend>
        {rows.map((row, index) => <div className="st-panel st-stack" key={row.sku}>
          <label className="st-checkbox"><input type="checkbox" checked={row.selected} onChange={event => edit(index, { selected: event.target.checked })} />Select {row.sku}</label>
          {row.selected && <>
            <label>Product name · {row.sku}<input required maxLength={160} value={row.name} onChange={event => edit(index, { name: event.target.value })} /></label>
            <label>Description · {row.sku}<textarea rows={3} maxLength={4000} value={row.description} onChange={event => edit(index, { description: event.target.value })} /></label>
            <label>Unit price · USD · {row.sku}<input required inputMode="decimal" value={row.price} onChange={event => edit(index, { price: event.target.value })} /><small>Positive dollars and cents, at most two decimal places.</small></label>
          </>}
        </div>)}
      </fieldset>
      <div className="st-actions"><button disabled={busy || !valid || !!job}>Review bulk edit ({selected.length})</button><button type="button" className="st-secondary" disabled={busy} onClick={close}>Back to products</button></div>
    </form>}
    {preview && <div className="st-panel st-stack" aria-label="Reviewed bulk changes">
      <h2>Review exact changes</h2>
      {changes.map(({ before, after }) => <div key={after.sku}>
        <h3>{after.sku}</h3><p>{before?.name} → {after.name}</p><p>{before ? money(before.unitCents) : 'New product'} → {money(after.unitCents)}</p>
        <p className="st-small">Description before: {before?.description || '(empty)'}</p><p className="st-small">Description after: {after.description || '(empty)'}</p>
      </div>)}
      <ul>{preview.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul>
      <label>Reviewed fingerprint<input readOnly value={preview.fingerprint} /></label>
      <RecordDetail label="Reviewed before-images and row outcomes" value={preview.plan.entries} />
      {job && <p role="status">Job {shortId(job.id)} · {humanLabel(job.state)} · {job.checkpoint} / {job.total}</p>}
      <div className="st-actions"><button disabled={busy || (!!job && !unfinished) || preview.diagnostics.some(item => item.severity === 'error')} onClick={() => void act(apply)}>{unfinished ? 'Resume reviewed bulk edit' : job?.state === 'completed' ? 'Bulk edit completed' : 'Apply reviewed bulk edit'}</button></div>
    </div>}
    {!rows.length && <button className="st-secondary" onClick={close}>Back to products</button>}
  </Section>
}
