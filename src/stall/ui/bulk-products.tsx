import { useRef, useState } from 'react'
import type { Diagnostic, ImportJob, ImportPlan } from '../../modules/import-kit/src/types'
import type { Product, Merchandising } from './types'
import { errorMessage, money, request } from './api'
import { Notice, RecordDetail, Section } from './primitives'
import { ProductDetailsEditor, useProductDetails } from './product-details'
import { ListingEditor, useListing } from './listing-editor'
import { listingState } from '../listing'
import type { ProductDetails } from '../product-details'
import { humanLabel, shortId } from './presentation'

type Row = { sku: string; selected: boolean; name: string; description: string; price: string; publication: string; publishAt: string }
type Preview = { reviewedAt?: string; plan: ImportPlan; fingerprint: string; diagnostics: Diagnostic[] }
const csvCell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
// The shared import accepts HTML descriptions. Encode native plain text before
// crossing that boundary so literal markup is preserved, never interpreted.
const htmlText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
function source(rows: Row[]) {
  return 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\n' + rows.filter(row => row.selected).map((row, index) =>
    [`bulk-${index + 1}`, row.name, htmlText(row.description), row.sku, row.price, 'FALSE'].map(csvCell).join(',')).join('\n') + '\n'
}

function RichFields({ product, busy, read }: { product: Product; busy: boolean; read: (getter: () => ProductDetails) => void }) {
  const initial = (product.value.draft ?? product.value).details
  const details = useProductDetails(initial), listing = useListing(initial)
  read(() => ({ ...details.read(), ...listing.read() }))
  return <><ProductDetailsEditor input={details} busy={busy} /><ListingEditor input={listing} sku={product.id} busy={busy} /></>
}

