import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Product, ProductValue, Run } from './types'
import { money } from './api'
import { Badge, Empty, Section } from './primitives'
import { businessTime, shortId, usePerson } from './presentation'
const blank: ProductValue = { sku: '', name: '', description: '', unitCents: 0, active: true }
export function Products({ products, busy, run, canApprove }: { products: Product[]; busy: boolean; run: Run; canApprove: boolean }) {
  const person = usePerson()
  const [editing, setEditing] = useState<Product | null>(null), [value, setValue] = useState<ProductValue>(blank), [price, setPrice] = useState('')
  const cents = Math.round(Number(price) * 100)
  const validPrice = /^\d+(\.\d{1,2})?$/.test(price) && Number.isSafeInteger(cents) && cents > 0
  async function prepare(event: FormEvent) {
    event.preventDefault()
    if (!validPrice) return
    if (await run('product.prepare', { ...value, unitCents: cents, ...(editing ? { revision: editing.revision } : {}) })) { setEditing(null); setValue(blank); setPrice('') }
  }
  return <><Section id="products" title="Products & publication">
    <p>Prepare a product revision, review its exact price and availability, then approve that revision to publish it in the shop.</p>
    {!products.length && <Empty><h3>Bring your products into Stall</h3><p><a href="#move-in">Import a Shopify product CSV</a>, or prepare a product below. <a href="#connections">Connect Pier and Stripe</a> before taking orders.</p></Empty>}
    <div className="st-product-grid">{products.map(product => <div className="st-product st-stack" key={product.id}><div className="st-row"><h3>{product.value.name}</h3><Badge value={product.value.approval ? product.value.active ? 'Published' : 'Inactive' : 'Staged'} /></div><small>{product.id} · revision {shortId(product.revision)}</small><p>{product.value.description}</p><strong>{money(product.value.unitCents)}</strong>
      {product.value.approval && <p className="st-small">Published by {person(product.value.approval.by)} · {businessTime(product.value.approval.at)} · revision {shortId(product.value.approval.revision)}</p>}
      {product.value.draft && <div className="st-review st-stack"><h4>Revision {shortId(product.revision)} for approval</h4><p>{product.value.draft.name}</p><p>{product.value.draft.description}</p><strong>{money(product.value.draft.unitCents)} · {product.value.draft.active ? 'Active' : 'Inactive'}</strong><p className="st-small">Approving publishes these exact details.</p>{canApprove && <button disabled={busy} onClick={() => void run('product.approve', { sku: product.id, revision: product.revision })}>Approve & publish revision {shortId(product.revision)}</button>}</div>}
      <button className="st-secondary" disabled={busy} onClick={() => { setEditing(product); setValue(product.value.draft ?? product.value); setPrice(((product.value.draft ?? product.value).unitCents / 100).toFixed(2)); document.getElementById('product-editor')?.scrollIntoView({ behavior: 'smooth' }) }}>Edit product</button>
    </div>)}</div>
  </Section><HydrationUnit><form id="product-editor" className="st-panel st-stack" onSubmit={event => void prepare(event)}><h2>{editing ? `Prepare changes to ${editing.id}` : 'Prepare a product'}</h2><div className="st-form-grid"><label>SKU<input required maxLength={100} value={value.sku} disabled={busy || !!editing} onChange={event => setValue({ ...value, sku: event.target.value })} /></label><label>Product name<input required maxLength={200} value={value.name} disabled={busy} onChange={event => setValue({ ...value, name: event.target.value })} /></label><label>Unit price · USD<input required inputMode="decimal" value={price} disabled={busy} onChange={event => setPrice(event.target.value)} placeholder="0.00" aria-describedby="price-help" /></label></div><small id="price-help">Enter dollars and cents, with at most two decimal places.</small><label>Description<textarea rows={3} value={value.description} disabled={busy} maxLength={4000} onChange={event => setValue({ ...value, description: event.target.value })} /></label><label className="st-checkbox"><input type="checkbox" checked={value.active} disabled={busy} onChange={event => setValue({ ...value, active: event.target.checked })} />Available for publication</label><div className="st-actions"><button disabled={busy || !validPrice}>Prepare revision</button>{editing && <button className="st-secondary" type="button" disabled={busy} onClick={() => { setEditing(null); setValue(blank); setPrice('') }}>Cancel edit</button>}</div></form>
  </HydrationUnit></>
}
