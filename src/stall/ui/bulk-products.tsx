import { useEffect, useRef, useState } from 'react'
import type { Diagnostic, ImportJob, ImportPlan } from '../../modules/import-kit/src/types'
import { ProductDetailsEditor, useProductDetails } from './product-details'
import { ListingEditor, useListing } from './listing-editor'
import type { ProductDetails } from '../product-details'
import type { Collection } from './types'
import type { Product } from './types'
import { errorMessage, money, request } from './api'
import { Notice, RecordDetail, Section } from './primitives'
import { humanLabel, shortId } from './presentation'

type Row = { sku: string; selected: boolean; name: string; description: string; price: string; publication: string; publishAt: string }
type Preview = { reviewToken?: string; plan: ImportPlan; fingerprint: string; diagnostics: Diagnostic[] }
const csvCell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
type CollectionRow = { id: string; selected: boolean; title: string; description: string; published: boolean; kind: 'manual' | 'rule'; skus: string; rules: string; match: 'all' | 'any' }
function BulkDetails({ product, readers, invalidate }: { product: Product; readers: React.RefObject<Record<string, () => ProductDetails>>; invalidate: () => void }) {
 const initial = (product.value.draft ?? product.value).details
 const facts = useProductDetails(initial), listing = useListing(initial)
 readers.current[product.id] = () => ({ ...facts.read(), ...listing.read() })
 return <div onChangeCapture={invalidate} onClickCapture={event => { if ((event.target as HTMLElement).closest('button')) invalidate() }}><ProductDetailsEditor input={facts} busy={false} /><ListingEditor input={listing} sku={product.id} busy={false} /></div>
}

