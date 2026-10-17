// Before the first order: what the shop still needs to take one, read from the
// installation's recorded connections and published products.
import type { State } from './types'
import { Badge } from './primitives'
import { providers } from './settings'

export function Readiness({ state }: { state: State }) {
  const published = state.products.filter(product => product.value.approval && product.value.active).length
  const steps: { label: string; detail: string; ready: boolean; href: string }[] = [
    { label: 'Published products', detail: published ? `${published} of ${state.products.length} on the shop` : state.products.length ? `${state.products.length} waiting for approval` : 'Import from Shopify or prepare one', ready: published > 0, href: state.products.length ? '#products' : '#move-in' },
    ...Object.entries(state.connections).map(([name, ready]) => ({ label: providers[name]?.[0] ?? name, detail: providers[name]?.[1] ?? '', ready, href: '#connections' })),
  ]
  const left = steps.filter(step => !step.ready).length
  return <div className="st-panel-body st-readiness">
    <div className="st-panel-head"><h2>Before your first order</h2></div>
    <p className="st-small">{left ? `${left} of ${steps.length} still to do. Checkout opens on the shop once each is ready.` : 'Everything is ready. Orders appear here as customers pay.'}</p>
    <ul className="st-connections">{steps.map(step => <li key={step.label}><div><a href={step.href}><strong>{step.label}</strong></a><small>{step.detail}</small></div><Badge value={step.ready ? 'Ready' : 'Setup required'} tone={step.ready ? undefined : 'need'} /></li>)}</ul>
    <p className="st-small">Open <a href="/shop">the shop</a> to see what customers see.</p>
  </div>
}
