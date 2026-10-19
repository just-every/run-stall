// The owner connects Pier and Stripe here: an address and a key each, saved in
// Stall's own database. Nothing to edit in files and no restart.
import { useState } from 'react'
import type { Run, State } from './types'
import { Badge } from './primitives'

function where(source: string | null) { return source === 'server settings' ? 'Set in Stall’s server settings, which take priority over this page.' : source === 'this page' ? 'Saved on this page.' : '' }

export function ConnectPier({ state, busy, run }: { state: State; busy: boolean; run: Run }) {
  const details = state.connectionDetails?.pier, [origin, setOrigin] = useState(details?.origin ?? ''), [key, setKey] = useState('')
  return <form className="st-review st-stack" aria-label="Connect Pier" onSubmit={event => { event.preventDefault(); void run('connection.pier', { origin, key }).then(ok => { if (ok) setKey('') }) }}>
    <h3>Connect Pier {state.connections.pier ? <Badge value="Connected" /> : <Badge value="Not connected" tone="need" />}</h3>
    <p className="st-small">Pier is <a href="https://github.com/just-every/run-pier/blob/main/LICENSE" target="_blank" rel="noreferrer">free, MIT-licensed software</a>. You pay your hosting provider for running it; see <a href="https://developers.cloudflare.com/workers/platform/pricing/" target="_blank" rel="noreferrer">Cloudflare hosting pricing</a> if you use Cloudflare. Pier records dispatches; it does not buy postage. Pay your carrier separately for delivery.</p>
    {state.connections.pier ? <p className="st-small">Stock and paid orders go to Pier at {details?.origin}. {where(details?.source ?? null)}</p> : <p className="st-small">Pier is the stock desk this shop sells from. In Pier, open <strong>Channels</strong>, add the Stall connection, choose the shop customer and choose <strong>Create Stall’s key to Pier</strong>. Paste the address and key Pier shows here.</p>}
    <label>Pier address<input name="origin" type="url" required placeholder="http://localhost:8787" value={origin} onChange={event => setOrigin(event.target.value)} /><small>From Pier’s browser tab, up to the first single slash.</small></label>
    <label>Pier key<input name="key" type="password" required autoComplete="off" spellCheck={false} placeholder="pier_stall_…" value={key} onChange={event => setKey(event.target.value)} /><small>Pier shows it once. Stall checks it with Pier before saving and keeps it encrypted.</small></label>
    <div className="st-actions"><button disabled={busy || !origin.trim() || !key.trim()}>{state.connections.pier ? 'Save new Pier key' : 'Connect Pier'}</button>{details?.source === 'this page' && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('connection.remove', { name: 'pier' })}>Disconnect Pier</button>}</div>
  </form>
}

export function ConnectStripe({ state, busy, run }: { state: State; busy: boolean; run: Run }) {
  const details = state.connectionDetails?.stripe, local = !!details?.local, [secretKey, setSecretKey] = useState(''), [webhookSecret, setWebhookSecret] = useState('')
  const ready = state.connections.stripe && state.connections.webhook
  return <form className="st-review st-stack" aria-label="Connect Stripe" onSubmit={event => { event.preventDefault(); void run('connection.stripe', local ? { secretKey } : { secretKey, webhookSecret }).then(ok => { if (ok) { setSecretKey(''); setWebhookSecret('') } }) }}>
    <h3>Connect Stripe {ready ? <Badge value={details?.mode === 'live' ? 'Live payments' : 'Test payments'} /> : <Badge value="Not connected" tone="need" />}</h3>
    <p className="st-small">Stripe bills your account for payment processing and other services you enable. Review <a href="https://stripe.com/pricing" target="_blank" rel="noreferrer">Stripe pricing</a> before connecting. Stall adds no transaction fee.</p>
    {ready ? <p className="st-small">Checkout takes payments through your Stripe account. {where(details?.source ?? null)}</p> : <p className="st-small">Customers pay through Stripe’s hosted checkout on your own Stripe account. In Stripe open <strong>Developers → API keys</strong> and copy the secret key. Use test keys until you are ready to sell.</p>}
    <label>Stripe secret key<input name="secretKey" type="password" required autoComplete="off" spellCheck={false} placeholder="sk_test_…" value={secretKey} onChange={event => setSecretKey(event.target.value)} /></label>
    {local ? <div className="st-small st-stack">
      <p><strong>Payment confirmations on this computer.</strong> Stripe sends webhooks only to a public web address, so this shop does not use them. Stall asks Stripe about each payment instead: when the customer comes back from checkout, every minute while an order waits, and when you choose <strong>Reconcile</strong> on an order.</p>
      <p><strong>Webhooks are for an online shop.</strong> Once this shop is deployed with <code>rer deploy</code>, open its Settings there. In Stripe open <strong>Developers → Webhooks → Add endpoint</strong>, enter the shop’s web address followed by <code>/api/stall/webhook</code>, choose the <code>checkout.session.completed</code> and <code>checkout.session.async_payment_succeeded</code> events, and paste the endpoint’s signing secret (it starts with <code>whsec_</code>) into the online shop’s Connect Stripe form.</p>
    </div> : <label>Webhook signing secret<input name="webhookSecret" type="password" required autoComplete="off" spellCheck={false} placeholder="whsec_…" value={webhookSecret} onChange={event => setWebhookSecret(event.target.value)} /><small>In Stripe open <strong>Developers → Webhooks → Add endpoint</strong>. Enter this shop’s address followed by <code>/api/stall/webhook</code> and choose the <code>checkout.session.completed</code> and <code>checkout.session.async_payment_succeeded</code> events. Stripe then shows the endpoint’s signing secret, which starts with <code>whsec_</code>.</small></label>}
    <div className="st-actions"><button disabled={busy || !secretKey.trim() || (!local && !webhookSecret.trim())}>{ready ? 'Save new Stripe keys' : 'Connect Stripe'}</button>{details?.source === 'this page' && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('connection.remove', { name: 'stripe' })}>Disconnect Stripe</button>}</div>
  </form>
}