/** Bounded bulk edits use the same exact-review, custody and undo engine as CSV. */
export function BulkProducts({ products, reload, close }: { products: Product[]; reload: () => Promise<void>; close: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => products.map(product => ({ sku: product.id, selected: false,
    name: product.value.name, description: product.value.description, price: (product.value.unitCents / 100).toFixed(2), publication: product.value.archived ? 'archived' : product.value.active ? 'published' : 'draft', publishAt: product.value.publishAt ?? '' })))
  const [preview, setPreview] = useState<Preview | null>(null), [csv, setCsv] = useState(''), [job, setJob] = useState<ImportJob | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false), readers = useRef<Record<string, () => ProductDetails>>({})
  const [collections, setCollections] = useState<CollectionRow[]>([])
  useEffect(() => { void request<{ merchandising?: { collections: { id: string; value: Collection }[] } }>('/api/stall/state').then(state => setCollections((state.merchandising?.collections ?? []).map(({ id, value }) => ({ id, selected: false, title: value.title, description: value.description, published: value.published, kind: value.kind, skus: (value.skus ?? []).join(', '), rules: JSON.stringify(value.rules ?? []), match: value.match ?? 'all' })))).catch(cause => setError(errorMessage(cause))) }, [])
  function invalidate() { setPreview(null); setJob(null); setNotice('') }
  function collectionEdit(index: number, patch: Partial<CollectionRow>) { setCollections(current => current.map((row, at) => at === index ? { ...row, ...patch } : row)); invalidate() }

  const selected = rows.filter(row => row.selected), selectedCollections = collections.filter(row => row.selected), total = selected.length + selectedCollections.length, valid = total > 0 && total <= 200 && selected.every(row =>
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
    const entries: unknown[][] = selected.map(row => ['product', row.sku, { sku: row.sku, name: row.name.trim(), description: row.description.trim(), unitCents: Math.round(Number(row.price) * 100), active: row.publication === 'published', stockMode: 'pier', details: readers.current[row.sku]?.() ?? {}, ...(row.publication === 'archived' ? { archived: true } : {}), ...(row.publishAt && row.publication === 'published' ? { publishAt: row.publishAt } : {}) }])
    for (const row of selectedCollections) entries.push(['collection', row.id, { handle: row.id, title: row.title, description: row.description, published: row.published, kind: row.kind, ...(row.kind === 'manual' ? { skus: row.skus.split(',').map(value => value.trim()).filter(Boolean) } : { rules: JSON.parse(row.rules), match: row.match }) }])
    const csv = 'Record Type,ID,Value\n' + entries.map(row => row.map(value => csvCell(typeof value === 'object' ? JSON.stringify(value) : String(value))).join(',')).join('\n') + '\n'

    const result = await request<Preview>('/api/stall/imports/preview', { csv, namespace: 'stall-catalog-bulk' })
    setCsv(csv); setPreview(result); setJob(null)
  }
  async function apply() {
    if (!preview) return
    const result = await request<ImportJob>('/api/stall/imports/apply', { csv, namespace: 'stall-catalog-bulk', fingerprint: preview.fingerprint, reviewToken: preview.reviewToken })
    setJob(result)
    setNotice(result.state === 'completed' ? 'Bulk edit completed. The exact reviewed catalog and publication changes are saved.' : `Bulk edit is ${humanLabel(result.state)}: ${result.checkpoint} / ${result.total}. Resume the reviewed edit to continue.`)
    await reload()
  }
  const changes = preview?.plan.entries.filter(entry => entry.effects.some(effect => effect.targetKind === 'product')).flatMap(entry => entry.effects.map(effect => ({
    after: effect.value as unknown as Product['value'],
    before: (entry.source.payload as unknown as { previous: { value: Product['value'] } | null }).previous?.value,
  }))) ?? []
  const unfinished = job && ['queued', 'applying', 'failed'].includes(job.state)
  return <Section title="Bulk edit staged products">
    <p>Edit up to 200 products and collections together. Review complete replacements, including variants, details and publication, before applying. Only Pier-tracked stock is available; quantities stay with the stock authority. Published variants must be active in Pier. Native orders keep their purchased descriptions and prices.</p>
    <p className="st-small">Every apply retains its original rows and before-images in the <a href="#move-in">Move in import journal</a>. Resume or undo there after leaving this editor. Later native edits, publication or orders protect products from undo.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <form className="st-stack" onSubmit={event => { event.preventDefault(); void act(review) }}>
      <fieldset disabled={busy || !!job}><legend>Select catalog records and edit their values</legend>
        {rows.map((row, index) => <div className="st-panel st-stack" key={row.sku}>
          <label className="st-checkbox"><input type="checkbox" checked={row.selected} onChange={event => edit(index, { selected: event.target.checked })} />Select {row.sku}</label>
          {row.selected && <>
            <label>Product name · {row.sku}<input required maxLength={160} value={row.name} onChange={event => edit(index, { name: event.target.value })} /></label>
            <label>Description · {row.sku}<textarea rows={3} maxLength={4000} value={row.description} onChange={event => edit(index, { description: event.target.value })} /></label>
            <label>Unit price · USD · {row.sku}<input required inputMode="decimal" value={row.price} onChange={event => edit(index, { price: event.target.value })} /><small>Positive dollars and cents, at most two decimal places.</small></label>
            <label>Publication · {row.sku}<select aria-label={`Publication · ${row.sku}`} value={row.publication} onChange={event => edit(index, { publication: event.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
            {row.publication === 'published' && <label>Publish at · {row.sku}<input value={row.publishAt} placeholder="Now, or an ISO date and time" onChange={event => edit(index, { publishAt: event.target.value })} /></label>}
            <label>Stock mode · {row.sku}<select aria-label={`Stock mode · ${row.sku}`} value="pier" onChange={() => {}}><option value="pier">Pier-tracked</option></select></label>
            <BulkDetails product={products.find(product => product.id === row.sku)!} readers={readers} invalidate={invalidate} />
          </>}
        </div>)}
        {collections.map((row, index) => <div className="st-panel st-stack" key={`collection:${row.id}`}>
          <label className="st-checkbox"><input type="checkbox" checked={row.selected} onChange={event => collectionEdit(index, { selected: event.target.checked })} />Select collection {row.id}</label>
          {row.selected && <>
            <label>Collection title · {row.id}<input value={row.title} required onChange={event => collectionEdit(index, { title: event.target.value })} /></label>
            <label>Collection description · {row.id}<textarea value={row.description} onChange={event => collectionEdit(index, { description: event.target.value })} /></label>
            <label className="st-checkbox"><input type="checkbox" checked={row.published} onChange={event => collectionEdit(index, { published: event.target.checked })} />Publish collection {row.id}</label>
            <label>Collection type · {row.id}<select value={row.kind} onChange={event => collectionEdit(index, { kind: event.target.value as CollectionRow['kind'] })}><option value="manual">Hand-picked products</option><option value="rule">Rule-based</option></select></label>
            {row.kind === 'manual' ? <label>Product SKUs · {row.id}<input value={row.skus} onChange={event => collectionEdit(index, { skus: event.target.value })} /><small>Separate product SKUs with commas.</small></label> : <><label>Collection rules · {row.id}<textarea value={row.rules} onChange={event => collectionEdit(index, { rules: event.target.value })} /></label><label>Rules match · {row.id}<select value={row.match} onChange={event => collectionEdit(index, { match: event.target.value as 'all' | 'any' })}><option value="all">All</option><option value="any">Any</option></select></label></>}
          </>}
        </div>)}

      </fieldset>
      <div className="st-actions"><button disabled={busy || !valid || !!job}>Review bulk edit ({total})</button><button type="button" className="st-secondary" disabled={busy} onClick={close}>Back to products</button></div>
    </form>
    {preview && <div className="st-panel st-stack" aria-label="Reviewed bulk changes">
      <h2>Review exact changes</h2>
      {changes.map(({ before, after }) => <div key={after.sku}>
        <h3>{after.sku}</h3><p>{before?.name} → {after.name}</p><p>{before ? money(before.unitCents) : 'New product'} → {money(after.unitCents)}</p>
        <p className="st-small">Description before: {before?.description || '(empty)'}</p><p className="st-small">Description after: {after.description || '(empty)'}</p>
      </div>)}
      {preview.plan.entries.filter(entry => entry.effects.some(effect => effect.targetKind === 'collection')).map(entry => <p key={entry.source.sourceId}>Collection {entry.source.sourceId}: review its complete before-image and replacement below.</p>)}
      <ul>{preview.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul>
      <label>Reviewed fingerprint<input readOnly value={preview.fingerprint} /></label>
      <RecordDetail label="Reviewed before-images and row outcomes" value={preview.plan.entries} />
      {job && <p role="status">Job {shortId(job.id)} · {humanLabel(job.state)} · {job.checkpoint} / {job.total}</p>}
      <div className="st-actions"><button disabled={busy || (!!job && !unfinished) || preview.diagnostics.some(item => item.severity === 'error')} onClick={() => void act(apply)}>{unfinished ? 'Resume reviewed bulk edit' : job?.state === 'completed' ? 'Bulk edit completed' : 'Apply reviewed bulk edit'}</button></div>
    </div>}
    {!rows.length && <button className="st-secondary" onClick={close}>Back to products</button>}
  </Section>
}
