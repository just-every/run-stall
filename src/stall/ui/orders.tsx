import { useCan } from './authority'
// The Orders workspace (the owner's pick): status tabs, a dense order table and
// the selected order's panel. Rows a person must act on carry a tangerine dot;
// Needs action opens on the shop agent's drafts, then the most urgent.
import { useEffect, useMemo, useRef, useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Order, Run, State } from './types'
import { money } from './api'
import { Badge, Empty, Notice } from './primitives'
import { placeLine, shortId, useBusinessTime, When } from './presentation'
import { agentDrafted, carrierOf, fulfilmentPill, itemCount, matches, needs, orderTabs, paymentPill, type OrderTab } from './order-status'
import { ManualOrder } from './manual-order'
import { staffPaymentLabel } from '../payment-labels'
import { OrderPanel } from './order-panel'
import { Readiness } from './readiness'
import { Icon } from './icons'
import { noFilters, OrderFilterBar, useFilteredIds, type OrderFilters } from './order-filters'

const urgency = ['Shortfall', 'Refund failed', 'Refund draft', 'Shipping draft', 'Not reserved']
const rank = (order: Order) => { if (agentDrafted(order)) return -1; const need = needs(order); const at = need ? urgency.indexOf(need) : -1; return at < 0 ? urgency.length : at }
const newest = (a: Order, b: Order) => b.createdAt.localeCompare(a.createdAt)

/** An email that breaks after its "@" when the column is narrow, never cut. */
const EmailLines = ({ email }: { email: string }) => { const at = email.indexOf('@'); return at < 0 ? <>{email}</> : <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</> }

function OrderRow({ order, selected, now, onSelect }: { order: Order; selected: boolean; now: number; onSelect: () => void }) {
  const { businessTime, timeZoneLabel, whenLabel } = useBusinessTime()
  const [payment, paymentTone] = paymentPill(order), [fulfilment, fulfilmentTone] = fulfilmentPill(order), flagged = needs(order) !== null
  return <tr className={selected ? 'is-selected' : undefined} onClick={onSelect}>
    <td data-label="Order"><button className="st-order-id" aria-pressed={selected} onClick={event => { event.stopPropagation(); onSelect() }}>{flagged && <span className="st-flag" title="Needs a person" aria-hidden="true" />}<span className="st-sr-only">Order </span>{shortId(order.id)}</button></td>
    <td data-label="Time" className="st-muted-cell"><time dateTime={order.createdAt} title={businessTime(order.createdAt)}>{whenLabel(order.createdAt, now)}<small>{timeZoneLabel(order.createdAt)}</small></time></td>
    <td data-label="Customer" className="st-customer"><span className="st-customer-name">{order.shippingDetails?.name ?? (order.customerEmail ? <EmailLines email={order.customerEmail} /> : 'Customer details erased')}</span><small>{placeLine(order.shippingDetails?.address) || (order.shippingDetails ? '' : order.customerEmail ? 'No address yet' : '')}</small>{order.payment?.source==='staff'&&<small>{staffPaymentLabel}</small>}</td>
    <td data-label="Items" className="st-muted-cell">{itemCount(order)}</td>
    <td data-label="Total" className="st-num st-money">{money(order.totalCents)}</td>
    <td data-label="Payment"><Badge value={payment} tone={paymentTone}>{payment}</Badge></td>
    <td data-label="Fulfillment">{fulfilment === '—' ? '—' : <Badge value={fulfilment} tone={fulfilmentTone}>{fulfilment}</Badge>}</td>
    <td data-label="Shipping" className={`st-ship-cell${order.shipment ? '' : ' is-empty'}`} title={order.shipment?.reference}>{order.shipment ? carrierOf(order.shipment.reference) : '—'}</td>
  </tr>
}

