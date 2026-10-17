// Settings: provider connections and the signed-in account for everyone; agent
// access, the data archive and customer erasure for the owner.
import type { Run, State } from './types'
import { Badge, Notice, ProviderLinks, Section } from './primitives'
import { Portability } from './portability'
import { AgentCredential } from './agent-credential'
import { CustomerErasure } from './data'
import { ConnectPier, ConnectStripe } from './connect-forms'

export const providers: Record<string, [string, string]> = { pier: ['Pier stock', 'Catalog stock, reservations and shipping'], stripe: ['Stripe checkout', 'Hosted checkout and refunds on your Stripe account'], webhook: ['Stripe webhooks', 'Signed payment confirmations'] }
export function Settings({ state, owner, busy, run, reload }: { state: State; owner: boolean; busy: boolean; run: Run; reload: () => Promise<void> }) {
  return <div className="st-settings">
    <h1>Settings</h1>
    <Section id="connections" title="Provider connections">
      <ul className="st-connections">{Object.entries(state.connections).map(([name, ready]) => <li key={name}><div><strong>{providers[name]?.[0] ?? name}</strong><small>{providers[name]?.[1]}</small></div><Badge value={ready ? 'Configured' : 'Setup required'} tone={ready ? undefined : 'need'} /></li>)}</ul>
      {!Object.values(state.connections).every(Boolean) && <Notice>External setup is incomplete. Checkout, stock reservation, payment confirmation and shipping require the corresponding provider connection.</Notice>}
      {owner && <><ConnectPier state={state} busy={busy} run={run} /><ConnectStripe state={state} busy={busy} run={run} /></>}
      <ProviderLinks />
    </Section>
    <Section title="Your account"><div className="st-row"><p>{state.people[state.actor.id] ?? state.actor.email}<small>{state.actor.email} · {state.actor.role}</small></p><a className="st-button st-secondary" href="/auth/settings/identity">Account settings</a></div></Section>
    {owner && <><AgentCredential /><Portability reload={reload} /><CustomerErasure busy={busy} run={run} /></>}
  </div>
}
