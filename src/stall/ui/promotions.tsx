import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'
import { HydrationUnit } from '../../base/hydration/unit'
import { shortId, When } from './presentation'

type Promotion = { id: string; revision: string; startsAt: string; endsAt: string; minimumBasketCents: number; maxUsesPerCustomer: number; maxTotalUses: number; maxShippingDiscountCents: number; revokedAt: string | null; reservedUses: number; usedUses: number; reservedDiscountCents: number; usedDiscountCents: number }
type Data = { promotions: Promotion[]; budgetPolicy: string }
const dollars = (cents: number) => (cents / 100).toFixed(2)
const utc = (instant: string) => instant.slice(0, 16)
function PromotionEditor({ editing, busy, save, close }: { editing?: Promotion; busy: boolean; save: (body: unknown) => Promise<boolean>; close: () => void }) {
  const [code, setCode] = useState(''), [starts, setStarts] = useState(utc(editing?.startsAt ?? new Date().toISOString())), [ends, setEnds] = useState(utc(editing?.endsAt ?? new Date(Date.now() + 86400000).toISOString()))
  const [minimum, setMinimum] = useState(dollars(editing?.minimumBasketCents ?? 5000)), [budget, setBudget] = useState(dollars(editing?.maxShippingDiscountCents ?? 10000)), [customer, setCustomer] = useState(String(editing?.maxUsesPerCustomer ?? 1)), [total, setTotal] = useState(String(editing?.maxTotalUses ?? 10))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await save({ ...(editing ? { id: editing.id, revision: editing.revision } : {}), ...(!editing || code.trim() ? { code: code.trim() } : {}), startsAt: starts + ':00.000Z', endsAt: ends + ':00.000Z', minimumBasketCents: Math.round(Number(minimum) * 100), maxShippingDiscountCents: Math.round(Number(budget) * 100), maxUsesPerCustomer: Number(customer), maxTotalUses: Number(total) })) close()
  }
  return <form className="st-stack st-editor" aria-label={editing ? 'Edit promotion' : 'New promotion'} onSubmit={event => void submit(event)}>
    <h3>{editing ? `Edit promotion ${shortId(editing.id)}` : 'New free-shipping code'}</h3>
    <label>{editing ? 'Replacement code (leave blank to keep the current code)' : 'Code'}<input required={!editing} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,63}" maxLength={64} autoComplete="off" value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
    <p className="st-small">Keep a copy to share with shoppers. Saved codes cannot be read back.</p>
    <div className="st-form-grid"><label>Starts at · UTC<input required type="datetime-local" value={starts} disabled={busy} onChange={event => setStarts(event.target.value)} /></label><label>Ends at · UTC<input required type="datetime-local" value={ends} disabled={busy} onChange={event => setEnds(event.target.value)} /></label><label>Minimum merchandise subtotal · USD<input required type="number" min="0" max="999999.99" step="0.01" value={minimum} disabled={busy} onChange={event => setMinimum(event.target.value)} /></label><label>Total shipping discount budget · USD<input required type="number" min="0.01" max="999999.99" step="0.01" value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} /></label><label>Maximum checkouts per customer<input required type="number" min="1" max="1000000" step="1" value={customer} disabled={busy} onChange={event => setCustomer(event.target.value)} /></label><label>Maximum checkouts in total<input required type="number" min="1" max="1000000" step="1" value={total} disabled={busy} onChange={event => setTotal(event.target.value)} /></label></div>
    <div className="st-actions"><button disabled={busy}>Save promotion</button><button type="button" className="st-secondary" disabled={busy} onClick={close}>Cancel</button></div>
  </form>
}
export function Promotions() {
  const [data, setData] = useState<Data>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState<Promotion | null | undefined>()
  const lock = useRef(false)
  const load = async () => setData(await request<Data>('/api/stall/promotions'))
  useEffect(() => { void load().catch(error => setError(errorMessage(error))) }, [])
  async function run(path: string, body: unknown) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await request(path, body); await load(); setNotice('Promotion saved. The current limits and usage are shown.'); return true }
    catch (error) { setError(errorMessage(error)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  return <HydrationUnit><section className="st-orders st-stack" aria-labelledby="promotions-title">
    <div className="st-view-head"><h1 id="promotions-title">Promotions</h1></div>
    <p>Free-shipping codes waive the whole charge for a paid shipping service. Other discount types and campaign reports are not available yet.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {!data && !error && <p role="status">Loading promotions…</p>}
    {data && <><Notice>{data.budgetPolicy}</Notice><p>Windows below use your shop time zone. The editor uses explicitly labeled UTC times.</p>
      <div className="st-actions"><button disabled={busy} onClick={() => { setEditing(null); setNotice('') }}>New promotion</button><button className="st-secondary" disabled={busy} onClick={() => { setError(''); void load().catch(error => setError(errorMessage(error))) }}>Refresh promotions</button></div>
      {editing !== undefined && <PromotionEditor key={editing?.revision ?? 'new'} editing={editing ?? undefined} busy={busy} close={() => setEditing(undefined)} save={body => run('/api/stall/promotions', body)} />}
      {!data.promotions.length && <p>No promotions yet.</p>}
      {data.promotions.map(promotion => <article className="st-panel st-stack" key={promotion.id} aria-label={`Promotion ${promotion.id}`}>
        <h3>Free shipping · {shortId(promotion.id)}</h3><p style={{ overflowWrap: 'anywhere' }}>Reference: {promotion.id}</p>
        <p>{promotion.revokedAt ? 'Revoked' : 'Configured window'} · <When at={promotion.startsAt} /> to <When at={promotion.endsAt} /></p>
        <p>Minimum basket: {money(promotion.minimumBasketCents)} · {promotion.maxUsesPerCustomer} checkout(s) per customer · {promotion.maxTotalUses} in total</p>
        <p>Reserved: {promotion.reservedUses} ({money(promotion.reservedDiscountCents)}) · Paid: {promotion.usedUses} ({money(promotion.usedDiscountCents)})</p>
        <p>Shipping discount budget: {money(promotion.maxShippingDiscountCents)} · Remaining: {money(promotion.maxShippingDiscountCents - promotion.reservedDiscountCents - promotion.usedDiscountCents)}</p>
        {!promotion.revokedAt && <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => setEditing(promotion)}>Edit promotion</button><button className="st-secondary" disabled={busy} onClick={() => { if (confirm('Revoke this promotion? New checkouts will be refused. Existing allocations remain.')) void run('/api/stall/promotions/revoke', { id: promotion.id, revision: promotion.revision }) }}>Revoke promotion</button></div>}
      </article>)}
    </>}
  </section></HydrationUnit>
}
