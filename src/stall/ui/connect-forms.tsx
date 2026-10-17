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
    {state.connections.pier ? <p className="st-small">Stock and paid orders go to Pier at {details?.origin}. {where(details?.source ?? null)}</p> : <p className="st-small">Pier is the stock desk this shop sells from. In Pier, open <strong>Channels</strong>, add the Stall connection, choose the shop customer and choose <strong>Create Stall’s key to Pier</strong>. Paste the address and key Pier shows here.</p>}
    <label>Pier address<input name="origin" type="url" required placeholder="http://localhost:8787" value={origin} onChange={event => setOrigin(event.target.value)} /><small>From Pier’s browser tab, up to the first single slash.</small></label>
    <label>Pier key<input name="key" type="password" required autoComplete="off" spellCheck={false} placeholder="pier_stall_…" value={key} onChange={event => setKey(event.target.value)} /><small>Pier shows it once. Stall checks it with Pier before saving and keeps it encrypted.</small></label>
    <div className="st-actions"><button disabled={busy || !origin.trim() || !key.trim()}>{state.connections.pier ? 'Save new Pier key' : 'Connect Pier'}</button>{details?.source === 'this page' && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('connection.remove', { name: 'pier' })}>Disconnect Pier</button>}</div>
  </form>
}

export function ConnectStripe({ state, busy, run }: { state: State; busy: boolean; run: Run }) {
  const details = state.connectionDetails?.stripe, [secretKey, setSecretKey] = useState(''), [webhookSecret, setWebhookSecret] = useState('')
  const ready = state.connections.stripe && state.connections.webhook
  return <form className="st-review st-stack" aria-label="Connect Stripe" onSubmit={event => { event.preventDefault(); void run('connection.stripe', { secretKey, webhookSecret }).then(ok => { if (ok) { setSecretKey(''); setWebhookSecret('') } }) }}>
    <h3>Connect Stripe {ready ? <Badge value={details?.mode === 'live' ? 'Live payments' : 'Test payments'} /> : <Badge value="Not connected" tone="need" />}</h3>
    {ready ? <p className="st-small">Checkout takes payments through your Stripe account. {where(details?.source ?? null)}</p> : <p className="st-small">Customers pay through Stripe’s hosted checkout on your own Stripe account. In Stripe open <strong>Developers → API keys</strong> for the secret key, and <strong>Developers → Webhooks → Add endpoint</strong> for this shop’s address followed by <code>/api/stall/webhook</code> with the <code>checkout.session.completed</code> event for the signing secret. Use test keys until you are ready to sell.</p>}
    <label>Stripe secret key<input name="secretKey" type="password" required autoComplete="off" spellCheck={false} placeholder="sk_test_…" value={secretKey} onChange={event => setSecretKey(event.target.value)} /></label>
    <label>Webhook signing secret<input name="webhookSecret" type="password" required autoComplete="off" spellCheck={false} placeholder="whsec_…" value={webhookSecret} onChange={event => setWebhookSecret(event.target.value)} /><small>A shop on this computer cannot receive Stripe’s webhook; after a test payment, open the order and choose Reconcile to confirm it.</small></label>
    <div className="st-actions"><button disabled={busy || !secretKey.trim() || !webhookSecret.trim()}>{ready ? 'Save new Stripe keys' : 'Connect Stripe'}</button>{details?.source === 'this page' && <button type="button" className="st-secondary" disabled={busy} onClick={() => void run('connection.remove', { name: 'stripe' })}>Disconnect Stripe</button>}</div>
  </form>
}
