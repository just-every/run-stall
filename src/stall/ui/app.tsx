import { useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage } from './api'
import { Chrome, Empty, Notice, ProviderLinks, Section } from './primitives'
import type { State } from './types'
import { Products } from './products'
import { Orders } from './orders'
import { MoveIn } from './move-in'
import { Portability } from './portability'
import { AgentCredential } from './agent-credential'
import { CustomerErasure } from './data'
export function ShopDesk() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const lock = useRef(false)
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
    <HydrationUnit><nav className="st-tabs" aria-label="Shop desk sections"><a href="#products">Products</a><a href="#orders">Orders</a><a href="#move-in">Move in</a><a href="#connections">Connections</a><a href="#history">Activity</a>{owner && <a href="#portability">Your data</a>}</nav></HydrationUnit>
    <HydrationUnit><div aria-live="polite">{loading && <p role="status">Loading your shop…</p>}{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}</div></HydrationUnit>
    {state ? <><Section id="connections" title="Provider connections"><div className="st-metrics">{Object.entries(state.connections).map(([name, ready]) => <div key={name}><strong>{name === 'pier' ? 'Pier stock' : name === 'stripe' ? 'Stripe checkout' : 'Stripe webhooks'}</strong><span className="st-badge">{ready ? 'Configured' : 'Setup required'}</span></div>)}</div>{!Object.values(state.connections).every(Boolean) && <Notice>External setup is incomplete. Checkout, stock reservation, payment confirmation and shipping require the corresponding provider connection.</Notice>}<ProviderLinks /></Section>
      <Products products={state.products} busy={busy} run={run} canApprove={canApprove} /><Orders orders={state.orders} busy={busy} run={run} canApprove={canApprove} />
      {canApprove && <MoveIn reload={reload} />}
      <Section id="history" title="Activity & reconciliation"><p>Approval actors and provider reconciliation are recorded here. Use the order’s reconcile action to resolve pending work.</p>{!state.audit.length ? <Empty>No activity recorded yet. Preparing and approving work will create an audit trail.</Empty> : <ol className="st-audit">{state.audit.map(event => <li key={event.id}><strong>{event.action}</strong><p>{event.subject}</p><small>{event.actor} · {event.at}</small></li>)}</ol>}</Section>
      {owner && <><Portability reload={reload} /><CustomerErasure busy={busy} run={run} /><AgentCredential /></>}
    </> : !loading && <Section title="Shop desk unavailable"><p>Sign in with your operator account to manage this shop. If you are already signed in, resolve the error above and refresh.</p><a href="/signin?returnTo=%2Fapp">Sign in</a></Section>}
  </main></div>
}
