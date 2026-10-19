// Products in the pick's workspace: a dense table of products and the selected
// product's panel, where a revision is prepared and a person publishes it. A
// revision the shop agent prepared carries the Agent note, as orders do.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Product, ProductValue, Run, State } from './types'
import { money } from './api'
import { Badge, Empty } from './primitives'
import { businessTime, shortDate, shortId, shortTime, usePerson, When } from './presentation'
import { Icon } from './icons'
import { BulkProducts } from './bulk-products'

const blank: ProductValue = { sku: '', name: '', description: '', unitCents: 0, active: true }
const statusOf = (product: Product) => product.value.approval ? product.value.active ? 'Published' : 'Inactive' : 'Staged'
const productTabs = [['all', 'All'], ['Published', 'Published'], ['Staged', 'Staged'], ['Inactive', 'Inactive'], ['draft', 'Awaiting approval']] as const

function Editor({ editing, busy, run, done }: { editing: Product | null; busy: boolean; run: Run; done: () => void }) {
  const start = editing ? editing.value.draft ?? editing.value : blank
  const [value, setValue] = useState<ProductValue>({ sku: start.sku, name: start.name, description: start.description, unitCents: start.unitCents, active: start.active }), [price, setPrice] = useState(editing ? (start.unitCents / 100).toFixed(2) : '')
  const cents = Math.round(Number(price) * 100), validPrice = /^\d+(\.\d{1,2})?$/.test(price) && Number.isSafeInteger(cents) && cents > 0
  async function prepare(event: FormEvent) {
    event.preventDefault()
    if (validPrice && await run('product.prepare', { ...value, unitCents: cents, ...(editing ? { revision: editing.revision } : {}) })) done()
  }
  return <form id="product-editor" className="st-stack st-editor" onSubmit={event => void prepare(event)}>
    <h3>{editing ? <>Prepare changes to <span className="st-keep">{editing.id}</span></> : 'Prepare a product'}</h3>
    <div className="st-editor-grid"><label>SKU<input required maxLength={100} value={value.sku} disabled={busy || !!editing} onChange={event => setValue({ ...value, sku: event.target.value })} /></label><label>Unit price · USD<input required inputMode="decimal" value={price} disabled={busy} onChange={event => setPrice(event.target.value)} placeholder="0.00" aria-describedby="price-help" /><small id="price-help">Dollars and cents, at most two decimal places.</small></label></div>
    <label>Product name<input required maxLength={200} value={value.name} disabled={busy} onChange={event => setValue({ ...value, name: event.target.value })} /></label>
    <label>Description<textarea rows={4} value={value.description} disabled={busy} maxLength={4000} onChange={event => setValue({ ...value, description: event.target.value })} /></label>
    <label className="st-checkbox"><input type="checkbox" checked={value.active} disabled={busy} onChange={event => setValue({ ...value, active: event.target.checked })} />Available for publication</label>
    <div className="st-actions"><button disabled={busy || !validPrice}>Prepare revision</button><button className="st-secondary" type="button" disabled={busy} onClick={done}>Cancel edit</button></div>
  </form>
}

function ProductPanel({ product, preparedBy, busy, run, canApprove, onEdit }: { product: Product; preparedBy?: { actor: string; at: string }; busy: boolean; run: Run; canApprove: boolean; onEdit: () => void }) {
  const person = usePerson(), draft = product.value.draft, agent = !!preparedBy?.actor.startsWith('agent:')
  return <div className="st-panel-body st-product">
    <div className="st-panel-head"><h2>{product.value.name}</h2><Badge value={statusOf(product)} /></div>
    <p className="st-small">{product.id} · revision {shortId(product.revision)}</p>
    <section className="st-panel-block st-sums"><p><span>Unit price · USD</span><strong>{money(product.value.unitCents)}</strong></p></section>
    {product.value.description && <section className="st-panel-block"><div className="st-row"><h3>Description</h3><button className="st-link st-edit-link" disabled={busy} onClick={onEdit}>Edit<span className="st-sr-only"> description</span></button></div><p>{product.value.description}</p></section>}
    {product.value.approval && <section className="st-panel-block"><h3>Published</h3><p className="st-small">Published by {person(product.value.approval.by)} · <When at={product.value.approval.at} /> · revision {shortId(product.value.approval.revision)}</p></section>}
    {draft && <div className="st-note"><Icon name="spark" /><div>
      <h3>{agent ? 'Agent note' : `Revision ${shortId(product.revision)} for approval`}</h3>
      {preparedBy && <p>Revision {shortId(product.revision)} prepared by {person(preparedBy.actor)} · {shortTime(preparedBy.at)}</p>}
      <p><strong>{draft.name}</strong> · {money(draft.unitCents)} · {draft.active ? 'Active' : 'Inactive'}</p>
      {draft.description && <p>{draft.description}</p>}
      <p className="st-small">Approving publishes these exact details.</p>
    </div></div>}
    <div className="st-actions st-panel-actions">{draft && canApprove && <button disabled={busy} onClick={() => void run('product.approve', { sku: product.id, revision: product.revision })}>Approve & publish revision {shortId(product.revision)}</button>}<button className="st-secondary" disabled={busy} onClick={onEdit}>Edit<span className="st-sr-only"> product</span></button></div>
  </div>
}

