// Shipping profiles, the pickup place and local-delivery area, and which products use which profile.
import { useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Run, ShippingState } from './types'
import { Badge } from './primitives'
import { ProfileEditor, rateSummary } from './shipping-profile-editor'
import { PlacesEditor } from './shipping-places'
import { AssignProducts } from './shipping-assign'

const tabs = [['profiles', 'Profiles'], ['places', 'Pickup and delivery'], ['products', 'Products']] as const
export function ShippingView({ data, busy, run, reload }: { data: ShippingState; busy: boolean; run: Run; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<typeof tabs[number][0]>('profiles'), [editing, setEditing] = useState<string | 'new' | null>(null)
  const edited = data.profiles.find(entry => entry.id === editing) ?? null
  const used = (id: string) => Object.values(data.assignments).filter(profile => profile === id).length
  return <HydrationUnit><section className="st-orders st-stack" aria-labelledby="shipping-title" id="shipping">
    <div className="st-view-head"><h1 id="shipping-title">Shipping</h1></div>
    <nav className="st-tabs" aria-label="Shipping sections">{tabs.map(([id, label]) => <button key={id} aria-current={tab === id ? 'true' : undefined} onClick={() => { setTab(id); setEditing(null) }}>{label}</button>)}</nav>
    {tab === 'profiles' && (editing ? <ProfileEditor key={editing} editing={edited} busy={busy} run={run} done={() => setEditing(null)} /> : <div className="st-stack">
      <p>Every product starts in the General profile. Put oversized, fragile, free-shipping or local-only goods in their own profile with their own zones, services and rates. A basket is charged each profile's rate for its own items, and a service is offered only when every profile in the basket allows it.</p>
      <div className="st-actions"><button disabled={busy} onClick={() => setEditing('new')}>New profile</button></div>
      <div className="st-table-wrap"><table><caption className="st-sr-only">Shipping profiles</caption><thead><tr><th scope="col">Profile</th><th scope="col">Services and rates</th><th scope="col">Where</th><th scope="col">Products</th><th scope="col"><span className="st-sr-only">Actions</span></th></tr></thead><tbody>{data.profiles.map(entry => <tr key={entry.id}>
        <td><strong>{entry.value.name}</strong><small> {entry.id}</small>{entry.value.shipFrom && <small> · from {entry.value.shipFrom}</small>}</td>
        <td>{entry.value.services.length ? <ul>{entry.value.services.map(service => <li key={service.code}>{service.name}: {rateSummary(service)}</li>)}</ul> : 'No shipped services'}{(entry.value.pickup || entry.value.delivery) && <small>{[entry.value.pickup && 'Pickup', entry.value.delivery && 'Local delivery'].filter(Boolean).join(' and ')} allowed</small>}</td>
        <td>{entry.value.zones.length ? entry.value.zones.map(zone => zone.name).join(', ') : 'Everywhere in the US'}</td>
        <td>{entry.id === 'general' ? <Badge value="Default" /> : used(entry.id)}</td>
        <td><div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => setEditing(entry.id)}>Edit<span className="st-sr-only"> {entry.value.name}</span></button>{entry.id !== 'general' && <button className="st-secondary" disabled={busy} onClick={() => void run('shipping.profile.delete', { id: entry.id, revision: entry.revision })}>Remove<span className="st-sr-only"> {entry.value.name}</span></button>}</div></td>
      </tr>)}</tbody></table></div>
      <p className="st-small">Shipping a basket to a ZIP code your zones do not cover is refused before payment. Carrier-calculated rates need a shipping provider (SHIP-001).</p>
    </div>)}
    {tab === 'places' && <PlacesEditor key={`${data.places.pickup?.revision}${data.places.delivery?.revision}`} places={data.places} busy={busy} run={run} />}
    {tab === 'products' && <AssignProducts data={data} reload={reload} />}
  </section></HydrationUnit>
}
