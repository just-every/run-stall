import { useState, type FormEvent } from 'react'
import type { Profile, Rate, Service } from '../shipping-profiles'
import type { Run } from './types'
import { money } from './api'

type Row = { code: string; name: string; rate: Rate['type']; amount: string; tiers: string; handling: string; surcharge: string }
const dollars = (cents: number) => (cents / 100).toFixed(2)
const cents = (value: string, name: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error(`${name} must be dollars and cents.`); return Math.round(Number(value) * 100) }
export const rateSummary = (service: Service) => {
  const rate = service.rate, extra = [service.handlingCents ? `${money(service.handlingCents)} handling` : '', service.surchargeCents ? `${money(service.surchargeCents)} per item` : ''].filter(Boolean).join(', ')
  const base = rate.type === 'free' ? 'Free' : rate.type === 'flat' ? `${money(rate.cents)} flat` : rate.type === 'weight' ? `By weight (${rate.tiers.length} bands)` : `By price (${rate.tiers.length} bands)`
  return extra ? `${base}, ${extra}` : base
}
const tierText = (rate: Rate) => rate.type === 'weight' ? rate.tiers.map(tier => `${tier.upToGrams}=${dollars(tier.cents)}`).join('\n') : rate.type === 'price' ? rate.tiers.map(tier => `${dollars(tier.upToCents)}=${dollars(tier.cents)}`).join('\n') : ''
const rowOf = (service: Service): Row => ({ code: service.code, name: service.name, rate: service.rate.type, amount: service.rate.type === 'flat' ? dollars(service.rate.cents) : '', tiers: tierText(service.rate), handling: service.handlingCents ? dollars(service.handlingCents) : '', surcharge: service.surchargeCents ? dollars(service.surchargeCents) : '' })
function serviceOf(row: Row): Service {
  const lines = row.tiers.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [limit, charge] = line.split('='); if (charge === undefined) throw new Error(`Band "${line}" is limit=charge.`); return [limit.trim(), charge.trim()] })
  const rate: Rate = row.rate === 'free' ? { type: 'free' } : row.rate === 'flat' ? { type: 'flat', cents: cents(row.amount, `${row.name || row.code} rate`) }
    : row.rate === 'weight' ? { type: 'weight', tiers: lines.map(([limit, charge]) => { if (!/^\d+$/.test(limit)) throw new Error('A weight band limit is whole grams.'); return { upToGrams: Number(limit), cents: cents(charge, 'Band charge') } }) }
    : { type: 'price', tiers: lines.map(([limit, charge]) => ({ upToCents: cents(limit, 'Band limit'), cents: cents(charge, 'Band charge') })) }
  return { code: row.code.trim(), name: row.name.trim(), rate, ...(row.handling.trim() ? { handlingCents: cents(row.handling, 'Handling fee') } : {}), ...(row.surcharge.trim() ? { surchargeCents: cents(row.surcharge, 'Per-item surcharge') } : {}) }
}
const zonesText = (profile?: Profile) => profile?.zones.map(zone => `${zone.name}: ${zone.zipPrefixes.join(', ')}`).join('\n') ?? ''
function zonesOf(text: string) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const at = line.indexOf(':')
    if (at < 1) throw new Error(`Zone "${line}" is name: ZIP prefixes, such as East coast: 0, 1, 2.`)
    return { name: line.slice(0, at).trim(), zipPrefixes: line.slice(at + 1).split(',').map(prefix => prefix.trim()).filter(Boolean) }
  })
}
export function ProfileEditor({ editing, busy, run, done }: { editing: { id: string; value: Profile; revision: string } | null; busy: boolean; run: Run; done: () => void }) {
  const start = editing?.value
  const [id, setId] = useState(editing?.id ?? ''), [name, setName] = useState(start?.name ?? ''), [shipFrom, setShipFrom] = useState(start?.shipFrom ?? ''), [zones, setZones] = useState(zonesText(start))
  const [rows, setRows] = useState<Row[]>(start?.services.map(rowOf) ?? [{ code: '', name: '', rate: 'flat', amount: '', tiers: '', handling: '', surcharge: '' }]), [pickup, setPickup] = useState(start?.pickup ?? true), [delivery, setDelivery] = useState(start?.delivery ?? true), [problem, setProblem] = useState('')
  const change = (index: number, patch: Partial<Row>) => setRows(rows.map((row, at) => at === index ? { ...row, ...patch } : row))
  async function save(event: FormEvent) {
    event.preventDefault(); setProblem('')
    try { if (await run('shipping.profile.save', { id, ...(editing ? { revision: editing.revision } : {}), value: { name, ...(shipFrom.trim() ? { shipFrom } : {}), zones: zonesOf(zones), services: rows.map(serviceOf), pickup, delivery } })) done() }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Review the profile.') }
  }
  return <form className="st-stack st-editor" onSubmit={event => void save(event)} aria-label={editing ? `Edit profile ${editing.value.name}` : 'New shipping profile'}>
    <h3>{editing ? `Edit ${editing.value.name}` : 'New shipping profile'}</h3>
    <div className="st-editor-grid"><label>Profile name<input required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Profile ID<input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={id} disabled={busy || !!editing} placeholder="oversized" onChange={event => setId(event.target.value)} /></label>
      <label>Ships from<input maxLength={120} value={shipFrom} disabled={busy} placeholder="Warehouse" onChange={event => setShipFrom(event.target.value)} /></label></div>
    <label>Zones the shipped services serve (one per line, name: ZIP prefixes)<textarea rows={3} value={zones} disabled={busy} placeholder="East coast: 0, 1, 2, 3" onChange={event => setZones(event.target.value)} /></label>
    <p className="st-small">Leave zones empty to serve every US ZIP code. A prefix is one to five leading digits.</p>
    <fieldset className="st-stack" disabled={busy}><legend>Allowed shipped services</legend>
      {rows.map((row, index) => <div className="st-editor-grid" key={index}>
        <label>Service {index + 1} code<input required maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={row.code} placeholder="ups-ground" onChange={event => change(index, { code: event.target.value })} /></label>
        <label>Service {index + 1} name<input required maxLength={80} value={row.name} placeholder="UPS Ground" onChange={event => change(index, { name: event.target.value })} /></label>
        <label>Service {index + 1} rate<select value={row.rate} onChange={event => change(index, { rate: event.target.value as Rate['type'] })}><option value="flat">Flat</option><option value="free">Free</option><option value="weight">By weight</option><option value="price">By price</option></select></label>
        {row.rate === 'flat' && <label>Service {index + 1} flat charge · USD<input required inputMode="decimal" value={row.amount} onChange={event => change(index, { amount: event.target.value })} /></label>}
        {(row.rate === 'weight' || row.rate === 'price') && <label>Service {index + 1} bands (limit{row.rate === 'weight' ? ' in grams' : ' in USD'}=charge in USD, one per line)<textarea rows={3} required value={row.tiers} placeholder={row.rate === 'weight' ? '500=4.00' : '50=5.00'} onChange={event => change(index, { tiers: event.target.value })} /></label>}
        <label>Service {index + 1} handling fee · USD<input inputMode="decimal" value={row.handling} placeholder="None" onChange={event => change(index, { handling: event.target.value })} /></label>
        <label>Service {index + 1} surcharge per item · USD<input inputMode="decimal" value={row.surcharge} placeholder="None" onChange={event => change(index, { surcharge: event.target.value })} /></label>
        <button type="button" className="st-secondary" onClick={() => setRows(rows.filter((_, at) => at !== index))}>Remove service {index + 1}</button>
      </div>)}
      <div className="st-actions"><button type="button" className="st-secondary" disabled={rows.length >= 20} onClick={() => setRows([...rows, { code: '', name: '', rate: 'flat', amount: '', tiers: '', handling: '', surcharge: '' }])}>Add a service</button></div>
      <p className="st-small">With no shipped service the profile is pickup or local delivery only: a basket holding one of its items cannot ship.</p>
    </fieldset>
    <fieldset className="st-stack" disabled={busy}><legend>Other ways to receive these products</legend>
      <label className="st-checkbox"><input type="checkbox" checked={pickup} onChange={event => setPickup(event.target.checked)} />Allow local pickup</label>
      <label className="st-checkbox"><input type="checkbox" checked={delivery} onChange={event => setDelivery(event.target.checked)} />Allow local delivery</label></fieldset>
    {problem && <div className="st-notice st-error" role="alert">{problem}</div>}
    <div className="st-actions"><button disabled={busy}>Save profile</button><button type="button" className="st-secondary" disabled={busy} onClick={done}>Cancel</button></div>
  </form>
}
