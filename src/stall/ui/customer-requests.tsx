import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage, money, request } from './api'
import { Notice, Section } from './primitives'

type OwnOrder = { id: string; createdAt: string; status: string; lines: { sku: string; name: string; quantity: number; unitCents: number }[]; totalCents: number }
type Receipt = { request: { id: string; orderId: string; kind: string; createdAt: string }; message: string }
/** Intake for the existing owner-invited native identity; it grants no new shopper or guest access. */
export function CustomerRequests() {
  const [orders, setOrders] = useState<OwnOrder[]>(), [orderId, setOrderId] = useState(''), [kind, setKind] = useState('return'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<Receipt>()
  const lock = useRef(false), chosen = orders?.find(order => order.id === orderId)
  useEffect(() => { void request<{ orders: OwnOrder[] }>('/api/stall/customer/orders').then(data => setOrders(data.orders)).catch(error => setError(errorMessage(error))) }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current || !chosen) return
    lock.current = true; setBusy(true); setError(''); setReceipt(undefined)
    try { setReceipt(await request<Receipt>('/api/stall/customer-requests', { orderId: chosen.id, kind })) }
    catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Section title="Request order help">
    <p>Invited accounts can request staff review of a return or cancellation. Sign in with the email used for the order. If you do not have access, contact the shop; guest links and open shopper registration are not available yet.</p>
    <p>This is request intake only. It does not approve a return, cancel an order, issue a refund or move stock. Line-by-line returns, exchanges and progress tracking are not available here yet.</p>
    {error && <Notice error>{error} <a href="/signin?returnTo=%2Forder">Sign in to your invited account</a></Notice>}
    {!orders && !error && <p role="status">Loading orders for your account…</p>}
    {orders && !orders.length && <Notice>No orders are available for this signed-in email. Contact the shop if your order used a different email.</Notice>}
    {!!orders?.length && <form className="st-stack" aria-label="Request order help" onSubmit={event => void submit(event)}>
      <label>Order<select required value={orderId} disabled={busy} onChange={event => { setOrderId(event.target.value); setReceipt(undefined); setError('') }}><option value="">Choose your order…</option>{orders.map(order => <option key={order.id} value={order.id}>{order.id} · {money(order.totalCents)}</option>)}</select></label>
      {chosen && <div className="st-stack"><p style={{ overflowWrap: 'anywhere' }}>Order reference: {chosen.id}</p><ul>{chosen.lines.map(line => <li key={line.sku}>{line.name} × {line.quantity}</li>)}</ul><p>Order total: {money(chosen.totalCents)}</p></div>}
      <label>Request type<select value={kind} disabled={busy} onChange={event => { setKind(event.target.value); setReceipt(undefined); setError('') }}><option value="return">Return request</option><option value="cancellation">Cancellation request</option></select></label>
      <button disabled={busy || !chosen}>{busy ? 'Submitting request…' : 'Request staff review'}</button>
    </form>}
    {receipt && <Notice><strong>Request received for staff review.</strong><p>{receipt.message}</p><p style={{ overflowWrap: 'anywhere' }}>Request reference: {receipt.request.id}</p><p>Sending the same request again keeps this reference and creates no duplicate request.</p></Notice>}
  </Section>
}
