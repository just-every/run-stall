import { useState, type FormEvent } from 'react'
import type { Run, ShippingState } from './types'

const dollars = (cents: number) => (cents / 100).toFixed(2)
const dollarsToCents = (value: string, name: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error(`${name} must be dollars and cents.`); return Math.round(Number(value) * 100) }
/** The store's pickup place and local-delivery area, offered to baskets whose profiles allow them. */
export function PlacesEditor({ places, busy, run }: { places: ShippingState['places']; busy: boolean; run: Run }) {
  const pickup = places.pickup?.value, delivery = places.delivery?.value
  const [name, setName] = useState(pickup?.name ?? ''), [address, setAddress] = useState(pickup?.address ?? ''), [hours, setHours] = useState(pickup?.hours ?? ''), [instructions, setInstructions] = useState(pickup?.instructions ?? '')
  const [area, setArea] = useState(delivery?.zipPrefixes.join(', ') ?? ''), [fee, setFee] = useState(delivery ? dollars(delivery.feeCents) : ''), [minimum, setMinimum] = useState(delivery ? dollars(delivery.minimumCents) : '0.00'), [note, setNote] = useState(delivery?.instructions ?? ''), [problem, setProblem] = useState('')
  async function savePickup(event: FormEvent) {
    event.preventDefault(); setProblem('')
    await run('shipping.place', { kind: 'pickup', ...(places.pickup ? { revision: places.pickup.revision } : {}), value: { name, address, ...(hours.trim() ? { hours } : {}), ...(instructions.trim() ? { instructions } : {}) } })
  }
  async function saveDelivery(event: FormEvent) {
    event.preventDefault(); setProblem('')
    try { await run('shipping.place', { kind: 'delivery', ...(places.delivery ? { revision: places.delivery.revision } : {}), value: { zipPrefixes: area.split(',').map(prefix => prefix.trim()).filter(Boolean), feeCents: dollarsToCents(fee, 'Delivery fee'), minimumCents: dollarsToCents(minimum, 'Delivery minimum'), ...(note.trim() ? { instructions: note } : {}) } }) }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Review the delivery area.') }
  }
  return <div className="st-stack">
    <p>Shoppers see pickup and local delivery when every profile in their basket allows them. Set where pickup happens and which ZIP codes you deliver to yourself.</p>
    <form className="st-stack st-editor" onSubmit={event => void savePickup(event)} aria-label="Local pickup place"><h3>Local pickup</h3>
      <div className="st-editor-grid"><label>Pickup place name<input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label>Pickup address<input required maxLength={300} value={address} disabled={busy} onChange={event => setAddress(event.target.value)} /></label><label>Opening hours<input maxLength={200} value={hours} disabled={busy} onChange={event => setHours(event.target.value)} /></label></div>
      <label>Pickup instructions<textarea rows={2} maxLength={500} value={instructions} disabled={busy} onChange={event => setInstructions(event.target.value)} /></label>
      <div className="st-actions"><button disabled={busy}>Save pickup place</button>{places.pickup && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('shipping.place', { kind: 'pickup', value: null, revision: places.pickup!.revision })}>Remove pickup</button>}</div></form>
    <form className="st-stack st-editor" onSubmit={event => void saveDelivery(event)} aria-label="Local delivery area"><h3>Local delivery</h3>
      <div className="st-editor-grid"><label>Delivery area ZIP prefixes (comma separated)<input required value={area} disabled={busy} placeholder="100, 101" onChange={event => setArea(event.target.value)} /></label><label>Delivery fee · USD<input required inputMode="decimal" value={fee} disabled={busy} onChange={event => setFee(event.target.value)} /></label><label>Minimum order · USD<input required inputMode="decimal" value={minimum} disabled={busy} onChange={event => setMinimum(event.target.value)} /></label></div>
      <label>Delivery instructions<textarea rows={2} maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      {problem && <div className="st-notice st-error" role="alert">{problem}</div>}
      <div className="st-actions"><button disabled={busy}>Save delivery area</button>{places.delivery && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('shipping.place', { kind: 'delivery', value: null, revision: places.delivery!.revision })}>Remove delivery</button>}</div></form>
  </div>
}
