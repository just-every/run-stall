import { Authority } from './authority'
import { permits } from '../permissions'
import { useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { request, errorMessage } from './api'
import { Notice, Section } from './primitives'
import type { State } from './types'
import { ProductsView } from './products'
import { OrdersView } from './orders'
import { MoveIn } from './move-in'
import { MerchandisingView } from './merchandising'
import { ShippingView } from './shipping'
import { Activity } from './activity'
import { Settings } from './settings'
import { Promotions } from './promotions'
import { DeskShell, recordOf, viewOf, type DeskView } from './shell'
import { needs, orderTabs } from './order-status'
import { defaultTimeZone, People, TimeZone } from './presentation'

const searchLabel: Partial<Record<DeskView, string>> = { orders: 'Search orders, customers, items', products: 'Search products or SKUs', history: 'Search activity, records or people' }
const titles: Record<DeskView, string> = { orders: 'Orders', products: 'Products', shopfront: 'Collections & search', shipping: 'Shipping', promotions: 'Promotions', 'move-in': 'Move in', history: 'Activity', settings: 'Settings' }

export function ShopDesk() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [view, setView] = useState<DeskView>('orders'), [section, setSection] = useState(''), [host, setHost] = useState(''), [query, setQuery] = useState('')
  const lock = useRef(false)
  useEffect(() => { const update = () => { const hash = location.hash.slice(1); setView(viewOf(hash)); setSection(hash); setQuery('') }; update(); setHost(location.host); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  useEffect(() => { document.title = `${titles[view]} · Stall`; if (section && section !== view && !recordOf(section)) document.getElementById(section)?.scrollIntoView(); else scrollTo(0, 0) }, [view, section, !!state])
  async function reload() { setState(await request<State>('/api/stall/state')) }
  useEffect(() => { void reload().catch(error => setError(errorMessage(error))).finally(() => setLoading(false)) }, [])
  // New and newly paid orders appear without a reload: the minute's payment check confirms them.
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible' && !lock.current) void reload().catch(() => { /* The next refresh or action shows the problem. */ }) }, 60000); return () => clearInterval(timer) }, [])
  async function run(type: string, payload: unknown) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await request('/api/stall/commands', { type, payload }); await reload(); setNotice('Saved. The latest recorded state is shown.'); return true }
    catch (error) { setError(errorMessage(error)); try { await reload() } catch { /* Keep the last known state visible; the action error remains explicit. */ } return false }
    finally { lock.current = false; setBusy(false) }
  }
  const permissionActor=state?{...state.actor,agent:!!state.actor.agent}:{role:'member',agent:false}
  const allowedViews:DeskView[]=state&&['owner','admin'].includes(state.actor.role)?['orders','products','shopfront','shipping','promotions','move-in','history','settings']:[...(permits(permissionActor,'orders')?['orders' as const]:[]),...(permits(permissionActor,'catalog')?['products' as const,'move-in' as const]:[]),...((permits(permissionActor,'marketing')||permits(permissionActor,'catalog'))?['shopfront' as const]:[]),...(permits(permissionActor,'admin')?['shipping' as const]:[]),'settings']
  const allowed=allowedViews.includes(view)
  const role = state?.actor.role.toLowerCase() ?? '', owner = role === 'owner', canApprove = !!state && !state.actor.agent && (['owner', 'admin'].includes(role)||!!state.actor.staffRole)
  const open = state?.orders.filter(order => orderTabs[1].keep(order) || needs(order)).length ?? 0
  const label = searchLabel[view]
  const actor = state && { name: state.people[state.actor.id] ?? state.actor.email, email: state.actor.email, role: state.actor.role }
  return <DeskShell allowedViews={allowedViews} view={view} counts={{ orders: open }} host={host} actor={actor ?? undefined} search={label ? { label, value: query, onChange: setQuery } : undefined}>
    <HydrationUnit><div className="st-messages" aria-live="polite">{loading && <p role="status" className="st-loading">Loading your shop…</p>}{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}</div></HydrationUnit>
    {state ? <TimeZone.Provider value={state.timeZone ?? defaultTimeZone}><People.Provider value={state.people}><Authority.Provider value={permissionActor}>
      {!allowed&&<Section title="Staff workspace"><p>Choose a workspace permitted by your current shop role.</p></Section>}
      {allowed&&view === 'orders' && <OrdersView state={state} focus={recordOf(section)} query={query} busy={busy} run={run} canApprove={canApprove} refresh={() => { setError(''); void reload().catch(error => setError(errorMessage(error))) }} />}
      {allowed&&view === 'products' && <ProductsView products={state.products} audit={state.audit} focus={recordOf(section)} query={query} busy={busy} run={run} canApprove={canApprove} reload={reload} shipping={state.shipping} />}
      {allowed&&view === 'shopfront' && state.merchandising && <MerchandisingView data={state.merchandising} products={state.products} busy={busy} run={run} canApprove={canApprove} />}
      {allowed&&view === 'shipping' && state.shipping && (canApprove ? <ShippingView data={state.shipping} busy={busy} run={run} reload={reload} /> : <Section title="Shipping"><p>Only an owner or administrator can change shipping profiles.</p></Section>)}
      {allowed&&view === 'promotions' && <Promotions />}
      {allowed&&view === 'move-in' && (canApprove ? <MoveIn reload={reload} /> : <Section title="Move in from Shopify"><p>Only an owner or administrator can import products.</p></Section>)}
      {allowed&&view === 'history' && <Activity state={state} query={query} />}
      {allowed&&view === 'settings' && <Settings state={state} owner={owner} busy={busy} run={run} reload={reload} />}
    </Authority.Provider></People.Provider></TimeZone.Provider> : !loading && <Section title="Shop desk unavailable"><p>Sign in with your operator account to manage this shop. If you are already signed in, resolve the error above and refresh.</p><a href="/signin?returnTo=%2Fapp">Sign in</a></Section>}
  </DeskShell>
}
