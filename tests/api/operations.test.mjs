import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, publish, purchase, deliverWebhook } from './network.mjs'
import { readCsv } from './csv-reader.mjs'

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

// INTEGRATION-001 hard slice: durable intent survives response loss and archive
// recovery. The fake is only Stripe's paid network boundary; Pier is real.
test('INTEGRATION-001: uncertain Stripe writes recover by original reference without any replacement, including after restore', async () => {
 const pier = await pierInstallation(), edge = stripeEdge({ forward: pier.forward }), secret = randomBytes(32).toString('hex')
 const bindings = { ...pier.bindings, STRIPE_SECRET_KEY: 'test-network-edge', STRIPE_WEBHOOK_SECRET: secret }
 let lookup = 'normal', destination, disconnected, mutations = [], claims = []
 const h = await installation({ bindings, outboundService: async request => {
  const url = new URL(request.url)
  if (url.hostname === 'api.stripe.com' && request.method === 'POST') {
   // The public request must persist its attempt before crossing the network.
   const rows = (await h.db.prepare('SELECT * FROM st_stripe_work').all()).results
   claims.push(rows.some(row => row.status === 'uncertain' && row.attempts === 1))
   mutations.push(url.pathname)
  }
  if (url.hostname === 'api.stripe.com' && request.method === 'GET' && url.pathname === '/v1/checkout/sessions') {
   if (lookup === 'down') return Response.json({ error: 'unavailable' }, { status: 503 })
   if (lookup === 'empty') return Response.json({ object: 'list', data: [], has_more: false })
   if (lookup === 'ambiguous') {const original = [...edge.sessions.values()][0];return Response.json({ object: 'list', data: [original, { ...original, id: 'cs_duplicate' }], has_more: false })}
   if (lookup === 'bounded') return Response.json({ object: 'list', data: [{ id: 'cs_page_' + (url.searchParams.get('starting_after') ?? 'first') }], has_more: true })
  }
  return edge.handle(request)
 } })
 try {
  await publish(h, 'MUG-BLUE', 'Blue ceramic mug', 2450)
  const input = { customerEmail: 'customer@example.test', lines: [{ sku: 'MUG-BLUE', quantity: 1 }], idempotencyKey: crypto.randomUUID() }
  edge.loseNextCheckoutResponse()
  await h.api('/api/stall/checkout', input, { as: '', status: 503 })
  assert.equal(edge.sessions.size, 1)
  const initial = await h.api('/api/stall/operations')
  assert.equal(initial.stripeWork.uncertain, 1)
  const work = initial.stripeWork.records[0]
  assert.equal(work.kind, 'checkout'); assert.equal(work.status, 'uncertain'); assert.equal(work.attempts, 1)
  assert.equal(work.providerId, null)
  for (const mode of ['down', 'empty', 'ambiguous', 'bounded']) {
   lookup = mode
   const before = mutations.length
   await h.api('/api/stall/checkout', input, { as: '', status: mode === 'down' ? 503 : 409 })
   assert.equal(mutations.length, before, `${mode} lookup must never authorize another write`)
  }
  lookup = 'normal'
  const original = [...edge.sessions.values()][0]
  // Match lies beyond the first provider page; unrelated operations never match.
  for (let i = 0; i < 101; i++) edge.sessions.set('cs_other_' + i, { ...original, id: 'cs_other_' + i, client_reference_id: 'another-order', metadata: { stall_order_id: 'another-order' } })
  const recovered = await h.api('/api/stall/checkout', input, { as: '' })
  const session = [...edge.sessions.values()][0]
  assert.equal(recovered.orderId, work.orderId); assert.equal(recovered.url, session.url)
  await h.api('/api/stall/checkout', { ...input, lines: [{ sku: 'MUG-BLUE', quantity: 2 }] }, { as: '', status: 409 })
  assert.equal(mutations.length, 1)
  assert.equal((await h.api('/api/stall/operations')).stripeWork.records[0].providerId, session.id)
  assert.equal((await deliverWebhook(h, secret, edge.pay(session.id))).response.status, 200)
  let value = (await h.api('/api/stall/state')).orders.find(order => order.id === work.orderId)
  value = await h.command('shipment.prepare', { orderId: value.id, revision: value.revision, reference: 'USPS ORIGINAL' })
  value = await h.command('shipment.approve', { orderId: value.id, revision: value.revision })
  value = await h.command('refund.prepare', { orderId: value.id, revision: value.revision, kind: 'goodwill', amountCents: 500, reason: 'Late parcel' })
  edge.loseNextRefundResponse()
  await h.command('refund.approve', { orderId: value.id, revision: value.revision }, { status: 503 })
  assert.equal(edge.refunds.size, 1)
  assert.equal((await h.api('/api/stall/operations')).stripeWork.uncertain, 1)
  // Recovery remains read-only beyond Stripe's idempotency retention window.
  const stored = JSON.parse((await h.db.prepare('SELECT value_json FROM st_orders WHERE id=?').bind(value.id).first()).value_json)
  stored.refunds[0].startedAt = new Date(Date.now() - 48 * 3600000).toISOString()
  await h.db.prepare('UPDATE st_orders SET value_json=? WHERE id=?').bind(JSON.stringify(stored), value.id).run()
  const saved = await archive(h)
  destination = await installation({ bindings, outboundService: edge.handle })
  await restore(destination, saved)
  assert.equal((await destination.api('/api/stall/operations')).stripeWork.uncertain, 1)
  value = (await destination.api('/api/stall/state')).orders.find(order => order.id === value.id)
  const before = edge.calls.filter(call => call.method === 'POST').length
  value = await destination.command('refund.approve', { orderId: value.id, revision: value.revision })
  assert.equal(value.refunds[0].status, 'succeeded')
  assert.equal(value.refunds[0].stripeId, [...edge.refunds.keys()][0])
  assert.equal(edge.calls.filter(call => call.method === 'POST').length, before)
  assert.equal(edge.refunds.size, 1)
  assert.ok(edge.calls.some(call => call.path === '/v1/refunds' && call.method === 'GET' && new URLSearchParams(call.query).get('payment_intent') === session.payment_intent))
  const final = await destination.api('/api/stall/operations')
  assert.equal(final.stripeWork.uncertain, 0)
  assert.ok(final.stripeWork.records.every(record => record.attempts === 1 && record.providerId && record.status === 'response_observed'))
  const exported = await (await destination.request('/api/stall/exports/records')).json()
  assert.equal(exported.stripeWork.length, 2)
  const csv = readCsv(await (await destination.request('/api/stall/exports/stripe-work')).text())
  assert.deepEqual(csv.map(row => row.providerId).sort(), final.stripeWork.records.map(row => row.providerId).sort())
  assert.ok(csv.every(row => row.attempts === '1' && row.status === 'response_observed'))
  assert.deepEqual(exported.stripeWork, final.stripeWork.records)
  const serialized = JSON.stringify(final.stripeWork) + JSON.stringify(exported.stripeWork)
  for (const forbidden of [bindings.STRIPE_SECRET_KEY, bindings.PIER_SESSION, secret, input.customerEmail, 'intentHash']) assert.ok(!serialized.includes(forbidden))
  assert.ok(claims.length === 2 && claims.every(Boolean))
  // A verified webhook can also observe a lost checkout response, without replay.
  edge.loseNextCheckoutResponse()
  await h.api('/api/stall/checkout', { ...input, idempotencyKey: crypto.randomUUID() }, { as: '', status: 503 })
  const lost = [...edge.sessions.values()].at(-1)
  assert.equal((await h.api('/api/stall/operations')).stripeWork.uncertain, 2) // original refund remains uncertain on the source
  assert.equal((await deliverWebhook(h, secret, edge.pay(lost.id))).response.status, 200)
  const observed = (await h.api('/api/stall/operations')).stripeWork.records.find(record => record.providerId === lost.id)
  assert.equal(observed.status, 'response_observed')
  assert.equal(edge.calls.filter(call => call.path === '/v1/checkout/sessions' && call.method === 'POST').length, 2)
  const paidInput = { ...input, idempotencyKey: crypto.randomUUID() }
  edge.loseNextCheckoutResponse()
  await h.api('/api/stall/checkout', paidInput, { as: '', status: 503 })
  const paidWithoutWebhook = edge.pay([...edge.sessions.keys()].at(-1))
  paidWithoutWebhook.url = null // Stripe no longer offers a payable URL after completion.
  const receipt = await h.api('/api/stall/checkout', paidInput, { as: '' })
  assert.equal(receipt.orderId, paidWithoutWebhook.client_reference_id)
  assert.equal(receipt.status, 'reserved')
  assert.ok(receipt.url.startsWith('/order?checkout=success&orderId='))
  assert.equal(edge.calls.filter(call => call.path === '/v1/checkout/sessions' && call.method === 'POST').length, 3)
  // A known-unsent operation survives disconnect/reconnect without becoming a
  // replacement for uncertain work. All changes use owner connection doors.
  disconnected = await installation({ bindings: pier.bindings, outboundService: edge.handle })
  const connect = () => disconnected.command('connection.stripe', { secretKey: 'sk_test_' + randomBytes(16).toString('hex'), webhookSecret: 'whsec_' + randomBytes(16).toString('hex') })
  await connect()
  await publish(disconnected, 'MUG-BLUE', 'Blue ceramic mug', 2450)
  const next = await purchase(disconnected, edge, { skus: ['MUG-BLUE'] })
  edge.pay(next.session.id)
  let unsent = await disconnected.command('order.reconcile', { orderId: next.orderId })
  unsent = await disconnected.command('shipment.prepare', { orderId: unsent.id, revision: unsent.revision, reference: 'USPS UNSENT' })
  unsent = await disconnected.command('shipment.approve', { orderId: unsent.id, revision: unsent.revision })
  unsent = await disconnected.command('refund.prepare', { orderId: unsent.id, revision: unsent.revision, kind: 'goodwill', amountCents: 200, reason: 'Late delivery' })
  await disconnected.command('connection.remove', { name: 'stripe' })
  const beforeUnsent = edge.calls.filter(call => call.method === 'POST').length
  await disconnected.command('refund.approve', { orderId: unsent.id, revision: unsent.revision }, { status: 503 })
  assert.equal(edge.calls.filter(call => call.method === 'POST').length, beforeUnsent)
  const prepared = (await disconnected.api('/api/stall/operations')).stripeWork.records.find(record => record.kind === 'refund')
  assert.equal(prepared.status, 'prepared'); assert.equal(prepared.attempts, 0)
  await connect()
  unsent = await disconnected.command('order.reconcile', { orderId: unsent.id })
  assert.equal(unsent.refunds[0].status, 'succeeded')
  assert.equal(edge.calls.filter(call => call.method === 'POST').length, beforeUnsent + 1)
  const sent = (await disconnected.api('/api/stall/operations')).stripeWork.records.find(record => record.kind === 'refund')
  assert.equal(sent.id, prepared.id); assert.equal(sent.attempts, 1)
  const concurrentInput = { ...input, idempotencyKey: crypto.randomUUID() }
  const beforeConcurrent = edge.calls.filter(call => call.path === '/v1/checkout/sessions' && call.method === 'POST').length
  const replies = await Promise.all([1, 2].map(() => h.request('/api/stall/checkout', { method: 'POST', body: concurrentInput, as: '' })))
  assert.ok(replies.some(response => response.ok), 'the original purchase must not be fenced out by its duplicate')
  assert.ok(replies.every(response => response.ok || response.status === 409))
  assert.equal(edge.calls.filter(call => call.path === '/v1/checkout/sessions' && call.method === 'POST').length, beforeConcurrent + 1)
 } finally { await disconnected?.close(); await destination?.close(); await h.close(); await pier.close() }
})