/** Bounded bulk edits use the same exact-review, custody and undo engine as CSV. */
export function BulkProducts({ products, collections = [], reload, close }: { products: Product[]; collections?: Merchandising['collections']; reload: () => Promise<void>; close: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => products.map(product => ({ sku: product.id, selected: false,
    name: product.value.name, description: product.value.description, price: (product.value.unitCents / 100).toFixed(2), publication: listingState(product.value), publishAt: product.value.publishAt ?? '' })))
  const [preview, setPreview] = useState<Preview | null>(null), [csv, setCsv] = useState(''), [job, setJob] = useState<ImportJob | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [native, setNative] = useState(false)
  const [collectionRows, setCollectionRows] = useState(() => collections.map(entry => ({ ...entry, selected: false })))
  const readers = useRef(new Map<string, () => ProductDetails>())
  const lock = useRef(false)
  const selected = rows.filter(row => row.selected), selectedCollections = native ? collectionRows.filter(row => row.selected) : [], total = selected.length + selectedCollections.length
  const valid = total > 0 && total <= 200 && selected.every(row =>
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
    const nativeRows = native ? [
      ...selected.map(row => ['product', row.sku, JSON.stringify({ sku: row.sku, name: row.name, description: row.description, unitCents: Math.round(Number(row.price) * 100), stockMode: 'pier', publication: row.publication, ...(row.publication === 'scheduled' ? { publishAt: row.publishAt } : {}), details: readers.current.get(row.sku)?.() ?? {} })]),
      ...selectedCollections.map(row => ['collection', row.id, JSON.stringify(row.value)]),
    ] : []
    const csv = native ? 'Kind,ID,Value\n' + nativeRows.map(row => row.map(csvCell).join(',')).join('\n') + '\n' : source(rows)
    const result = await request<Preview>('/api/stall/imports/preview', { csv, namespace: 'stall-catalog-bulk' })
    setCsv(csv); setPreview(result); setJob(null)
  }
  async function apply() {
    if (!preview) return
    const result = await request<ImportJob>('/api/stall/imports/apply', { csv, namespace: 'stall-catalog-bulk', fingerprint: preview.fingerprint, reviewedAt: preview.reviewedAt })
    setJob(result)
    setNotice(result.state === 'completed' ? native ? 'Bulk edit completed. The exact reviewed catalog changes are applied.' : 'Bulk edit completed. Products remain unpublished; prepare and approve publication separately.' : `Bulk edit is ${humanLabel(result.state)}: ${result.checkpoint} / ${result.total}. Resume the reviewed edit to continue.`)
    await reload()
  }
  const changes = preview?.plan.entries.flatMap(entry => entry.effects.filter(effect => effect.targetKind === 'product').map(effect => ({
    after: effect.value as unknown as Product['value'],
    before: (entry.source.payload as unknown as { previous: { value: Product['value'] } | null }).previous?.value,
  }))) ?? []
  const unfinished = job && ['queued', 'applying', 'failed'].includes(job.state)
  function invalidate() { setPreview(null); setJob(null); setNotice('') }
  function collectionEdit(index: number, patch: Partial<Merchandising['collections'][number]['value']>) {
    setCollectionRows(collectionRows.map((row, at) => at === index ? { ...row, value: { ...row.value, ...patch } } : row)); invalidate()
  }
  return <Section title="Bulk edit staged products">
    <p>Review up to 200 selected product and collection records together. Basic edits stage names, descriptions and USD prices on unpublished products. Complete catalog edits also carry variants, optional details, collection membership and publication. Applying complete catalog changes approves the exact reviewed values; published variants must exist in Pier.</p>
    <p className="st-small">Original rows, before-images and outcomes stay in the Move in journal. Resume or undo there after leaving this editor. Later native edits and purchases protect their records from undo.</p>
    <label className="st-checkbox"><input type="checkbox" checked={native} disabled={busy || !!job} onChange={event => { setNative(event.target.checked); invalidate() }} />Edit complete catalog fields</label>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {!rows.length && !collectionRows.length ? <p>No products or collections are available for bulk editing.</p> : <form className="st-stack" onSubmit={event => { event.preventDefault(); void act(review) }}>
      <fieldset disabled={busy || !!job} onChange={invalidate}><legend>Select products and edit their staged values</legend>
        {rows.map((row, index) => (native || !products[index].value.active) && <div className="st-panel st-stack" key={row.sku} aria-label={`Bulk product ${row.sku}`}>
          <label className="st-checkbox"><input type="checkbox" checked={row.selected} onChange={event => edit(index, { selected: event.target.checked })} />Select {row.sku}</label>
          {row.selected && <>
            <label>Product name · {row.sku}<input required maxLength={160} value={row.name} onChange={event => edit(index, { name: event.target.value })} /></label>
            <label>Description · {row.sku}<textarea rows={3} maxLength={4000} value={row.description} onChange={event => edit(index, { description: event.target.value })} /></label>
            <label>Unit price · USD · {row.sku}<input required inputMode="decimal" value={row.price} onChange={event => edit(index, { price: event.target.value })} /><small>Positive dollars and cents, at most two decimal places.</small></label>
            {native && <>
              <label>Publication · {row.sku}<select value={row.publication} onChange={event => edit(index, { publication: event.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="scheduled">Scheduled</option><option value="archived">Archived</option></select></label>
              {row.publication === 'scheduled' && <label>Publish time · {row.sku}<input required type="datetime-local" value={row.publishAt.slice(0, 16)} onChange={event => edit(index, { publishAt: new Date(event.target.value).toISOString() })} /></label>}
              <label>Stock mode · {row.sku}<select value="pier" disabled><option value="pier">Pier-tracked</option></select></label>
              <RichFields product={products[index]} busy={busy} read={getter => readers.current.set(row.sku, getter)} />
            </>}
          </>}
        </div>)}
        {native && collectionRows.map((row, index) => <div className="st-panel st-stack" key={row.id} aria-label={`Bulk collection ${row.id}`}>
          <label className="st-checkbox"><input type="checkbox" checked={row.selected} onChange={event => { setCollectionRows(collectionRows.map((entry, at) => at === index ? { ...entry, selected: event.target.checked } : entry)); invalidate() }} />Select collection {row.id}</label>
          {row.selected && <>
            <label>Collection title · {row.id}<input required maxLength={120} value={row.value.title} onChange={event => collectionEdit(index, { title: event.target.value })} /></label>
            <label>Collection description · {row.id}<textarea maxLength={1000} value={row.value.description} onChange={event => collectionEdit(index, { description: event.target.value })} /></label>
            {row.value.kind === 'manual' && <label>Collection products · {row.id}<input value={row.value.skus?.join(', ') ?? ''} onChange={event => collectionEdit(index, { skus: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /><small>Product SKUs, separated by commas.</small></label>}
            <label>Collection sort · {row.id}<select value={row.value.sort ?? 'name'} onChange={event => collectionEdit(index, { sort: event.target.value })}><option value="manual">Merchant order</option><option value="name">Name</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option><option value="newest">Newest</option></select></label>
            <label className="st-checkbox"><input type="checkbox" checked={row.value.published} onChange={event => collectionEdit(index, { published: event.target.checked })} />Published collection · {row.id}</label>
          </>}
        </div>)}
      </fieldset>
      <div className="st-actions"><button disabled={busy || !valid || !!job}>Review bulk edit ({total})</button><button type="button" className="st-secondary" disabled={busy} onClick={close}>Back to products</button></div>
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
