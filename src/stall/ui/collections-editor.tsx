import { useState, type FormEvent } from 'react'
import type { Collection, CollectionRule, Product } from './types'

type Row = { field: CollectionRule['field']; name: string; value: string }
const dollars = (cents: number) => (cents / 100).toFixed(2)
const rowOf = (rule: CollectionRule): Row => 'cents' in rule ? { field: rule.field, name: '', value: dollars(rule.cents) } : { field: rule.field, name: 'name' in rule ? rule.name : '', value: rule.value }
function ruleOf(row: Row): CollectionRule {
  if (row.field === 'price_min' || row.field === 'price_max') {
    if (!/^\d+(\.\d{1,2})?$/.test(row.value)) throw new Error('A price limit is dollars and cents.')
    return { field: row.field, cents: Math.round(Number(row.value) * 100) }
  }
  return row.field === 'attribute' ? { field: 'attribute', name: row.name.trim(), value: row.value.trim() } : { field: row.field, value: row.value.trim() }
}
const sorts = [['', 'Merchant order or name'], ['name', 'Name'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'], ['newest', 'Newest']]
export function CollectionEditor({ editing, products, busy, run, done }: { editing: { id: string; value: Collection; revision: string } | null; products: Product[]; busy: boolean; run: (type: string, payload: unknown) => Promise<boolean>; done: () => void }) {
  const start = editing?.value
  const [title, setTitle] = useState(start?.title ?? ''), [handle, setHandle] = useState(start?.handle ?? ''), [description, setDescription] = useState(start?.description ?? '')
  const [kind, setKind] = useState<Collection['kind']>(start?.kind ?? 'manual'), [published, setPublished] = useState(start?.published ?? true), [sort, setSort] = useState(start?.sort ?? '')
  const [skus, setSkus] = useState<string[]>(start?.skus ?? []), [match, setMatch] = useState(start?.match ?? 'all'), [rules, setRules] = useState<Row[]>(start?.rules?.map(rowOf) ?? [{ field: 'category', name: '', value: '' }]), [problem, setProblem] = useState('')
  const name = (sku: string) => products.find(product => product.id === sku)?.value.name ?? sku
  const move = (index: number, by: number) => { const next = [...skus]; const [moved] = next.splice(index, 1); next.splice(index + by, 0, moved); setSkus(next) }
  async function save(event: FormEvent) {
    event.preventDefault(); setProblem('')
    try { if (await run('collection.save', { handle, title, description, kind, published, ...(sort ? { sort } : {}), ...(kind === 'manual' ? { skus } : { match, rules: rules.map(ruleOf) }), ...(editing ? { revision: editing.revision } : {}) })) done() }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Review the collection.') }
  }
  return <form className="st-stack st-editor" onSubmit={event => void save(event)} aria-label={editing ? `Edit collection ${editing.id}` : 'New collection'}>
    <h3>{editing ? `Edit ${editing.value.title}` : 'New collection'}</h3>
    <div className="st-editor-grid"><label>Collection title<input required maxLength={120} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>Collection handle<input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={handle} disabled={busy || !!editing} placeholder="summer-tops" onChange={event => setHandle(event.target.value)} /></label></div>
    <label>Collection description<textarea rows={3} maxLength={1000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></label>
    <div className="st-editor-grid"><label>Collection type<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as Collection['kind'])}><option value="manual">Hand-picked products</option><option value="rule">Rule-based</option></select></label><label>Collection sort<select value={sort} disabled={busy} onChange={event => setSort(event.target.value)}>{sorts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    {kind === 'manual' ? <fieldset className="st-stack" disabled={busy}><legend>Products in this collection</legend>
      <ol className="st-picked">{skus.map((sku, index) => <li key={sku}><span>{name(sku)} <small>{sku}</small></span><button type="button" className="st-secondary" disabled={!index} onClick={() => move(index, -1)}>Move {name(sku)} earlier</button><button type="button" className="st-secondary" disabled={index === skus.length - 1} onClick={() => move(index, 1)}>Move {name(sku)} later</button><button type="button" className="st-secondary" onClick={() => setSkus(skus.filter(entry => entry !== sku))}>Remove {name(sku)}</button></li>)}</ol>
      <label>Add a product<select value="" onChange={event => event.target.value && setSkus([...skus, event.target.value])}><option value="">Choose a product…</option>{products.filter(product => !skus.includes(product.id)).map(product => <option key={product.id} value={product.id}>{product.value.name} ({product.id})</option>)}</select></label></fieldset>
      : <fieldset className="st-stack" disabled={busy}><legend>Rules</legend>
        <label>Products must match<select value={match} onChange={event => setMatch(event.target.value as 'all' | 'any')}><option value="all">All of these rules</option><option value="any">Any of these rules</option></select></label>
        {rules.map((row, index) => <div className="st-editor-grid" key={index}>
          <label>Rule {index + 1} field<select value={row.field} onChange={event => setRules(rules.map((entry, at) => at === index ? { ...entry, field: event.target.value as Row['field'] } : entry))}><option value="category">Category is</option><option value="tag">Tag is</option><option value="attribute">Attribute is</option><option value="title">Title contains</option><option value="price_min">Price at least</option><option value="price_max">Price at most</option></select></label>
          {row.field === 'attribute' && <label>Rule {index + 1} attribute name<input required value={row.name} onChange={event => setRules(rules.map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry))} /></label>}
          <label>Rule {index + 1} value{row.field.startsWith('price') ? ' · USD' : ''}<input required value={row.value} onChange={event => setRules(rules.map((entry, at) => at === index ? { ...entry, value: event.target.value } : entry))} /></label>
          <button type="button" className="st-secondary" disabled={rules.length === 1} onClick={() => setRules(rules.filter((_, at) => at !== index))}>Remove rule {index + 1}</button>
        </div>)}
        <button type="button" className="st-secondary" disabled={rules.length >= 10} onClick={() => setRules([...rules, { field: 'category', name: '', value: '' }])}>Add a rule</button></fieldset>}
    <label className="st-checkbox"><input type="checkbox" checked={published} disabled={busy} onChange={event => setPublished(event.target.checked)} />Published (shoppers can browse it; only published, sellable products ever appear)</label>
    {problem && <p role="alert" className="st-field-error">{problem}</p>}
    <div className="st-actions"><button disabled={busy}>Save collection</button><button type="button" className="st-secondary" disabled={busy} onClick={done}>Cancel</button></div>
  </form>
}
