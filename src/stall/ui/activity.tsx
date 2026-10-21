// Activity: every recorded approval and provider event, newest first, one line
// each: a state dot, the event, the record it touched (linked), who acted and
// when. Tangerine marks work left for a person, red a failure, green a payment.
import { useEffect, useState } from 'react'
import type { State } from './types'
import { Empty, Section } from './primitives'
import { ago, humanLabel, initials, shortId, useBusinessTime } from './presentation'
import { Icon } from './icons'

const pageSize = 50
type Tone = 'need' | 'bad' | 'good' | undefined
const toneOf = (action: string): Tone => /failed|refused/.test(action) ? 'bad' : /^(product|shipment|refund)\.prepared$|shortfall/.test(action) ? 'need' : action === 'payment.confirmed' ? 'good' : undefined
/** Stock events are Pier's, even when Stripe's payment confirmation started them. */
const partyOf = (action: string, actor: string) => actor === 'stripe' && action.startsWith('stock.') ? 'pier' : actor

export function Activity({ state, query }: { state: State; query: string }) {
  const { businessTime, clockTime } = useBusinessTime()
  const [shown, setShown] = useState(pageSize), [now, setNow] = useState(() => Date.now())
  useEffect(() => setNow(Date.now()), [state.audit])
  const actor = (id: string) => state.people[id] ?? (id === 'stripe' ? 'Stripe' : id === 'pier' ? 'Pier' : id === 'customer' ? 'Customer' : id.startsWith('agent:') ? 'Shop agent' : 'Shop operator')
  const record = (id: string) => {
    const product = state.products.find(product => product.id === id)
    if (product) return { label: product.value.name, href: `#products/${encodeURIComponent(id)}` }
    const order = state.orders.find(order => order.id === id)
    return order ? { label: `Order ${shortId(id)}`, detail: order.shippingDetails?.name, href: `#orders/${id}` } : { label: 'Shop record' }
  }
  const q = query.trim().toLowerCase()
  const events = [...state.audit].sort((a, b) => b.at.localeCompare(a.at)).map(event => ({ ...event, party: partyOf(event.action, event.actor), record: record(event.subject) }))
    .filter(event => !q || [humanLabel(event.action), event.record.label, event.record.detail, actor(event.party)].some(text => text?.toLowerCase().includes(q)))
  return <Section id="history" title="Activity & reconciliation" className="st-view-panel st-activity">
    <p className="st-small">Approval actors and provider reconciliation are recorded here. Use the order’s reconcile action to resolve pending work.</p>
    {!state.audit.length ? <Empty><h3>No activity recorded yet</h3><p>Preparing and approving work will create an audit trail.</p></Empty>
      : !events.length ? <p className="st-none">No activity matches “{query}”.</p> : <>
      <div className="st-table-wrap"><table className="st-activity-table"><caption className="st-sr-only">Activity</caption>
        <thead><tr><th scope="col">Event</th><th scope="col">Record</th><th scope="col">By</th><th scope="col">Time</th></tr></thead>
        <tbody>{events.slice(0, shown).map(event => { const tone = toneOf(event.action), name = actor(event.party); return <tr key={event.id}>
          <td data-label="Event"><span className={`st-event-dot${tone ? ` is-${tone}` : ''}`} aria-hidden="true" /><strong>{humanLabel(event.action)}</strong></td>
          <td data-label="Record">{event.record.href ? <a href={event.record.href}>{event.record.label}</a> : event.record.label}{event.record.detail && <small>{event.record.detail}</small>}</td>
          <td data-label="By"><span className="st-actor">{event.party.startsWith('agent:') ? <span className="st-actor-mark is-agent" aria-hidden="true"><Icon name="agent" /></span> : <span className="st-actor-mark" aria-hidden="true">{initials(name)}</span>}{name}</span></td>
          <td data-label="Time" className="st-muted-cell" title={businessTime(event.at)}><time dateTime={event.at}>{clockTime(event.at, now)}</time><small>{ago(event.at, now)}</small></td>
        </tr> })}</tbody>
      </table></div>
      {events.length > shown && <div><button className="st-secondary" onClick={() => setShown(shown + pageSize)}>Show {Math.min(pageSize, events.length - shown)} earlier events</button></div>}
    </>}
  </Section>
}
