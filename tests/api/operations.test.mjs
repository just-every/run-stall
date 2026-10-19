import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, publish, purchase, deliverWebhook } from './network.mjs'

// Only provider network faults are faked. Both applications use their real Workers/databases.
test('OPS-001: diagnose providers and scheduler, restore outstanding work, reconcile original effects', async () => {
 const pier = await pierInstallation(), edge = stripeEdge({ forward: pier.forward }), secret = randomBytes(32).toString('hex')
 let unavailable = false, destination
 const bindings = { ...pier.bindings, STRIPE_SECRET_KEY: 'test-network-edge', STRIPE_WEBHOOK_SECRET: secret }
 const outboundService = request => unavailable ? Response.json({ error: 'provider unavailable' }, { status: 503 }) : edge.handle(request)
 const h = await installation({ bindings, outboundService })
 const ops = () => h.api('/api/stall/operations')
 const scheduled = async app => { const outcome = await (await app.mf.getWorker()).scheduled({ scheduledTime: new Date(), cron: '* * * * *' }); assert.equal(outcome.outcome, 'ok') }
 try {
  await h.api('/api/stall/operations', undefined, { as: '', status: 401 })
  const member = await h.signIn('helper@example.test'), admin = await h.signIn('admin@example.test', 'admin')
  await h.api('/api/stall/operations', undefined, { as: member, status: 403 })
  await h.api('/api/stall/operations/probe', {}, { as: member, status: 403 })
  const grant = await h.api('/api/stall/agent-token', {})
  await h.api('/api/stall/operations', undefined, { as: '', headers: { authorization: `Bearer ${grant.token}` }, status: 403 })
  await h.api('/api/stall/operations/probe', {}, { as: '', headers: { authorization: `Bearer ${grant.token}` }, status: 403 })
  const fresh = await ops()
  assert.equal(fresh.database.ok, true)
  assert.equal(fresh.providers.stripe.lastObservation, null)
  assert.equal(fresh.scheduler, null)
  assert.equal(fresh.outstanding.total, 0)
  const checked = await h.api('/api/stall/operations/probe', {}, { as: admin })
  for (const provider of Object.values(checked.providers)) {
   assert.equal(provider.lastObservation.status, 'ready')
   assert.ok(Number.isFinite(Date.parse(provider.lastObservation.checkedAt)))
  }
  await publish(h, 'MUG-BLUE', 'Blue ceramic mug', 2450)
  await publish(h, 'TOWEL-NAT', 'Natural linen towel', 1800)
  const bought = await purchase(h, edge)
  edge.pay(bought.session.id)
  unavailable = true
  await scheduled(h)
  const failed = await h.api('/api/stall/operations/probe', {})
  assert.equal(failed.scheduler.failed, 1)
  assert.equal(failed.scheduler.status, 'failed')
  assert.ok(failed.scheduler.lastErrorCode)
  assert.ok(failed.scheduler.completedAt)
  assert.equal(failed.providers.stripe.lastObservation.status, 'unavailable')
  assert.equal(failed.providers.pier.lastObservation.status, 'unavailable')
  assert.equal(failed.outstanding.counts.awaitingPayment, 1)
  assert.equal(failed.outstanding.orders[0].checkoutSessionId, bought.session.id)
  const serialized = JSON.stringify(failed)
  for (const value of [secret, bindings.STRIPE_SECRET_KEY, bindings.PIER_SESSION, grant.token, 'customer@example.test']) assert.ok(!serialized.includes(value))
  unavailable = false
  await scheduled(h)
  const resumed = await ops()
  assert.equal(resumed.scheduler.confirmed, 1)
  assert.equal(resumed.scheduler.failed, 0)
  assert.equal(resumed.outstanding.counts.awaitingPayment, 0)
  let value = (await h.api('/api/stall/state')).orders.find(order => order.id === bought.orderId)
  value = await h.command('shipment.prepare', { orderId: value.id, revision: value.revision, reference: 'USPS RECOVERY' })
  value = await h.command('shipment.approve', { orderId: value.id, revision: value.revision })
  value = await h.command('refund.prepare', { orderId: value.id, revision: value.revision, kind: 'goodwill', amountCents: 500, reason: 'Late parcel' })
  edge.loseNextRefundResponse()
  await h.command('refund.approve', { orderId: value.id, revision: value.revision }, { status: 503 })
  const waiting = await purchase(h, edge, { email: 'waiting@example.test' })
  const outstanding = await ops()
  assert.equal(outstanding.outstanding.total, 2)
  const uncertain = outstanding.outstanding.orders.find(order => order.id === value.id)
  assert.equal(uncertain.paymentIntentId, bought.session.payment_intent)
  assert.equal(uncertain.refunds[0].status, 'pending')
  assert.equal(uncertain.refunds[0].id, value.refunds[0].id)
  const saved = await archive(h)
  destination = await installation({ bindings, outboundService })
  await scheduled(destination)
  assert.equal((await destination.api('/api/stall/operations')).scheduler.checked,0)
  await restore(destination, saved)
  const copied = await destination.api('/api/stall/operations')
  assert.equal(copied.outstanding.total, 2)
  assert.equal(copied.scheduler.attemptedAt, outstanding.scheduler.attemptedAt)
  value = (await destination.api('/api/stall/state')).orders.find(order => order.id === value.id)
  value = await destination.command('refund.approve', { orderId: value.id, revision: value.revision })
  assert.equal(value.refunds[0].status, 'succeeded')
  assert.equal(edge.refunds.size, 1)
  assert.equal(value.payment.intentId, bought.session.payment_intent)
  const paid = edge.pay(waiting.session.id)
  const delivered = await deliverWebhook(destination, secret, paid)
  assert.equal(delivered.response.status, 200)
  const final = await destination.api('/api/stall/operations/probe', {})
  assert.equal(final.outstanding.total, 0)
  assert.equal(final.providers.stripe.lastObservation.status, 'ready')
  assert.equal((await pier.api('/api/pier/state')).shipments.length, 1)
 } finally { await destination?.close(); await h.close(); await pier.close() }
})
