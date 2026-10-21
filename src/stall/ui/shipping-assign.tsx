import { useRef, useState } from 'react'
import type { ShippingState } from './types'
import { errorMessage, request } from './api'
import { Notice } from './primitives'

type Change = { sku: string; name: string; from: string; to: string }
type Review = { changes: Change[]; fingerprint: string; unchanged: number }
const send = <T,>(payload: unknown) => request<{ result: T }>('/api/stall/commands', { type: 'shipping.assign', payload }).then(reply => reply.result)
/** Bulk assignment, by grid or by catalog CSV: review the exact changes, then apply the reviewed fingerprint. */
export function AssignProducts({ data, reload }: { data: ShippingState; reload: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]), [profile, setProfile] = useState('general'), [csv, setCsv] = useState('SKU,Shipping Profile\n')
  const [review, setReview] = useState<{ body: Record<string, unknown>; result: Review } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), lock = useRef(false)
  const nameOf = (profileId: string) => data.profiles.find(entry => entry.id === profileId)?.value.name ?? profileId
  async function act(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { lock.current = false; setBusy(false) }
  }
  const preview = (body: Record<string, unknown>) => act(async () => { setReview({ body, result: await send<Review>(body) }) })
  const apply = () => act(async () => {
    if (!review) return
    const done = await send<{ applied: number }>({ ...review.body, fingerprint: review.result.fingerprint })
    setReview(null); setSelected([]); setNotice(`${done.applied} assignment${done.applied === 1 ? '' : 's'} saved. Open shipping quotes were invalidated; shoppers see new rates on their next quote.`); await reload()
  })
  return <div className="st-stack">
    <p>Assign products and variants to a shipping profile. Choosing a product covers all its variants; a variant's own assignment wins. Each change is reviewed before it applies, and open quotes for these items are invalidated. Paid orders keep the profile revision and charge they were sold under.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <form className="st-stack" onSubmit={event => { event.preventDefault(); void preview({ assignments: selected.map(sku => ({ sku, profile })) }) }}>
      <fieldset disabled={busy} className="st-stack"><legend>Select products or variants</legend>
        <div className="st-table-wrap"><table><caption className="st-sr-only">Products and their shipping profiles</caption><thead><tr><th scope="col">Select</th><th scope="col">Product</th><th scope="col">Profile</th></tr></thead><tbody>{data.skus.map(item => <tr key={item.sku}>
          <td><label className="st-checkbox"><input type="checkbox" checked={selected.includes(item.sku)} onChange={event => { setReview(null); setSelected(event.target.checked ? [...selected, item.sku] : selected.filter(sku => sku !== item.sku)) }} /><span className="st-sr-only">Select {item.sku}</span></label></td>
          <td>{item.name} <small>{item.sku}</small></td><td>{nameOf(data.assignments[item.sku] ?? 'general')}</td></tr>)}</tbody></table></div>
        <label>Move the selected items to<select value={profile} onChange={event => { setReview(null); setProfile(event.target.value) }}>{data.profiles.map(entry => <option key={entry.id} value={entry.id}>{entry.value.name}</option>)}</select></label>
      </fieldset>
      <div className="st-actions"><button disabled={busy || !selected.length}>Review assignment ({selected.length})</button></div>
    </form>
    <form className="st-stack" onSubmit={event => { event.preventDefault(); void preview({ csv }) }}><h3>Assign by catalog CSV</h3>
      <label>Catalog CSV (headers SKU,Shipping Profile; the profile is its ID, such as general)<textarea rows={5} value={csv} disabled={busy} onChange={event => { setReview(null); setCsv(event.target.value) }} /></label>
      <div className="st-actions"><button disabled={busy}>Review CSV</button></div></form>
    {review && <div className="st-panel st-stack" aria-label="Reviewed assignment changes"><h3>Review exact changes</h3>
      {review.result.changes.length ? <ul>{review.result.changes.map(change => <li key={change.sku}>{change.name} <small>{change.sku}</small>: {nameOf(change.from)} → {nameOf(change.to)}</li>)}</ul> : <p>Every listed SKU already has that profile.</p>}
      {review.result.unchanged > 0 && <p className="st-small">{review.result.unchanged} already in the chosen profile.</p>}
      <div className="st-actions"><button disabled={busy || !review.result.changes.length} onClick={() => void apply()}>Apply reviewed assignment</button></div></div>}
  </div>
}

/** One product's shipping profile in the product editor: reviewed and applied in one step. */
export function ProductShipping({ sku, variants, data, reload }: { sku: string; variants: string[]; data: ShippingState; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const nameOf = (id: string) => data.profiles.find(entry => entry.id === id)?.value.name ?? id
  async function move(target: string, value: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const body = { assignments: [{ sku: target, profile: value }] }, review = await send<Review>(body)
      if (review.changes.length) await send({ ...body, fingerprint: review.fingerprint })
      await reload()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const select = (target: string, label: string, inherited: boolean) => <label key={target}>{label}<select value={data.assignments[target] ?? (inherited ? '' : 'general')} disabled={busy} onChange={event => void move(target, event.target.value || (data.assignments[sku] ?? 'general'))}>
    {inherited && <option value="">Same as the product</option>}{data.profiles.map(entry => <option key={entry.id} value={entry.id}>{entry.value.name}</option>)}</select></label>
  return <section className="st-panel-block" aria-label="Shipping profile"><h3>Shipping profile</h3>
    <p className="st-small">Changes apply at once and invalidate open shipping quotes. Paid orders keep the profile they were sold under.</p>
    {select(sku, `Shipping profile for ${sku}`, false)}{variants.filter(variant => variant !== sku).map(variant => select(variant, `Shipping profile for variant ${variant}`, true))}
    <p className="st-small">Now: {nameOf(data.assignments[sku] ?? 'general')}.</p>
    {error && <Notice error>{error}</Notice>}</section>
}
