import { useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage } from './api'
import { Badge, Chrome, Empty, Notice, ProviderLinks, Section } from './primitives'
import type { State } from './types'
import { Products } from './products'
import { Orders } from './orders'
import { MoveIn } from './move-in'
import { Portability } from './portability'
import { AgentCredential } from './agent-credential'
import { CustomerErasure } from './data'
import { People, businessTime, humanLabel, shortId } from './presentation'
export function ShopDesk() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const lock = useRef(false)
  const [tab, setTab] = useState('orders')
  useEffect(() => { const update = () => setTab(location.hash.slice(1) || 'orders'); update(); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  useEffect(() => { const active = document.querySelector<HTMLElement>('.st-tabs [aria-current="true"]'); const nav = active?.parentElement; if (active && nav) { const left = active.offsetLeft - nav.offsetLeft; if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left } }, [tab])
  async function reload() { setState(await request<State>('/api/stall/state')) }
  useEffect(() => { void reload().catch(error => setError(errorMessage(error))).finally(() => setLoading(false)) }, [])
  async function run(type: string, payload: unknown) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await request('/api/stall/commands', { type, payload }); await reload(); setNotice('Saved. The latest recorded state is shown below.'); return true }
    catch (error) { setError(errorMessage(error)); try { await reload() } catch { /* Keep the last known state visible; the action error remains explicit. */ } return false }
    finally { lock.current = false; setBusy(false) }
  }
  const owner = state?.actor.role.toLowerCase() === 'owner', canApprove = !!state && !state.actor.agent && ['owner', 'admin'].includes(state.actor.role.toLowerCase())
  return <div className="st-shell"><Chrome desk /><main id="main" className="st-stack"><HydrationUnit><header className="st-page-heading"><p className="st-eyebrow">Shop desk</p><div className="st-row"><div><h1>Your shop, in view.</h1><p>Prepare products, review orders and approve the work that moves money or stock.</p></div><button className="st-secondary" disabled={busy || loading} onClick={() => { setError(''); void reload().catch(error => setError(errorMessage(error))) }}>Refresh shop</button></div>{state && <p className="st-small">{state.actor.email} · {state.actor.role}</p>}</header></HydrationUnit>
    <HydrationUnit><nav className="st-tabs" aria-label="Shop desk sections">{[['products', 'Products'], ['orders', 'Orders'], ['move-in', 'Move in'], ['connections', 'Connections'], ['history', 'Activity'], ...(owner ? [['portability', 'Your data']] : [])].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={tab === id ? 'true' : undefined}>{label}</a>)}</nav></HydrationUnit>
    <HydrationUnit><div aria-live="polite">{loading && <p role="status">Loading your shop…</p>}{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}</div></HydrationUnit>
    {state ? <People.Provider value={state.people}><Section id="connections" title="Provider connections"><div className="st-metrics">{Object.entries(state.connections).map(([name, ready]) => <div key={name}><strong>{name === 'pier' ? 'Pier stock' : name === 'stripe' ? 'Stripe checkout' : 'Stripe webhooks'}</strong><Badge value={ready ? 'Configured' : 'Setup required'} /></div>)}</div>{!Object.values(state.connections).every(Boolean) && <Notice>External setup is incomplete. Checkout, stock reservation, payment confirmation and shipping require the corresponding provider connection.</Notice>}<ProviderLinks /></Section>
      {tab === 'products' ? <><Products products={state.products} busy={busy} run={run} canApprove={canApprove} /><Orders orders={state.orders} busy={busy} run={run} canApprove={canApprove} /></> : <><Orders orders={state.orders} busy={busy} run={run} canApprove={canApprove} /><Products products={state.products} busy={busy} run={run} canApprove={canApprove} /></>}
      {canApprove && <MoveIn reload={reload} />}
      <Section id="history" title="Activity & reconciliation"><p>Approval actors and provider reconciliation are recorded here. Use the order’s reconcile action to resolve pending work.</p>{!state.audit.length ? <Empty>No activity recorded yet. Preparing and approving work will create an audit trail.</Empty> : <ol className="st-audit">{state.audit.map(event => <li key={event.id}><strong>{humanLabel(event.action)}</strong><p>{state.products.find(product => product.id === event.subject)?.value.name ?? (state.orders.some(order => order.id === event.subject) ? `Order ${shortId(event.subject)}` : 'Shop record')}</p><small>{state.people[event.actor] ?? (event.actor === 'stripe' ? 'Stripe' : event.actor.startsWith('agent:') ? 'Shop agent' : 'Shop operator')} · {businessTime(event.at)}</small></li>)}</ol>}</Section>
      {owner && <><Portability reload={reload} /><CustomerErasure busy={busy} run={run} /><AgentCredential /></>}
    </People.Provider> : !loading && <Section title="Shop desk unavailable"><p>Sign in with your operator account to manage this shop. If you are already signed in, resolve the error above and refresh.</p><a href="/signin?returnTo=%2Fapp">Sign in</a></Section>}
  </main></div>
}
