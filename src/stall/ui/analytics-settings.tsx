import { useEffect, useState } from 'react'
import type { CostRecord } from '../analytics/report-model'
import type { Order } from './types'
import { errorMessage, request } from './api'
import { Notice } from './primitives'
import { shortId, When } from './presentation'
import { AnalyticsHistory } from './analytics-history'

type Costs = { enabled: boolean; records: CostRecord[] }
const fields = { itemCostCents: 'Total item cost', shippingCostCents: 'Actual shipping cost', feesCents: 'Payment fees', giftLiabilityCents: 'Gift liability' } as const
type CostField = keyof typeof fields
type Values = Record<CostField, string>
const empty: Values = { itemCostCents: '', shippingCostCents: '', feesCents: '', giftLiabilityCents: '' }
const dollars = (value: number | null) => value === null ? '' : (value / 100).toFixed(2)
function CostSettings({ orders }: { orders: Order[] }) {
 const [costs, setCosts] = useState<Costs>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [orderId, setOrderId] = useState(''), [values, setValues] = useState<Values>(empty)
 const order = orders.find(order => order.id === orderId), paid = orders.filter(order => !!order.payment)
 useEffect(() => { let current = true; void request<Costs>('/api/stall/analytics/costs').then(data => { if (current) setCosts(data) }).catch(error => { if (current) setError(errorMessage(error)) }); return () => { current = false } }, [])
 function select(id: string) {
  setOrderId(id); setNotice('')
  const record = costs?.records.filter(record => record.orderId === id).at(-1)
  setValues(record ? { itemCostCents: dollars(record.itemCostCents), shippingCostCents: dollars(record.shippingCostCents), feesCents: dollars(record.feesCents), giftLiabilityCents: dollars(record.giftLiabilityCents) } : empty)
 }
 async function toggle(enabled: boolean) {
  setBusy(true); setError(''); setNotice('')
  try { setCosts(await request<Costs>('/api/stall/analytics/costs', { enabled })); setNotice('Saved.') }
  catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
 }
 async function save() {
  if (!order) return
  setBusy(true); setError(''); setNotice('')
  try {
   const amounts = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() === '' ? null : Math.round(Number(value) * 100)]))
   const { record } = await request<{ record: CostRecord }>('/api/stall/analytics/costs', { orderId: order.id, orderRevision: order.revision, ...amounts })
   setCosts(current => current && { ...current, records: [...current.records, record] }); setNotice('Order costs recorded.')
  } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
 }
 return <div className="st-stack"><h3>Recorded costs</h3>{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
  {costs ? <><label className="st-checkbox"><input type="checkbox" checked={costs.enabled} disabled={busy} onChange={event => void toggle(event.target.checked)} />Use recorded costs in contribution reports</label><p>Turning this off makes cost and margin values unknown. Existing records remain available when enabled again.</p>
   {costs.enabled && <form className="st-stack" aria-label="Order cost recording" onSubmit={event => { event.preventDefault(); void save() }}><label>Paid order<select required value={orderId} disabled={busy} onChange={event => select(event.target.value)}><option value="">Choose an order</option>{paid.map(order => <option key={order.id} value={order.id}>Order {shortId(order.id)}{order.analyticsExcluded === 'test' ? ' · Test payment' : ''} · {order.customerEmail ?? 'Unknown customer'}</option>)}</select></label>
    {order && <><a href={`#orders/${encodeURIComponent(order.id)}`}>Review order {shortId(order.id)}</a><div className="st-report-filter-grid">{(Object.entries(fields) as [CostField, string][]).map(([key, label]) => <label key={key}>{label} (USD)<input type="number" min="0" max="9999999.99" step="0.01" value={values[key]} disabled={busy} placeholder="Unknown" onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div><p>Enter actual order totals. Leave a field blank when unknown; enter 0 only when confirmed zero.</p><button disabled={busy}>{busy ? 'Recording costs…' : 'Record order costs'}</button></>}
   </form>}
   {costs.records.length > 0 && <details><summary>Cost recording history</summary><ul className="st-report-lines">{costs.records.slice().reverse().map(record => <li key={record.id}>Order {shortId(record.orderId)} · <When at={record.at} /></li>)}</ul></details>}
  </> : !error && <p role="status">Loading cost settings…</p>}
 </div>
}
export function AnalyticsSettings({ orders, owner }: { orders: Order[]; owner: boolean }) {
 const [open, setOpen] = useState(false)
 return <section className="st-analytics-settings" aria-label="Report settings"><details onToggle={event => setOpen(event.currentTarget.open)}><summary>Reports: costs & historical sales</summary>{open && <div className="st-stack"><CostSettings orders={orders} />{owner && <AnalyticsHistory />}</div>}</details></section>
}
