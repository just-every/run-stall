// Activity: every recorded approval and provider event, newest first.
import { useState } from 'react'
import type { State } from './types'
import { Empty, Section } from './primitives'
import { businessTime, humanLabel, shortId } from './presentation'

const pageSize = 50
export function Activity({ state }: { state: State }) {
  const [shown, setShown] = useState(pageSize)
  const events = [...state.audit].sort((a, b) => b.at.localeCompare(a.at))
  const actor = (id: string) => state.people[id] ?? (id === 'stripe' ? 'Stripe' : id === 'customer' ? 'Customer' : id.startsWith('agent:') ? 'Shop agent' : 'Shop operator')
  const subject = (id: string) => state.products.find(product => product.id === id)?.value.name ?? (state.orders.some(order => order.id === id) ? `Order ${shortId(id)}` : 'Shop record')
  return <Section id="history" title="Activity & reconciliation" className="st-view-panel">
    <p className="st-small">Approval actors and provider reconciliation are recorded here. Use the order’s reconcile action to resolve pending work.</p>
    {!events.length ? <Empty><h3>No activity recorded yet</h3><p>Preparing and approving work will create an audit trail.</p></Empty> : <>
      <div className="st-table-wrap"><table className="st-activity-table"><caption className="st-sr-only">Activity</caption>
        <thead><tr><th scope="col">Event</th><th scope="col">Record</th><th scope="col">By</th><th scope="col">Time</th></tr></thead>
        <tbody>{events.slice(0, shown).map(event => <tr key={event.id}><td data-label="Event"><strong>{humanLabel(event.action)}</strong></td><td data-label="Record">{subject(event.subject)}</td><td data-label="By">{actor(event.actor)}</td><td data-label="Time" className="st-muted-cell">{businessTime(event.at)}</td></tr>)}</tbody>
      </table></div>
      {events.length > shown && <div><button className="st-secondary" onClick={() => setShown(shown + pageSize)}>Show {Math.min(pageSize, events.length - shown)} earlier events</button></div>}
    </>}
  </Section>
}