// Canonical Stripe reads are the only fake boundary; order/auth/stock/archive are real Workers.
test('RISK-001: restricted advisory queue holds fulfillment, records human review and deduplicates callbacks', async () => {
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1',STRIPE_WEBHOOK_SECRET:secret}
 const intents=new Map(),providerWrites=[]
 const outboundService=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.stripe.com'&&request.method==='POST') providerWrites.push(url.pathname)
  if(url.hostname==='api.stripe.com'&&url.pathname.startsWith('/v1/payment_intents/')) {
   assert.equal(request.method,'GET')
   assert.ok(url.searchParams.getAll('expand[]').includes('latest_charge'))
   const intent=intents.get(decodeURIComponent(url.pathname.split('/').at(-1)))
   return intent?Response.json(intent):Response.json({error:'missing'},{status:404})
  }
  return edge.handle(request)
 }
 const h=await installation({bindings,outboundService})
 let destination
 const snapshot=()=>h.api('/api/stall/risk')
 const stateOrder=async id=>(await h.api('/api/stall/state')).orders.find(order=>order.id===id)
 const canonical=(session,level='normal',score=4)=>{
  const charge={id:'synthetic-stall-2-'+session.client_reference_id,object:'charge',payment_intent:session.payment_intent,outcome:{risk_level:level,risk_score:score},payment_method_details:{card:{checks:{address_line1_check:'pass',address_postal_code_check:'pass',cvc_check:'pass'}}}}
  const intent={id:session.payment_intent,object:'payment_intent',metadata:{stall_order_id:session.client_reference_id},amount:session.amount_total,currency:session.currency,status:'succeeded',latest_charge:charge}
  intents.set(intent.id,intent);return intent
 }
 const rules={enabled:true,holdElevated:true,holdHighest:true,holdAddressMismatch:true,holdPaymentMismatch:true,scoreThreshold:70}
 try {
  const member=await h.signIn('synthetic-stall-3@example.test'),admin=await h.signIn('synthetic-stall-4@example.test','admin'),grant=await h.api('/api/stall/agent-token',{})
  await h.api('/api/stall/risk',undefined,{as:'',status:401})
  await h.api('/api/stall/risk',undefined,{as:member,status:403})
  await h.api('/api/stall/risk',undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  for(const type of ['risk.configure','risk.release','risk.cancel']) {
   await h.command(type,rules,{as:member,status:403})
   await h.command(type,rules,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  }
  await publish(h,'MUG-BLUE','Synthetic cup',2450)
  const low=await purchase(h,edge,{skus:['MUG-BLUE'],email:'synthetic-stall-5@example.test'})
  const lowSession=edge.pay(low.session.id);canonical(lowSession)
  assert.equal((await deliverWebhook(h,secret,lowSession)).response.status,200)
  assert.equal((await snapshot()).queue.length,0)
  await h.command('risk.configure',rules,{as:admin})
  const unreviewed=await stateOrder(low.orderId)
  assert.equal((await h.command('shipment.prepare',{orderId:low.orderId,revision:unreviewed.revision,reference:'synthetic-stall-11'},{status:409})).error.code,'RISK_PENDING')
  await h.command('risk.refresh',{orderId:low.orderId})
  assert.equal((await snapshot()).queue.find(row=>row.orderId===low.orderId).status,'clear')
  const flagged=await purchase(h,edge,{skus:['MUG-BLUE'],email:'synthetic-stall-6@example.test'})
  const flaggedSession=edge.pay(flagged.session.id),intent=canonical(flaggedSession,'elevated',82)
  intent.latest_charge.payment_method_details.card.checks.address_postal_code_check='fail'
  // Even a signed callback's advisory fields cannot replace a canonical provider read.
  const misleading={...flaggedSession,outcome:{risk_level:'normal',risk_score:0}}
  assert.equal((await deliverWebhook(h,'synthetic-stall-13',misleading)).response.status,400)
  assert.ok(!(await snapshot()).queue.some(entry=>entry.orderId===flagged.orderId))
  const original=await deliverWebhook(h,secret,misleading)
  assert.equal(original.response.status,200)
  let snap=await snapshot(),row=snap.queue.find(entry=>entry.orderId===flagged.orderId)
  assert.equal(row.status,'held')
  assert.ok(row.reasons.includes('address_check_mismatch'))
  assert.ok(row.signals.some(signal=>signal.provider==='stripe'&&signal.objectId===intent.latest_charge.id&&signal.field==='outcome.risk_score'&&signal.value===82))
  assert.equal(snap.notifications.filter(entry=>entry.orderId===flagged.orderId).length,1)
  let order=await stateOrder(flagged.orderId)
  const held=await h.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'synthetic-stall-7'},{status:409})
  assert.equal(held.error.code,'RISK_HELD')
  assert.equal((await pier.api('/api/pier/state')).shipments.length,0)
  assert.equal((await deliverWebhook(h,secret,misleading,{id:original.id})).response.status,200)
  assert.equal((await deliverWebhook(h,secret,misleading)).response.status,200)
  assert.equal((await snapshot()).queue.find(entry=>entry.orderId===order.id).revision,row.revision)
  row=await h.command('risk.release',{orderId:order.id,revision:row.revision},{as:admin})
  assert.equal(row.status,'released');assert.equal(row.reviewer.decision,'release');assert.ok(row.reviewer.id)
  await h.command('risk.cancel',{orderId:order.id,revision:'synthetic-stall-8'},{status:409})
  assert.equal((await deliverWebhook(h,secret,misleading)).response.status,200)
  assert.equal((await snapshot()).queue.find(entry=>entry.orderId===order.id).status,'released')
  order=await stateOrder(order.id)
  order=await h.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'synthetic-stall-9'})
  // Fresh provider signals reopen review even after a prior release.
  intent.latest_charge.outcome={risk_level:'highest',risk_score:96}
  assert.equal((await deliverWebhook(h,secret,flaggedSession)).response.status,200)
  snap=await snapshot();row=snap.queue.find(entry=>entry.orderId===order.id)
  assert.equal(row.status,'held');assert.equal(snap.notifications.filter(entry=>entry.orderId===order.id).length,2)
  const approval=await h.command('shipment.approve',{orderId:order.id,revision:order.revision},{status:409})
  assert.equal(approval.error.code,'RISK_HELD')
  const stockBefore=(await pier.api('/api/pier/state')).orders.find(entry=>entry.id===order.reservation.id)
  const writesBefore=providerWrites.length
  row=await h.command('risk.cancel',{orderId:order.id,revision:row.revision})
  assert.equal(row.status,'canceled');assert.equal(row.reviewer.decision,'cancel')
  assert.equal(providerWrites.length,writesBefore)
  assert.deepEqual((await pier.api('/api/pier/state')).orders.find(entry=>entry.id===order.reservation.id),stockBefore)
  assert.equal((await pier.api('/api/pier/state')).shipments.length,0)
  order=await stateOrder(order.id)
  assert.ok(order.reservation);assert.ok(order.payment);assert.equal(order.refunds.length,0)
  assert.equal((await h.command('shipment.approve',{orderId:order.id,revision:order.revision},{status:409})).error.code,'RISK_CANCELED')
  // A later risk flag cannot silently deny a separately authorized refund.
  // Existing refund policy requires shipment first, independent of risk.
  let refundable=await stateOrder(low.orderId)
  refundable=await h.command('shipment.prepare',{orderId:refundable.id,revision:refundable.revision,reference:'synthetic-stall-14'})
  refundable=await h.command('shipment.approve',{orderId:refundable.id,revision:refundable.revision})
  intents.get(lowSession.payment_intent).latest_charge.outcome={risk_level:'highest',risk_score:99}
  assert.equal((await deliverWebhook(h,secret,lowSession)).response.status,200)
  assert.equal((await snapshot()).queue.find(entry=>entry.orderId===low.orderId).status,'held')
  refundable=await h.command('refund.prepare',{orderId:refundable.id,revision:refundable.revision,kind:'goodwill',amountCents:100,reason:'synthetic-stall-10'})
  refundable=await h.command('refund.approve',{orderId:refundable.id,revision:refundable.revision})
  assert.equal(refundable.refunds[0].status,'succeeded')
  const notification=(await snapshot()).notifications[0]
  await h.command('risk.notification.read',{id:notification.id},{as:admin})
  snap=await snapshot()
  assert.ok(snap.notifications.find(entry=>entry.id===notification.id).readBy)
  assert.deepEqual(snap.decisions.filter(entry=>entry.orderId===order.id).map(entry=>entry.decision).sort(),['cancel','release'])
  const history=await h.api('/api/stall/orders/history?orderId='+order.id)
  assert.ok(history.events.some(event=>event.action==='risk.released'&&event.actor===snap.decisions.find(entry=>entry.decision==='release').reviewerId))
  assert.ok(history.events.some(event=>event.action==='risk.canceled'))
  const serialized=JSON.stringify(snap)
  for(const value of [secret,bindings.STRIPE_SECRET_KEY,bindings.PIER_SESSION,grant.token,'synthetic-stall-6@example.test','1 Maker Lane']) assert.ok(!serialized.includes(value))
  const saved=await archive(h)
  destination=await installation({bindings,outboundService})
  await restore(destination,saved)
  const restored=await destination.api('/api/stall/risk')
  assert.deepEqual(restored.queue,snap.queue);assert.deepEqual(restored.decisions,snap.decisions);assert.deepEqual(restored.notifications,snap.notifications)
  assert.equal((await destination.command('shipment.approve',{orderId:order.id,revision:order.revision},{status:409})).error.code,'RISK_CANCELED')
 } finally { await destination?.close();await h.close();await pier.close() }
})