/** `focus` is an order id from a link (#orders/<id>), opened in the tab that holds it. */
export function OrdersView({ state, focus, query, busy, run, canApprove, refresh }: { state: State; focus?: string; query: string; busy: boolean; run: Run; canApprove: boolean; refresh: () => void }) {
  const can=useCan()
  const { timeZone } = useBusinessTime()
  const { orders, audit } = state
  const tabFor = (id?: string) => { const order = orders.find(order => order.id === id); return order ? needs(order) ? 'needs' : 'all' : orders.some(order => needs(order)) ? 'needs' : 'all' }
  const [manual,setManual]=useState(false)
  const [tab, setTab] = useState<OrderTab>(() => tabFor(focus))
  const [selectedId, setSelectedId] = useState(focus ?? ''), [now, setNow] = useState(() => Date.now()), [filters, setFilters] = useState<OrderFilters>(noFilters)
  const found = useFilteredIds(filters, orders)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => setNow(Date.now()), [orders])
  useEffect(() => { if (focus && orders.some(order => order.id === focus)) { setTab(tabFor(focus)); setSelectedId(focus) } }, [focus])
  const shown = useMemo(() => {
    const keep = orderTabs.find(item => item.id === tab)!.keep
    const list = orders.filter(order => keep(order) && matches(order, query) && (!found.ids || found.ids.has(order.id))).sort(newest)
    return tab === 'needs' ? list.sort((a, b) => rank(a) - rank(b) || newest(a, b)) : list
  }, [orders, tab, query, found.ids])
  const selected = orders.find(order => order.id === selectedId) ?? shown[0]
  const position = selected ? shown.indexOf(selected) : -1
  function select(order: Order | undefined, reveal = true) {
    if (!order) return
    setSelectedId(order.id)
    if (reveal && matchMedia('(max-width: 1180px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start' }))
  }
  const weekAgo = now - 7 * 86400000
  const agentOrders = new Set(audit.filter(event => event.actor.startsWith('agent:') && Date.parse(event.at) >= weekAgo && orders.some(order => order.id === event.subject)).map(event => event.subject)).size
  const waiting = orders.filter(order => needs(order)).length
  return <div className={`st-orders-layout${selected || !orders.length ? '' : ' is-single'}`} id="orders">
    <HydrationUnit><section className="st-orders" aria-labelledby="orders-title">
      <div className="st-view-head"><h1 id="orders-title">Orders</h1><div className="st-actions">{canApprove&&can('order.manual')&&<button className="st-secondary" disabled={busy} onClick={()=>setManual(true)}>Record paid sale</button>}<button className="st-secondary" disabled={busy} onClick={refresh}>Refresh shop</button></div></div>
      <p className="st-small">Times: {timeZone}. {state.shipmentSync?.checkedAt && <>Shipping checked with Pier <When at={state.shipmentSync.checkedAt} />.</>}</p>
      {state.shipmentSync?.error && <Notice error>Shipping could not be refreshed: {state.shipmentSync.error} Showing the last recorded shipment state.</Notice>}
      {manual&&canApprove&&can('order.manual')&&<ManualOrder state={state} busy={busy} run={run} close={()=>{setManual(false);setTab('all')}} />}
      <OrderFilterBar filters={filters} skus={[...new Set(orders.flatMap(order => order.lines.map(line => line.sku)))].sort()} timeZone={timeZone} change={setFilters} />
      {found.error && <Notice error>{found.error}</Notice>}
      <nav className="st-tabs" aria-label="Order status">{orderTabs.map(item => { const count = item.counted ? orders.filter(item.keep).length : 0; return <button key={item.id} aria-current={tab === item.id ? 'true' : undefined} onClick={() => { setTab(item.id); setSelectedId('') }}>{item.label}{!!count && <span className="st-tab-count">{count}</span>}</button> })}</nav>
      {!orders.length ? <Empty><h3>No orders yet</h3><p>Orders placed through the public shop appear here. Payment is verified by Stripe before stock is reserved.</p></Empty>
        : !shown.length ? <p className="st-none">{query ? `No orders match “${query}”.` : filters.from || filters.to || filters.sku || filters.overdue ? 'No orders match these filters.' : `No orders in ${orderTabs.find(item => item.id === tab)!.label}.`}</p>
        : <div className="st-table-wrap"><table className="st-order-table"><caption className="st-sr-only">Orders</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Time</th><th scope="col">Customer</th><th scope="col">Items</th><th scope="col" className="st-num">Total</th><th scope="col">Payment</th><th scope="col">Fulfillment</th><th scope="col">Shipping</th></tr></thead>
          <tbody>{shown.map(order => <OrderRow key={order.id} order={order} now={now} selected={order === selected} onSelect={() => select(order)} />)}</tbody>
        </table></div>}
    </section></HydrationUnit>
    {selected && <HydrationUnit><aside className="st-order-panel" ref={panel} aria-label={`Order ${shortId(selected.id)}`}>
      <OrderPanel key={selected.id} order={selected} staff={state.staff ?? {}} busy={busy} run={run} canApprove={canApprove} owner={state.actor.role==='owner'}
        previous={position > 0 ? () => select(shown[position - 1], false) : undefined}
        next={position >= 0 && position < shown.length - 1 ? () => select(shown[position + 1], false) : undefined}
        footer={<p className="st-agent-line"><Icon name="agent" /><span>Shop agent prepared work on {agentOrders} order{agentOrders === 1 ? '' : 's'} this week, <strong>{waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you.` : 'nothing needs you.'}</strong></span></p>} />
    </aside></HydrationUnit>}
    {!orders.length && <HydrationUnit><aside className="st-order-panel" aria-label="Before your first order"><Readiness state={state} /></aside></HydrationUnit>}
  </div>
}