/** `focus` is a SKU from a link (#products/<sku>). */
export function ProductsView({ products, audit, focus, query, busy, run, canApprove, reload }: { products: Product[]; audit: State['audit']; focus?: string; query: string; busy: boolean; run: Run; canApprove: boolean; reload: () => Promise<void> }) {
  const [bulk, setBulk] = useState(false)
  const [tab, setTab] = useState<typeof productTabs[number][0]>('all'), [selectedId, setSelectedId] = useState(focus ?? ''), [editing, setEditing] = useState<Product | 'new' | null>(null)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { if (focus) { setTab('all'); setSelectedId(focus); setEditing(null) } }, [focus])
  const preparedBy = (sku: string) => audit.filter(event => event.subject === sku && event.action === 'product.prepared').sort((a, b) => b.at.localeCompare(a.at))[0]
  const q = query.trim().toLowerCase()
  const shown = products.filter(product => (tab === 'all' || (tab === 'draft' ? !!product.value.draft : statusOf(product) === tab)) && (!q || [product.id, product.value.name, product.value.description].some(text => text.toLowerCase().includes(q))))
  const selected = products.find(product => product.id === selectedId) ?? shown[0]
  function reveal() { if (matchMedia('(max-width: 1180px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start' })) }
  const draftCount = products.filter(product => product.value.draft).length
  if (bulk) return <BulkProducts products={products} reload={reload} close={() => setBulk(false)} />
  return <div className={`st-orders-layout${editing || selected ? '' : ' is-single'}`} id="products">
    <HydrationUnit><section className="st-orders" aria-labelledby="products-title">
      <div className="st-view-head"><h1 id="products-title">Products</h1><div className="st-actions">{canApprove && <button className="st-secondary" disabled={busy} onClick={() => setBulk(true)}>Bulk edit staged products</button>}<button disabled={busy} onClick={() => { setEditing('new'); reveal() }}>Prepare a product</button></div></div>
      <nav className="st-tabs" aria-label="Product status">{productTabs.map(([id, label]) => <button key={id} aria-current={tab === id ? 'true' : undefined} onClick={() => { setTab(id); setSelectedId('') }}>{label}{id === 'draft' && !!draftCount && <span className="st-tab-count">{draftCount}</span>}</button>)}</nav>
      {!products.length ? <Empty><h3>Bring your products into Stall</h3><p><a href="#move-in">Import a Shopify product CSV</a>, or prepare a product. <a href="#connections">Connect Pier and Stripe</a> before taking orders.</p></Empty>
        : !shown.length ? <p className="st-none">No products match.</p>
        : <div className="st-table-wrap"><table className="st-product-table"><caption className="st-sr-only">Products</caption>
          <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col" className="st-num">Price</th><th scope="col">Status</th><th scope="col">Published</th><th scope="col">Revision</th></tr></thead>
          <tbody>{shown.map(product => <tr key={product.id} className={product === selected && editing !== 'new' ? 'is-selected' : undefined} onClick={() => { setSelectedId(product.id); setEditing(null); reveal() }}>
            <td data-label="Product" className="st-product-cell"><button className="st-order-id st-product-name" aria-pressed={product === selected} title={product.value.name} onClick={event => { event.stopPropagation(); setSelectedId(product.id); setEditing(null); reveal() }}>{product.value.draft && <span className="st-flag" title="Revision awaiting approval" aria-hidden="true" />}<span>{product.value.name}</span></button>{product.value.description && <small title={product.value.description}>{product.value.description}</small>}</td>
            <td data-label="SKU" className="st-muted-cell st-sku st-labeled">{product.id}</td>
            <td data-label="Price" className="st-num st-money">{money(product.value.unitCents)}</td>
            <td data-label="Status"><Badge value={statusOf(product)} /></td>
            <td data-label="Published" className={`st-muted-cell st-labeled${product.value.approval ? '' : ' is-empty'}`} title={product.value.approval ? businessTime(product.value.approval.at) : undefined}>{product.value.approval ? shortDate(product.value.approval.at) : '—'}</td>
            <td data-label="Revision" className="st-labeled">{product.value.draft ? <Badge value="draft" tone="need">Draft {shortId(product.revision)}</Badge> : <span className="st-muted-cell">{shortId(product.revision)}</span>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section></HydrationUnit>
    {(editing || selected) && <HydrationUnit><aside className="st-order-panel" ref={panel} aria-label={editing === 'new' ? 'Prepare a product' : `Product ${selected?.id}`}>
      {editing ? <Editor key={editing === 'new' ? 'new' : editing.id} editing={editing === 'new' ? null : editing} busy={busy} run={run} done={() => setEditing(null)} />
        : selected && <ProductPanel product={selected} preparedBy={selected.value.draft ? preparedBy(selected.id) : undefined} busy={busy} run={run} canApprove={canApprove} onEdit={() => setEditing(selected)} />}
    </aside></HydrationUnit>}
  </div>
}