// Current sources and all workflow effects use public native doors. Only Stripe
// and an unavailable Pier network response are simulated at the provider edge.
test('FLOW-001: current-source rules, native customer requests, cron, quiet pause and visible failed follow-up', async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward})
 let unavailable=false
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-101',STRIPE_WEBHOOK_SECRET:'synthetic-stall-102'}
 const h=await installation({bindings,outboundService:r=>unavailable&&new URL(r.url).origin===pier.origin?Response.json({error:'synthetic-stall-103'},{status:503}):edge.handle(r)})
 const flow=async(type,payload={},opts={})=>{
  const value=await h.api('/api/stall/workflows',{type,payload},opts)
  return opts.status&&opts.status>=400?value:value.result
 }
 const snapshot=()=>h.api('/api/stall/workflows')
 const scheduled=async()=>{assert.equal((await(await h.mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'* * * * *'})).outcome,'ok')}
 try {
  const owner=(await h.api('/auth/session')).operator
  const member=await h.signIn('synthetic-stall-104@example.test'),admin=await h.signIn('synthetic-stall-105@example.test','admin')
  const packer=(await h.api('/auth/session',undefined,{as:member})).operator,administrator=(await h.api('/auth/session',undefined,{as:admin})).operator
  const grant=await h.api('/api/stall/agent-token',{})
  await h.api('/api/stall/workflows',undefined,{as:'',status:401})
  await h.api('/api/stall/workflows',undefined,{as:member,status:403})
  await h.api('/api/stall/workflows',undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  for(const type of ['workflow.save','workflow.activate','workflow.pause','workflow.run']) {
   await flow(type,{}, {as:member,status:403})
   await flow(type,{}, {as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  }
  await flow('workflow.run',{}, {headers:{origin:'https://synthetic-stall-106.test'},status:403})
  await h.command('staff.configure',{actorId:packer.id,staffRole:'fulfillment'})
  assert.equal((await h.api('/api/stall/workflows',undefined,{as:member})).canManage,false)
  await flow('workflow.save',{}, {as:member,status:403})
  const item=await pier.command('item.save',{sku:'synthetic-stall-107',name:'synthetic-stall-108',unit:'each',packSize:'1'})
  const supplier=await pier.command('party.save',{name:'synthetic-stall-109',kind:'supplier'})
  const po=await pier.command('po.draft',{supplierId:supplier.id,promiseDate:'2026-10-20',reason:'synthetic-stall-110',lines:[{itemId:item.id,quantity:'20',price:'2.00'}]})
  await pier.command('po.approve',{poId:po.id,version:po.version});await pier.command('po.commit',{poId:po.id,version:po.version})
  await pier.command('receipt.create',{poId:po.id,supplierReference:'synthetic-stall-111',lines:[{poLineId:po.lines[0].id,locationId:pier.location.id,quantity:'20',cost:'2.00'}]})
  await publish(h,item.sku,'synthetic-stall-112',200)
  const customer=await h.signIn('synthetic-stall-113@example.test'),otherCustomer=await h.signIn('synthetic-stall-114@example.test')
  const bought=await purchase(h,edge,{skus:[item.sku],email:'synthetic-stall-113@example.test'})
  const paid=edge.pay(bought.session.id)
  assert.equal((await deliverWebhook(h,bindings.STRIPE_WEBHOOK_SECRET,paid)).response.status,200)
  const before=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId)
  const create=async(trigger,extra={})=>flow('workflow.save',{rule:{name:'synthetic-stall-115 '+trigger,trigger,assigneeId:packer.id,dueMinutes:90,conditions:{},...extra}},{as:admin})
  const activate=r=>flow('workflow.activate',{id:r.id,revision:r.revision})
  const low=await create('low_stock',{conditions:{sku:item.sku,stockAtMost:19}})
  const dry=await flow('workflow.dry-run',{id:low.id})
  assert.equal(dry.total,1);assert.equal(dry.matches[0].sourceId,item.sku);assert.match(dry.matches[0].explanation,/19 sellable units/)
  assert.equal((await snapshot()).tasks.length,0)
  const overdue=await create('overdue_fulfillment',{conditions:{sku:item.sku,overdueHours:0},action:'draft_followup'})
  assert.equal((await flow('workflow.dry-run',{id:overdue.id})).total,1)
  const noMatch=await create('order',{conditions:{minTotalCents:before.totalCents+1}})
  assert.equal((await flow('workflow.dry-run',{id:noMatch.id})).total,0)
  const order=await create('order',{conditions:{sku:item.sku,status:'reserved',maxTotalCents:before.totalCents}})
  const returns=await create('return_request'),cancellations=await create('cancellation_request')
  const customerRule=await create('customer')
  const app=await h.api('/api/stall/v1/admin/apps',{label:'synthetic-stall-116',origin:h.origin,scopes:['customer:read']})
  const nativeCustomer=await h.api('/api/stall/v1/customer',undefined,{as:customer,headers:{authorization:`Bearer ${app.token}`}})
  const customerDry=await flow('workflow.dry-run',{id:customerRule.id})
  assert.ok(customerDry.matches.some(m=>m.sourceId===nativeCustomer.id))
  const promotion=await create('promotion')
  assert.equal((await flow('workflow.dry-run',{id:promotion.id})).source.available,false)
  assert.equal((await flow('workflow.activate',{id:promotion.id,revision:promotion.revision},{status:409})).error.code,'SOURCE_UNAVAILABLE')
  await h.command('shop.configure',{timeZone:'America/New_York'})
  assert.equal((await flow('workflow.schedule.preview',{date:'2026-11-01',localTime:'01:30'})).instant,'2026-11-01T05:30:00.000Z')
  assert.equal((await flow('workflow.schedule.preview',{date:'2026-03-08',localTime:'02:30'})).instant,'2026-03-08T07:00:00.000Z')
  await h.command('shop.configure',{timeZone:'UTC'})
  const scheduledRule=await create('scheduled_reconciliation',{localTime:'00:00',action:'reconcile_followup',assigneeId:owner.id})
  for(const r of [low,overdue,order,returns,cancellations,customerRule,scheduledRule]) await activate(r)
  const request={orderId:bought.orderId,kind:'return'}
  await h.api('/api/stall/customer-requests',request,{as:'',status:401})
  await h.api('/api/stall/customer-requests',request,{as:otherCustomer,status:404})
  await h.api('/api/stall/customer-requests',{...request,email:'synthetic-stall-113@example.test'},{as:otherCustomer,status:400})
  await h.api('/api/stall/customer-requests',{...request,actor:owner.id},{as:customer,status:400})
  await h.api('/api/stall/customer-requests',request,{as:'',headers:{authorization:`Bearer ${app.token}`},status:401})
  await h.api('/api/stall/customer-requests',request,{as:customer,headers:{origin:'https://synthetic-stall-117.test'},status:403})
  const first=await h.api('/api/stall/customer-requests',request,{as:customer})
  assert.equal((await h.api('/api/stall/customer-requests',request,{as:customer})).request.id,first.request.id)
  await h.api('/api/stall/customer-requests',{...request,kind:'cancellation'},{as:customer})
  await scheduled()
  let snap=await snapshot()
  for(const r of [low,overdue,order,returns,cancellations,customerRule,scheduledRule]) {
   const tasks=snap.tasks.filter(t=>t.ruleId===r.id)
   assert.equal(tasks.length,1,r.value.trigger)
   const task=tasks[0]
   assert.equal(task.assigneeId,r.value.assigneeId);assert.equal(task.status,'open')
   assert.equal(Date.parse(task.dueAt)-Date.parse(task.createdAt),90*60000)
   assert.equal(snap.notifications.filter(n=>n.taskId===task.id).length,1)
  }
  const frozen=snap.tasks.map(t=>({id:t.id,dueAt:t.dueAt,eventKey:t.eventKey})).sort((a,b)=>a.id.localeCompare(b.id))
  await Promise.all([flow('workflow.run'),flow('workflow.run')]);await scheduled()
  snap=await snapshot()
  assert.deepEqual(snap.tasks.map(t=>({id:t.id,dueAt:t.dueAt,eventKey:t.eventKey})).sort((a,b)=>a.id.localeCompare(b.id)),frozen)
  const mine=await h.api('/api/stall/workflows',undefined,{as:member})
  assert.ok(mine.tasks.length>0&&mine.tasks.every(t=>t.assigneeId===packer.id));assert.equal(mine.rules.length,0)
  assert.ok(mine.notifications.every(n=>n.recipientId===packer.id))
  const completed=mine.tasks[0]
  await flow('workflow.task.complete',{id:completed.id},{as:member})
  assert.equal((await snapshot()).tasks.find(t=>t.id===completed.id).status,'completed')
  await flow('workflow.notification.read',{id:mine.notifications[0].id},{as:member})
  assert.ok((await snapshot()).notifications.find(n=>n.id===mine.notifications[0].id).readAt)
  const minuteAt=offset=>{const d=new Date(Date.now()+offset*60000);return d.toISOString().slice(11,16)}
  const quiet=await create('low_stock',{assigneeId:administrator.id,conditions:{sku:item.sku,stockAtMost:19},quietHours:{start:minuteAt(-1),end:minuteAt(5)}})
  await activate(quiet);await flow('workflow.run')
  const pending=(await snapshot()).tasks.find(t=>t.ruleId===quiet.id)
  assert.equal(pending.status,'pending');assert.ok(Date.parse(pending.dispatchAt)>Date.now())
  await flow('workflow.pause',{id:quiet.id,revision:quiet.revision})
  await scheduled()
  snap=await snapshot()
  assert.equal(snap.tasks.find(t=>t.id===pending.id).status,'paused')
  assert.ok(!snap.notifications.some(n=>n.taskId===pending.id))
  await activate(quiet);await flow('workflow.task.retry',{id:pending.id})
  await flow('workflow.activate',{id:noMatch.id,revision:noMatch.revision},{as:admin})
  await h.api('/auth/operator/status',{operatorId:administrator.id,status:'inactive'})
  await scheduled()
  snap=await snapshot()
  assert.equal(snap.tasks.find(t=>t.id===pending.id).status,'failed')
  assert.equal(snap.tasks.find(t=>t.id===pending.id).errorCode,'ASSIGNEE')
  assert.ok(!snap.notifications.some(n=>n.taskId===pending.id))
  assert.equal(snap.rules.find(r=>r.id===noMatch.id).localAuthority,false)
  assert.equal(snap.rules.find(r=>r.id===noMatch.id).errorCode,'LOCAL_AUTHORITY_REQUIRED')
  unavailable=true;await flow('workflow.run');unavailable=false
  snap=await snapshot()
  assert.ok(snap.rules.find(r=>r.id===low.id).errorCode)
  assert.ok(snap.rules.find(r=>r.id===low.id).checkedAt)
  await flow('workflow.run')
  assert.equal((await snapshot()).rules.find(r=>r.id===low.id).errorCode,null)
  const after=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId)
  assert.deepEqual(after.payment,before.payment);assert.deepEqual(after.reservation,before.reservation)
  assert.equal(after.status,before.status);assert.equal(after.refunds.length,0)
  assert.equal((await pier.api('/api/pier/state')).shipments.length,0)
  assert.equal(edge.refunds.size,0)
  const serialized=JSON.stringify(await snapshot())
  for(const secret of [bindings.STRIPE_SECRET_KEY,bindings.STRIPE_WEBHOOK_SECRET,bindings.PIER_SESSION,grant.token,app.token,'synthetic-stall-113@example.test','1 Maker Lane']) assert.ok(!serialized.includes(secret))
 } finally {await h.close();await pier.close()}
})
