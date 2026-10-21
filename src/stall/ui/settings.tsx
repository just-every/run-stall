// Settings: provider connections and the signed-in account for everyone; agent
// access, the data archive and customer erasure for the owner.
import type { Run, State } from './types'
import { Badge, Notice, ProviderLinks, Section } from './primitives'
import { Portability } from './portability'
import { AgentCredential } from './agent-credential'
import { CustomerErasure } from './data'
import { ConnectPier, ConnectStripe } from './connect-forms'
import { Operations } from './operations'
import { BusinessExports } from './business-exports'
import { ShippingCharge } from './shipping-charge'
import { ShopTimeZone } from './time-zone'
import { defaultTimeZone } from './presentation'
import { ProviderBoundaries } from './provider-boundaries'

const providerRows: Record<string, [string, string]> = { pier: ['Pier stock', 'Catalog stock, reservations and shipping'], stripe: ['Stripe checkout', 'Hosted checkout and refunds on your Stripe account'], webhook: ['Payment confirmations', 'Signed Stripe webhooks'] }
/** Each connection's name and job. A shop on this computer confirms payments by asking Stripe. */
export const providers = (state: State): Record<string, [string, string]> => state.connectionDetails?.stripe.local && !state.connectionDetails.stripe.webhook ? { ...providerRows, webhook: ['Payment confirmations', 'Stall asks Stripe; webhooks are for an online shop'] } : providerRows
export function Settings({ state, owner, busy, run, reload }: { state: State; owner: boolean; busy: boolean; run: Run; reload: () => Promise<void> }) {
  return <div className="st-settings">
    <h1>Settings</h1>
    <Section id="connections" title="Provider connections">
      <p>Stall is <a href="https://github.com/just-every/run-stall/blob/main/LICENSE" target="_blank" rel="noreferrer">free and open source under the MIT license</a>. No Stall license key, subscription, seat, product, order or revenue limit is required. Connected providers and hosting charge you under their own pricing.</p>
      <ul className="st-connections">{Object.entries(state.connections).map(([name, ready]) => <li key={name}><div><strong>{providers(state)[name]?.[0] ?? name}</strong><small>{providers(state)[name]?.[1]}</small></div><Badge value={ready ? 'Configured' : 'Setup required'} tone={ready ? undefined : 'need'} /></li>)}</ul>
      <p>Pier holds stock and records what ships. Pick, pack and dispatch in Pier for warehouse work; Stall checks Pier when Orders refreshes and shows its shipment references and tracking. If you arrange delivery yourself, prepare and approve shipping in Stall to record that dispatch in Pier. Choose one place to dispatch each order.</p>
      {!Object.values(state.connections).every(Boolean) && <Notice>External setup is incomplete. Checkout, stock reservation, payment confirmation and shipping require the corresponding provider connection.</Notice>}
      {owner && <><ProviderBoundaries /><ConnectPier state={state} busy={busy} run={run} /><ConnectStripe state={state} busy={busy} run={run} /></>}
      <ProviderLinks />
    </Section>
    {!state.actor.agent && <ShopTimeZone timeZone={state.timeZone ?? defaultTimeZone} busy={busy} run={run} />}
    {owner && <ShippingCharge shippingCents={state.shippingCents ?? 0} busy={busy} run={run} />}
    <Operations />
    <Section title="Your account"><div className="st-row"><p>{state.people[state.actor.id] ?? state.actor.email}<small>{state.actor.email} · {state.actor.role}</small></p><a className="st-button st-secondary" href="/auth/settings/identity">Account settings</a></div></Section>
    {owner && <><AgentCredential /><BusinessExports /><Portability reload={reload} /><CustomerErasure busy={busy} run={run} /></>}
  </div>
}
