import { useState } from 'react'
import type { Collection, MenuItem, Product } from './types'

type Row = { label: string; type: 'collection' | 'product' | 'link'; target: string; children: Row[] }
const rowOf = (item: MenuItem): Row => ({ label: item.label, type: item.to.type, target: item.to.type === 'link' ? item.to.href : item.to.handle, children: item.children?.map(rowOf) ?? [] })
const itemOf = (row: Row): MenuItem => ({ label: row.label.trim(), to: row.type === 'link' ? { type: 'link', href: row.target.trim() } : { type: row.type, handle: row.target }, ...(row.children.length ? { children: row.children.map(itemOf) } : {}) })
const blank = (): Row => ({ label: '', type: 'link', target: '/shop', children: [] })
function Line({ row, set, remove, label, collections, products, busy, nested }: { row: Row; set: (row: Row) => void; remove: () => void; label: string; collections: { id: string; value: Collection }[]; products: Product[]; busy: boolean; nested?: boolean }) {
  return <div className={`st-menu-row${nested ? ' is-nested' : ''}`}><div className="st-editor-grid">
    <label>{label} label<input required maxLength={60} value={row.label} disabled={busy} onChange={event => set({ ...row, label: event.target.value })} /></label>
    <label>{label} goes to<select value={row.type} disabled={busy} onChange={event => set({ ...row, type: event.target.value as Row['type'], target: event.target.value === 'link' ? '/shop' : '' })}><option value="link">A page or address</option><option value="collection">A collection</option><option value="product">A product</option></select></label>
    {row.type === 'link' ? <label>{label} address<input required value={row.target} disabled={busy} onChange={event => set({ ...row, target: event.target.value })} /></label>
      : <label>{label} destination<select required value={row.target} disabled={busy} onChange={event => set({ ...row, target: event.target.value })}><option value="">Choose…</option>{row.type === 'collection' ? collections.map(entry => <option key={entry.id} value={entry.id}>{entry.value.title}</option>) : products.map(product => <option key={product.id} value={product.value.details?.handle ?? product.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>{product.value.name}</option>)}</select></label>}
    <button type="button" className="st-secondary" disabled={busy} onClick={remove}>Remove {label}</button></div>
    {!nested && <div className="st-menu-children">{row.children.map((child, index) => <Line key={index} nested label={`${label} sub-item ${index + 1}`} row={child} collections={collections} products={products} busy={busy} set={next => set({ ...row, children: row.children.map((entry, at) => at === index ? next : entry) })} remove={() => set({ ...row, children: row.children.filter((_, at) => at !== index) })} />)}
      <button type="button" className="st-secondary" disabled={busy || row.children.length >= 12} onClick={() => set({ ...row, children: [...row.children, blank()] })}>Add a sub-item under {label}</button></div>}
  </div>
}
export function MenusEditor({ menus, revision, collections, products, busy, run }: { revision?: string; menus: { main: MenuItem[]; footer: MenuItem[] }; collections: { id: string; value: Collection }[]; products: Product[]; busy: boolean; run: (type: string, payload: unknown) => Promise<boolean> }) {
  const [name, setName] = useState<'main' | 'footer'>('main'), [rows, setRows] = useState<Record<'main' | 'footer', Row[]>>({ main: menus.main.map(rowOf), footer: menus.footer.map(rowOf) })
  const list = rows[name], set = (next: Row[]) => setRows({ ...rows, [name]: next })
  return <form className="st-stack" aria-label="Shop menus" onSubmit={event => { event.preventDefault(); void run('menu.save', { name, items: list.map(itemOf), ...(revision ? { revision } : {}) }) }}>
    <h3>Menus</h3><p className="st-small">The main menu leads the shop header; the footer menu sits at the bottom. A destination that is not published is left out for shoppers.</p>
    <label>Menu<select value={name} disabled={busy} onChange={event => setName(event.target.value as 'main' | 'footer')}><option value="main">Main menu</option><option value="footer">Footer menu</option></select></label>
    {list.map((row, index) => <Line key={index} label={`Item ${index + 1}`} row={row} collections={collections} products={products} busy={busy} set={next => set(list.map((entry, at) => at === index ? next : entry))} remove={() => set(list.filter((_, at) => at !== index))} />)}
    <button type="button" className="st-secondary" disabled={busy || list.length >= 12} onClick={() => set([...list, blank()])}>Add a menu item</button>
    <div className="st-actions"><button disabled={busy}>Save {name} menu</button></div>
  </form>
}
