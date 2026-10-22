import { useCan } from './authority'
// Collections, menus and search tuning: how shoppers find things in the shop.
import { useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Merchandising as Data, Product, Run } from './types'
import { Badge, Empty } from './primitives'
import { CollectionEditor } from './collections-editor'
import { MenusEditor } from './menus-editor'
import { SearchTuning } from './search-tuning'

const tabs = [['collections', 'Collections'], ['menus', 'Menus'], ['search', 'Search']] as const
export function MerchandisingView({ data, products, busy, run, canApprove }: { data: Data; products: Product[]; busy: boolean; run: Run; canApprove: boolean }) {
  const can=useCan(),shownTabs=tabs.filter(([id])=>can(id==='collections'?'collection.save':'menu.save'))
  const [tab, setTab] = useState<typeof tabs[number][0]>(can('collection.save')?'collections':'menus'), [editing, setEditing] = useState<string | 'new' | null>(null)
  if (!canApprove) return <section className="st-panel st-stack"><h2>Collections and search</h2><p>Only an owner or administrator can change how shoppers browse and search.</p></section>
  const edited = data.collections.find(entry => entry.id === editing) ?? null
  return <HydrationUnit><section className="st-orders st-stack" aria-labelledby="merch-title" id="shopfront">
    <div className="st-view-head"><h1 id="merch-title">Collections and search</h1></div>
    <nav className="st-tabs" aria-label="Shopfront sections">{shownTabs.map(([id, label]) => <button key={id} aria-current={tab === id ? 'true' : undefined} onClick={() => { setTab(id); setEditing(null) }}>{label}</button>)}</nav>
    {tab === 'collections' && (editing ? <CollectionEditor key={editing} editing={edited} products={products} busy={busy} run={run} done={() => setEditing(null)} /> : <div className="st-stack">
      <div className="st-actions"><button disabled={busy} onClick={() => setEditing('new')}>New collection</button></div>
      {!data.collections.length ? <Empty><h3>Group products into collections</h3><p>Hand-pick products or set rules, and shoppers browse them by name.</p></Empty>
        : <div className="st-table-wrap"><table><caption className="st-sr-only">Collections</caption><thead><tr><th scope="col">Collection</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col"><span className="st-sr-only">Actions</span></th></tr></thead><tbody>{data.collections.map(entry => <tr key={entry.id}>
          <td><strong>{entry.value.title}</strong><small> /shop?collection={entry.id}</small></td><td>{entry.value.kind === 'manual' ? `Hand-picked · ${entry.value.skus?.length ?? 0} products` : `Rules · ${entry.value.rules?.length ?? 0}`}</td><td><Badge value={entry.value.published ? 'Published' : 'Inactive'} /></td>
          <td><div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => setEditing(entry.id)}>Edit<span className="st-sr-only"> {entry.value.title}</span></button><button className="st-secondary" disabled={busy} onClick={() => void run('collection.delete', { handle: entry.id, revision: entry.revision })}>Remove<span className="st-sr-only"> {entry.value.title}</span></button></div></td></tr>)}</tbody></table></div>}
    </div>)}
    {tab === 'menus' && <MenusEditor key={data.config.revisions.menus ?? 'new'} revision={data.config.revisions.menus} menus={data.config.value.menus} collections={data.collections} products={products} busy={busy} run={run} />}
    {tab === 'search' && <SearchTuning key={`${data.config.revisions.synonyms}${data.config.revisions.pins}`} merchandising={data} products={products} busy={busy} run={run} />}
  </section></HydrationUnit>
}
