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
 let unavailable=false,duringStockRead
 const intents=new Map()
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-101',STRIPE_WEBHOOK_SECRET:'synthetic-stall-102'}
 const h=await installation({bindings,outboundService:async r=>{
  const url=new URL(r.url)
  if(url.origin===pier.origin) {
   if(unavailable)return Response.json({error:'synthetic-stall-103'},{status:503})
   if(url.pathname==='/api/pier/state'&&duringStockRead){const change=duringStockRead;duringStockRead=null;await change()}
  }
  if(url.hostname==='api.stripe.com'&&url.pathname.startsWith('/v1/payment_intents/')) return Response.json(intents.get(decodeURIComponent(url.pathname.split('/').at(-1)))??{error:'missing'},{status:intents.has(decodeURIComponent(url.pathname.split('/').at(-1)))?200:404})
  return edge.handle(r)
 }})
 const flow=async(type,payload={},opts={})=>{
  const value=await h.api('/api/stall/workflows',{type,payload},opts)
  return opts.status&&opts.status>=400?value:value.result
 }
 const snapshot=()=>h.api('/api/stall/workflows')
 const scheduled=async()=>{assert.equal((await(await h.mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'* * * * *'})).outcome,'ok')}
 try {
  const owner=(await h.api('/auth/session')).operator
  let member=await h.signIn('synthetic-stall-104@example.test')
  const admin=await h.signIn('synthetic-stall-105@example.test','admin')
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
  assert.equal((await flow('workflow.dry-run',{id:promotion.id})).source.available,true)
  const nativePromotion=await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-118',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),minimumBasketCents:0,maxUsesPerCustomer:1,maxTotalUses:2,maxShippingDiscountCents:1000})
  assert.equal((await flow('workflow.dry-run',{id:promotion.id})).matches[0].sourceId,nativePromotion.id)
  await h.command('shop.configure',{timeZone:'America/New_York'})
  assert.equal((await flow('workflow.schedule.preview',{date:'2026-11-01',localTime:'01:30'})).instant,'2026-11-01T05:30:00.000Z')
  assert.equal((await flow('workflow.schedule.preview',{date:'2026-03-08',localTime:'02:30'})).instant,'2026-03-08T07:00:00.000Z')
  await h.command('shop.configure',{timeZone:'UTC'})
  const scheduledRule=await create('scheduled_reconciliation',{localTime:'00:00',action:'reconcile_followup',assigneeId:owner.id})
  for(const r of [low,overdue,order,returns,cancellations,customerRule,scheduledRule,promotion]) await activate(r)
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
  for(const r of [low,overdue,order,returns,cancellations,customerRule,scheduledRule,promotion]) {
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
  const completed=mine.tasks.find(t=>t.action==='task')
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
  // A human prepares the real shipment draft from the assigned task. Native
  // functional rights, current task/rule authority, and exact revision bind it.
  const draftTask=(await snapshot()).tasks.find(t=>t.ruleId===overdue.id)
  const prepare={id:draftTask.id,revision:after.revision,reference:'synthetic-stall-119'}
  await flow('workflow.task.prepare-shipment',prepare,{as:'',status:401})
  await flow('workflow.task.prepare-shipment',prepare,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  await flow('workflow.task.prepare-shipment',prepare,{as:otherCustomer,status:403})
  await h.command('staff.configure',{actorId:packer.id,staffRole:'customer_support'})
  await flow('workflow.task.prepare-shipment',prepare,{as:member,status:403})
  await h.command('staff.configure',{actorId:packer.id,staffRole:'fulfillment'})
  await flow('workflow.task.prepare-shipment',{...prepare,revision:'synthetic-stall-120'},{as:member,status:409})
  assert.equal((await snapshot()).tasks.find(t=>t.id===draftTask.id).errorCode,'CHANGED')
  await flow('workflow.pause',{id:overdue.id,revision:overdue.revision})
  assert.equal((await flow('workflow.task.prepare-shipment',prepare,{as:member,status:409})).error.code,'RULE_INACTIVE')
  await activate(overdue)
  await h.api('/auth/operator/status',{operatorId:packer.id,status:'inactive'})
  assert.equal((await flow('workflow.task.prepare-shipment',prepare,{status:400})).error.code,'ASSIGNEE')
  await h.api('/auth/operator/status',{operatorId:packer.id,status:'active'})
  await h.api('/auth/magic-link',{email:packer.email,returnTo:'/app'},{as:'',status:202})
  const message=h.messages.findLast(message=>JSON.stringify(message.to).includes(packer.email)),link=new URL(message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0])
  const signedAgain=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:link.searchParams.get('token')}})
  assert.equal(signedAgain.status,303)
  member=signedAgain.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  const charge={id:'synthetic-stall-121',object:'charge',payment_intent:paid.payment_intent,outcome:{risk_level:'elevated',risk_score:82},payment_method_details:{card:{checks:{cvc_check:'pass',address_line1_check:'pass',address_postal_code_check:'pass'}}}}
  intents.set(paid.payment_intent,{id:paid.payment_intent,object:'payment_intent',metadata:{stall_order_id:after.id},amount:after.totalCents,currency:'usd',status:'succeeded',latest_charge:charge})
  await h.command('risk.configure',{enabled:true,holdElevated:true,holdHighest:true,holdAddressMismatch:true,holdPaymentMismatch:true,scoreThreshold:70})
  await h.command('risk.refresh',{orderId:after.id})
  assert.equal((await flow('workflow.task.prepare-shipment',prepare,{as:member,status:409})).error.code,'RISK_HELD')
  assert.equal((await snapshot()).tasks.find(t=>t.id===draftTask.id).shipmentPreparation.available,false)
  const held=(await h.api('/api/stall/risk')).queue.find(r=>r.orderId===after.id)
  await h.command('risk.release',{orderId:after.id,revision:held.revision})
  duringStockRead=()=>flow('workflow.pause',{id:overdue.id,revision:overdue.revision})
  await flow('workflow.task.prepare-shipment',prepare,{as:member,status:409})
  assert.ok(!(await h.api('/api/stall/state')).orders.find(o=>o.id===after.id).shipment)
  assert.equal((await snapshot()).tasks.find(t=>t.id===draftTask.id).shipmentDraft,null)
  await activate(overdue)
  duringStockRead=()=>h.command('staff.configure',{actorId:packer.id,staffRole:'customer_support'})
  await flow('workflow.task.prepare-shipment',prepare,{as:member,status:409})
  assert.ok(!(await h.api('/api/stall/state')).orders.find(o=>o.id===after.id).shipment)
  await h.command('staff.configure',{actorId:packer.id,staffRole:'fulfillment'})
  const draftReplies=await Promise.all([flow('workflow.task.prepare-shipment',prepare,{as:member}),flow('workflow.task.prepare-shipment',prepare,{as:member})])
  assert.equal(draftReplies[0].shipmentId,draftReplies[1].shipmentId)
  assert.equal((await flow('workflow.task.prepare-shipment',prepare,{as:member})).shipmentId,draftReplies[0].shipmentId)
  assert.equal((await flow('workflow.task.prepare-shipment',{...prepare,reference:'synthetic-stall-122'},{as:member,status:409})).error.code,'IDEMPOTENCY')
  const prepared=(await h.api('/api/stall/state')).orders.find(o=>o.id===after.id)
  assert.equal(prepared.shipment.status,'draft');assert.ok(!prepared.shipment.approval)
  const beforeLoop=(await snapshot()).tasks.filter(t=>t.ruleId===order.id).length
  await flow('workflow.run');await flow('workflow.run')
  assert.equal((await snapshot()).tasks.filter(t=>t.ruleId===order.id).length,beforeLoop,'workflow output revisions never feed another order event')
  assert.equal((await snapshot()).tasks.filter(t=>t.shipmentDraft).length,1)
  await flow('workflow.task.complete',{id:draftTask.id},{as:member})
  assert.equal((await h.api('/api/stall/state')).orders.find(o=>o.id===after.id).shipment.status,'draft')
  assert.equal((await pier.api('/api/pier/state')).shipments.length,0)
  assert.equal(edge.refunds.size,0)
  // A separately approved dispatch enables a real received-goods confirmation.
  const receiptRule=await flow('workflow.save',{rule:{name:'synthetic-stall-124',trigger:'return_confirmed',assigneeId:packer.id,dueMinutes:90,conditions:{}}})
  await activate(receiptRule)
  const returnInput={requestId:first.request.id,orderRevision:prepared.revision,lines:[{sku:item.sku,quantity:1}]}
  await h.api('/api/stall/returns',returnInput,{as:member,status:403})
  await h.api('/api/stall/returns',returnInput,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  await h.api('/api/stall/returns',returnInput,{status:409})
  const shipped=await h.command('shipment.approve',{orderId:prepared.id,revision:prepared.revision})
  await h.api('/api/stall/returns',{...returnInput,orderRevision:'synthetic-stall-123'},{status:409})
  await h.api('/api/stall/returns',{...returnInput,orderRevision:shipped.revision,lines:[{sku:item.sku,quantity:2}]},{status:400})
  const stockBeforeReturn=await pier.api('/api/pier/state'),returnReceived={...returnInput,orderRevision:shipped.revision}
  const received=await h.api('/api/stall/returns',returnReceived)
  assert.equal((await h.api('/api/stall/returns',returnReceived)).id,received.id)
  await flow('workflow.run');await flow('workflow.run')
  snap=await snapshot()
  const stockTasks=snap.tasks.filter(t=>t.ruleId===receiptRule.id)
  assert.equal(stockTasks.length,1);assert.equal(stockTasks[0].sourceKind,'return_receipt');assert.equal(stockTasks[0].sourceId,received.id)
  assert.equal(stockTasks[0].assigneeId,packer.id);assert.equal(stockTasks[0].status,'open')
  assert.deepEqual((await pier.api('/api/pier/state')).positions,stockBeforeReturn.positions)
  assert.equal(edge.refunds.size,0)
  // A canceled fulfillment remains blocked through the workflow door too.
  const canceledBuy=await purchase(h,edge,{skus:[item.sku],email:'synthetic-stall-125@example.test'}),canceledPaid=edge.pay(canceledBuy.session.id)
  intents.set(canceledPaid.payment_intent,{id:canceledPaid.payment_intent,object:'payment_intent',metadata:{stall_order_id:canceledBuy.orderId},amount:canceledPaid.amount_total,currency:'usd',status:'succeeded',latest_charge:{...charge,id:'synthetic-stall-126',payment_intent:canceledPaid.payment_intent}})
  assert.equal((await deliverWebhook(h,bindings.STRIPE_WEBHOOK_SECRET,canceledPaid)).response.status,200)
  const cancelRule=await flow('workflow.save',{rule:{name:'synthetic-stall-127',trigger:'order',assigneeId:packer.id,conditions:{sku:item.sku,status:'reserved'},action:'draft_followup'}})
  await activate(cancelRule);await flow('workflow.run')
  const canceledOrder=(await h.api('/api/stall/state')).orders.find(o=>o.id===canceledBuy.orderId),cancelTask=(await snapshot()).tasks.find(t=>t.ruleId===cancelRule.id&&t.sourceId===canceledBuy.orderId)
  const canceledRisk=(await h.api('/api/stall/risk')).queue.find(r=>r.orderId===canceledBuy.orderId)
  await h.command('risk.cancel',{orderId:canceledBuy.orderId,revision:canceledRisk.revision})
  assert.equal((await flow('workflow.task.prepare-shipment',{id:cancelTask.id,revision:canceledOrder.revision,reference:'synthetic-stall-128'},{as:member,status:409})).error.code,'RISK_CANCELED')
  assert.equal((await snapshot()).tasks.find(t=>t.id===cancelTask.id).errorCode,'RISK_CANCELED')
  assert.ok(!(await h.api('/api/stall/state')).orders.find(o=>o.id===canceledBuy.orderId).shipment)
  const serialized=JSON.stringify(await snapshot())
  for(const secret of [bindings.STRIPE_SECRET_KEY,bindings.STRIPE_WEBHOOK_SECRET,bindings.PIER_SESSION,grant.token,app.token,'synthetic-stall-113@example.test','1 Maker Lane']) assert.ok(!serialized.includes(secret))
 } finally {await h.close();await pier.close()}
})

test('TAX-001: address-level Stripe previews preserve categories and discounted shipping without inventing rates',async()=>{
 const {taxEdge}=await import('./tax-edge.mjs'),{randomUUID}=await import('node:crypto'),edge=taxEdge()
 const h=await installation({bindings:{STRIPE_SECRET_KEY:'synthetic-stall-806'},outboundService:edge.handle});let restored
 try {
  const boundary=await h.api('/api/stall/tax/boundary'),destination={line1:'1 synthetic-stall-street',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
  const base={consent:boundary.consent,destination,shipFrom:{...destination,line1:'synthetic-stall-warehouse'},lines:[{reference:'synthetic-stall-taxable',unitCents:1000,quantity:2,taxCode:'txcd_99999999'},{reference:'synthetic-stall-exempt',unitCents:500,quantity:1,taxCode:'txcd_00000000'}],shippingCents:200}
  assert.deepEqual((await h.api('/api/stall/tax/readiness')).states,['CA','TX'])
  const quote=async overrides=>h.api('/api/stall/tax/preview',{...base,id:randomUUID(),...overrides})
  const firstInput={...base,id:randomUUID()},first=await h.api('/api/stall/tax/preview',firstInput)
  assert.equal(first.taxCents,138);assert.equal(first.totalCents,2838);assert.equal(first.previewOnly,true)
  assert.equal(first.breakdown[0].taxableCents,2200);assert.equal(first.breakdown[0].ratePercent,'6.25')
  assert.ok(first.breakdown.every(j=>j.taxableCents>0),'the provider label for a nontaxable-coded line never becomes a zero-rate jurisdiction row')
  assert.equal((await quote({destination:{...destination,line1:'2 synthetic-stall-street'}})).taxCents,165)
  assert.equal((await quote({destination:{...destination,state:'CA',city:'Los Angeles',postal_code:'90001'}})).taxCents,182)
  assert.equal((await quote({shippingCents:0})).taxCents,125,'only the discounted shipping amount is taxed')
  const writes=()=>edge.calls.filter(c=>c.method==='POST').length,before=writes()
  assert.deepEqual(await h.api('/api/stall/tax/preview',firstInput),first);assert.equal(writes(),before)
  const changed=await h.api('/api/stall/tax/preview',{...firstInput,shippingCents:201},{status:409});assert.equal(changed.error.code,'IDEMPOTENCY');assert.equal(writes(),before)
  const history=await h.api('/api/stall/tax/previews');assert.equal(history.total,4)
  assert.ok(history.previews.every(p=>p.status==='observed'&&p.attempts===1&&p.provider_id&&p.observed_at))
  assert.ok(!JSON.stringify(history).includes(destination.line1));assert.ok(!JSON.stringify(history).includes('intent_hash'))
  const storage=await h.db.prepare('SELECT * FROM st_tax_previews').all()
  assert.ok(!JSON.stringify(storage).includes(destination.line1));assert.ok(!JSON.stringify(storage).includes('synthetic-stall-806'))
  const exported=JSON.stringify(await archive(h)),audit=JSON.stringify((await h.db.prepare('SELECT * FROM st_audit').all()).results)
  for(const street of [destination.line1,base.shipFrom.line1])for(const data of [JSON.stringify(history),JSON.stringify(storage),exported,audit])assert.ok(!data.includes(street),'preview history, storage, audit and portable records retain no street addresses')
  const beforeRestore=edge.calls.length
  restored=await installation({outboundService:edge.handle});await restore(restored,JSON.parse(exported))
  const restoredHistory=await restored.api('/api/stall/tax/previews')
  assert.ok(restoredHistory.previews.every(p=>p.restored===1&&p.result.historicalObservation===true&&p.result.currentCheckoutTax===false))
  assert.equal(edge.calls.length,beforeRestore,'restoring and reading historical observations sends no provider request and needs no credentials')
 }finally {await restored?.close();await h.close()}
})

test('TAX-001: uncertain Stripe calculations recover only original intent after restart and archive restore',async()=>{
 const {taxEdge}=await import('./tax-edge.mjs'),{randomUUID}=await import('node:crypto'),edge=taxEdge()
 const h=await installation({bindings:{STRIPE_SECRET_KEY:'synthetic-stall-806'},outboundService:edge.handle});let destination
 try {
  const boundary=await h.api('/api/stall/tax/boundary'),address={line1:'synthetic-stall-address',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
  const input={id:randomUUID(),consent:boundary.consent,destination:address,shipFrom:address,lines:[{reference:'synthetic-stall-item',unitCents:1000,quantity:1,taxCode:'txcd_99999999'}],shippingCents:0}
  edge.fault='lost';assert.equal((await h.api('/api/stall/tax/preview',input,{status:503})).error.code,'TAX_UNAVAILABLE')
  assert.equal(edge.calculations.size,1)
  assert.equal((await h.api('/api/stall/tax/preview',input,{status:409})).error.code,'TAX_RECOVERY')
  const receipt=[...edge.calculations.keys()][0],history=await h.api('/api/stall/tax/previews')
  assert.equal(history.previews[0].status,'uncertain');assert.equal(history.previews[0].attempts,1)
  assert.equal((await h.api('/api/stall/tax/preview',{...input,id:randomUUID()},{status:409})).error.code,'TAX_RECOVERY')
  assert.equal((await h.api('/api/stall/tax/preview',{...input,id:randomUUID(),calculationId:receipt},{status:409})).error.code,'TAX_RECOVERY')
  const saved=await archive(h)
  destination=await installation({bindings:{STRIPE_SECRET_KEY:'synthetic-stall-806'},outboundService:edge.handle})
  await restore(destination,saved)
  assert.equal((await destination.api('/api/stall/tax/preview',{...input,id:randomUUID()},{status:409})).error.code,'TAX_RECOVERY')
  assert.equal((await destination.api('/api/stall/tax/preview',input,{status:409})).error.code,'TAX_RECOVERY')
  assert.equal((await destination.api('/api/stall/tax/preview',{...input,calculationId:receipt,destination:{...address,line1:'synthetic-stall-wrong-address'}},{status:409})).error.code,'TAX_MISMATCH')
  const recovered=await destination.api('/api/stall/tax/preview',{...input,calculationId:receipt})
  assert.equal(recovered.calculationId,receipt);assert.equal(recovered.taxCents,63)
  assert.equal(recovered.historicalObservation,true);assert.equal(recovered.currentCheckoutTax,false);assert.equal(recovered.previewOnly,true)
  const again=await destination.api('/api/stall/tax/preview',{...input,calculationId:receipt})
  assert.equal(again.historicalObservation,true);assert.equal(again.currentCheckoutTax,false)
  await destination.api('/api/stall/tax/preview',{...input,consent:undefined,calculationId:receipt},{status:400})
  const observation=(await destination.api('/api/stall/tax/previews')).previews[0]
  assert.equal(observation.restored,1);assert.equal(observation.result.currentCheckoutTax,false)
  assert.equal(edge.calls.filter(c=>c.method==='POST').length,1,'restore and retries never replace the uncertain provider effect')
  assert.equal((await h.api('/api/stall/tax/preview',{...input,calculationId:receipt})).calculationId,receipt)
  assert.equal(edge.calls.filter(c=>c.method==='POST').length,1)
  const racedInput={...input,id:randomUUID()},before=edge.calls.filter(c=>c.method==='POST').length
  const raced=await Promise.all([h.request('/api/stall/tax/preview',{method:'POST',body:racedInput}),h.request('/api/stall/tax/preview',{method:'POST',body:racedInput})])
  assert.ok(raced.every(response=>[200,409].includes(response.status)))
  assert.equal(edge.calls.filter(c=>c.method==='POST').length,before+1,'concurrent native requests claim one provider attempt')
  assert.equal((await h.api('/api/stall/tax/preview',racedInput)).previewOnly,true)
 }finally {await destination?.close();await h.close()}
})

test('TAX-001: preview authority, consent, incomplete configuration and provider failures refuse unpriced tax',async()=>{
 const {taxEdge}=await import('./tax-edge.mjs'),{randomUUID}=await import('node:crypto'),edge=taxEdge()
 const h=await installation({bindings:{STRIPE_SECRET_KEY:'synthetic-stall-806'},outboundService:edge.handle})
 try {
  const boundary=await h.api('/api/stall/tax/boundary'),address={line1:'synthetic-stall-address',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
  const input={consent:boundary.consent,destination:address,shipFrom:address,lines:[{reference:'synthetic-stall-item',unitCents:1000,quantity:1,taxCode:'txcd_99999999'}],shippingCents:0},preview=(overrides={},opts={})=>h.api('/api/stall/tax/preview',{...input,id:randomUUID(),...overrides},opts)
  const authorizedReads=edge.calls.length
  const member=await h.signIn('synthetic-stall-member@example.test'),admin=await h.signIn('synthetic-stall-admin@example.test','admin'),agent=await h.api('/api/stall/agent-token',{})
  for(const opts of [{as:'',status:401},{as:member,status:403},{as:admin,status:403},{headers:{authorization:'Bearer '+agent.token},status:403}]) {
   await preview({},opts);await h.api('/api/stall/tax/previews',undefined,opts);await h.api('/api/stall/tax/readiness',undefined,opts)
  }
  await preview({},{headers:{origin:'https://synthetic-stall-outside.test'},status:403})
  assert.equal(edge.calls.length,authorizedReads,'denied callers send no data to Stripe')
  assert.equal((await preview({consent:undefined},{status:400})).error.code,'TAX_CONSENT')
  assert.equal((await preview({destination:{...address,line1:''}},{status:400})).error.code,'INPUT')
  edge.ready=false;assert.equal((await preview({},{status:503})).error.code,'TAX_CONFIGURATION');edge.ready=true
  edge.registered=false;assert.equal((await preview({},{status:503})).error.code,'TAX_CONFIGURATION');edge.registered=true
  assert.equal((await preview({destination:{...address,state:'NY'}},{status:503})).error.code,'TAX_CONFIGURATION')
  edge.fault='offline';assert.equal((await preview({},{status:503})).error.code,'TAX_UNAVAILABLE');edge.fault=null
  edge.fault='credential';assert.equal((await preview({},{status:503})).error.code,'TAX_CREDENTIAL');edge.fault=null
  assert.equal((await h.api('/api/stall/tax/previews')).total,0,'configuration refusals never prepare a provider write')
  edge.malformed=true;assert.equal((await preview({},{status:502})).error.code,'TAX_RESPONSE');edge.malformed=false
  const history=await h.api('/api/stall/tax/previews');assert.equal(history.previews[0].status,'uncertain');assert.equal(history.previews[0].result,null)
  assert.ok(history.previews[0].provider_id,'a readable original reference survives a malformed total')
 }finally {await h.close()}
})

test('tax settings save exact local ship-from, SKU categories and nexus thresholds behind current owner authority',async()=>{
 const h=await installation({outboundService:()=>{assert.fail('Local tax configuration must not call a provider')}})
 try {
  const path='/api/stall/tax/configuration',initial=await h.api(path)
  const value={shipFrom:{line1:'1200 Cedar Avenue',line2:'Unit 4',city:'Austin',state:'TX',postal_code:'78702',country:'US'},categories:[{sku:'LINEN-TEE',taxCode:'txcd_99999999'},{sku:'GIFT-PAPER',taxCode:'txcd_00000000'}],thresholds:[{state:'TX',salesCents:10000000,transactions:200,warningPercent:80}]}
  const admin=await h.signIn('synthetic-stall-tax-admin@example.test','admin'),member=await h.signIn('synthetic-stall-tax-member@example.test'),agent=await h.api('/api/stall/agent-token',{})
  for(const opts of [{as:'',status:401},{as:admin,status:403},{as:member,status:403},{as:'',headers:{authorization:'Bearer '+agent.token},status:403}]) {
   await h.api(path,undefined,opts);await h.api(path,{revision:initial.revision,value},opts)
  }
  await h.api(path,{revision:initial.revision,value},{headers:{origin:'https://synthetic-stall-outside.test'},status:403})
  const saved=await h.api(path,{revision:initial.revision,value})
  assert.deepEqual({...saved,revision:undefined},{...value,revision:undefined})
  await h.api(path,{revision:initial.revision,value:{...value,categories:[]}},{status:409})
  await h.api(path,{revision:saved.revision,value:{...value,categories:[{sku:'LINEN-TEE',taxCode:'unclassified'}]}},{status:400})
  assert.deepEqual(await h.api(path),saved)
  assert.ok((await h.api('/api/stall/state')).audit.some(event=>event.action==='tax.configuration-saved'))
  let restored
  try {restored=await installation();await restore(restored,await archive(h));assert.deepEqual(await restored.api(path),saved)}finally{await restored?.close()}
 }finally{await h.close()}
})

test('customer tax exemption evidence keeps exact owner review, optimistic revisions and inert portable custody',async()=>{
 const h=await installation();let restored
 try {
  const path='/api/stall/tax/exemptions',input={customerEmail:'SYNTHETIC-STALL-TAX@example.test',state:'tx',evidenceReference:'Customer exemption certificate 2026-17',expiresOn:'2035-12-31'}
  const admin=await h.signIn('synthetic-stall-tax-reviewer@example.test','admin')
  await h.api(path,input,{as:admin,status:403});await h.api(path,undefined,{as:'',status:401})
  const saved=await h.api(path,input)
  assert.equal(saved.customerEmail,input.customerEmail.toLowerCase());assert.equal(saved.state,'TX');assert.equal(saved.restored,false);assert.ok(saved.reviewedBy&&saved.reviewedAt)
  const revoked=await h.api(path,{...input,id:saved.id,revision:saved.revision,revoked:true})
  await h.api(path,{...input,id:saved.id,revision:saved.revision,revoked:false},{status:409})
  assert.equal((await h.api(path)).exemptions[0].revoked,true)
  await h.api(path,{...input,expiresOn:'2035-02-31'},{status:400})
  const lines=await archive(h)
  restored=await installation();await restore(restored,lines)
  const portable=(await restored.api(path)).exemptions[0]
  assert.equal(portable.id,revoked.id);assert.equal(portable.evidenceReference,input.evidenceReference);assert.equal(portable.restored,true);assert.equal(portable.revoked,true)
  await h.command('customer.erase',{email:input.customerEmail,confirm:'ERASE'})
  assert.equal((await h.api(path)).total,0)
 }finally{await restored?.close();await h.close()}
})

test('taxed checkout binds address-level tax to exact payment and original paid-order references',async()=>{
 const {taxCommerceInstallation,taxAddress}=await import('./tax-commerce.mjs'),{randomUUID}=await import('node:crypto'),kit=await taxCommerceInstallation(),{h,tax,stripe}=kit
 try {
  const quoted=await kit.quote(),otherStreet=await kit.quote({destination:{...taxAddress,line1:'2 synthetic-stall-street'}}),california=await kit.quote({destination:{...taxAddress,line1:'400 Spring Street',state:'CA',city:'Los Angeles',postal_code:'90013'}})
  assert.ok(quoted.result.taxCents>0);assert.notEqual(quoted.result.taxCents,otherStreet.result.taxCents)
  assert.ok(california.result.taxCents>0)
  assert.deepEqual(new Set(quoted.result.jurisdictions.map(j=>j.level)),new Set(['state','county','city','district']))
  assert.equal(quoted.result.jurisdictions.reduce((sum,j)=>sum+j.amountCents,0),quoted.result.taxCents)
  assert.equal((await h.api('/api/stall/checkout',{idempotencyKey:randomUUID(),customerEmail:quoted.input.customerEmail,lines:quoted.input.lines,shipping:quoted.input.shipping,expectedTotalCents:2700},{as:'',status:409})).error.code,'TAX_QUOTE_REQUIRED')
  const paid=await kit.buy(quoted)
  assert.equal(paid.order.totalCents,quoted.result.totalCents);assert.equal(paid.session.amount_total,quoted.result.totalCents)
  assert.equal(paid.order.tax.calculationId,quoted.result.calculationId);assert.ok(paid.order.tax.transactionId)
  assert.equal(paid.order.tax.lines.find(l=>l.taxCode==='txcd_00000000').taxCents,0)
  assert.ok(!JSON.stringify(paid.order.tax).includes(taxAddress.line1),'tax custody stays minimized; normal shipping records carry delivery addresses')
  const member=await h.signIn(quoted.input.customerEmail),reordered=await h.api('/api/stall/cart/reorder',{orderId:paid.order.id},{as:member})
  await h.api('/api/stall/cart/review',{cartId:reordered.cart.id,revision:reordered.cart.revision},{as:member,status:409})
  const currentTax=await kit.quote({as:member})
  const saved=(await h.api('/api/stall/cart',{cartId:reordered.cart.id,revision:reordered.cart.revision,lines:reordered.cart.value.lines,customerEmail:quoted.input.customerEmail,shopper:reordered.cart.value.shopper,shipping:currentTax.input.shipping,taxQuoteId:currentTax.result.quoteId,taxTotalCents:currentTax.result.totalCents},{as:member})).cart
  assert.deepEqual(saved.value.reorder,reordered.cart.value.reorder,'editing delivery and tax preserves the original reorder explanation')
  const reviewed=await h.api('/api/stall/cart/review',{cartId:saved.id,revision:saved.revision},{as:member})
  assert.equal(reviewed.review.taxCents,currentTax.result.taxCents);assert.equal(reviewed.review.totalCents,currentTax.result.totalCents)
  const native=await h.api('/api/stall/cart/checkout',{cartId:saved.id,revision:saved.revision,reviewToken:reviewed.reviewToken},{as:member})
  assert.notEqual(native.orderId,paid.order.id);assert.equal((await kit.order(native.orderId)).tax.calculationId,currentTax.result.calculationId)

  await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-TAX-SHIP',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:5,maxTotalUses:10,maxShippingDiscountCents:2000})
  const discounted=await kit.quote({promotionCode:'SYNTHETIC-STALL-TAX-SHIP'})
  assert.equal(discounted.result.totalCents,2500+discounted.result.taxCents)
  assert.equal(discounted.result.taxCents,quoted.result.taxCents-paid.order.tax.shippingTaxCents,'tax consumes the existing net shipping amount exactly once')
  const before=tax.transactions.size
  assert.equal((await deliverWebhook(h,kit.secret,paid.session)).response.status,200)
  await h.command('order.reconcile',{orderId:paid.order.id})
  assert.equal(tax.transactions.size,before,'paid callback and reconciliation never duplicate a tax transaction')
  await h.api('/api/stall/checkout',{...paid.payload,idempotencyKey:randomUUID()},{as:'',status:409})
  tax.fault='offline'
  await h.api('/api/stall/tax/quote',{...otherStreet.input,id:randomUUID()},{as:'',status:503})
  const sessions=stripe.sessions.size,unpriced={...california.input,idempotencyKey:randomUUID(),expectedTotalCents:california.result.totalCents,taxQuoteId:california.result.quoteId}
  await h.api('/api/stall/checkout',unpriced,{as:'',status:503})
  assert.equal(stripe.sessions.size,sessions,'provider refusal blocks payment even for an earlier quote')
  tax.fault=null
  await h.api('/api/stall/checkout',unpriced,{as:''})
  assert.equal(stripe.sessions.size,sessions+1,'a demonstrably unsent original checkout can resume after provider recovery')
  await h.api('/api/stall/checkout',{...otherStreet.input,idempotencyKey:randomUUID(),expectedTotalCents:otherStreet.result.totalCents,taxQuoteId:otherStreet.result.quoteId,lines:[{sku:'MUG-BLUE',quantity:1}]},{as:'',status:409})
  assert.equal(stripe.sessions.size,sessions+1,'changed purchase cannot open payment on stale tax')
  const anonymous=await h.api('/api/stall/tax/commerce',undefined,{as:'',status:401});assert.ok(anonymous.error)
 }finally{await kit.close()}
})

test('tax exemptions require current evidence and an independently proven customer identity at quote and payment',async()=>{
 const {taxCommerceInstallation}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h}=kit
 try {
  const customerEmail='synthetic-stall-exempt@example.test',native=await h.signIn(customerEmail),record=await h.api('/api/stall/tax/exemptions',{customerEmail,state:'TX',evidenceReference:'Certificate reviewed by merchant 2026-18',expiresOn:'2035-12-31'})
  const guest=await kit.quote({customerEmail}),verified=await kit.quote({customerEmail,as:native})
  assert.ok(guest.result.taxCents>0);assert.equal(guest.result.exempt,false)
  assert.equal(verified.result.taxCents,0);assert.equal(verified.result.exempt,true)
  const payload={idempotencyKey:crypto.randomUUID(),customerEmail,lines:verified.input.lines,shipping:verified.input.shipping,expectedTotalCents:verified.result.totalCents,taxQuoteId:verified.result.quoteId}
  assert.equal((await h.api('/api/stall/checkout',payload,{as:'',status:403})).error.code,'TAX_IDENTITY')
  const paid=await kit.buy(verified,{as:native})
  assert.equal(paid.order.tax.exemption.id,record.id);assert.equal(paid.order.tax.taxCents,0);assert.ok(paid.order.tax.transactionId)
  const revokedRecord=await h.api('/api/stall/tax/exemptions',{...record,revoked:true})
  const revoked=await kit.quote({customerEmail,as:native});assert.ok(revoked.result.taxCents>0);assert.equal(revoked.result.exempt,false)
  await h.api('/api/stall/tax/exemptions',{...revokedRecord,revoked:false,expiresOn:'2000-01-01'})
  const expired=await kit.quote({customerEmail,as:native});assert.ok(expired.result.taxCents>0);assert.equal(expired.result.exempt,false)
 }finally{await kit.close()}
})

test('TAX-004 / TAX-002 / TAX-003: refunds post in their own shop-zone filing period and liability CSVs and nexus reconcile to original orders',async()=>{
 const {taxCommerceInstallation,taxAddress}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h,tax}=kit
 try {
  await h.command('shop.configure',{timeZone:'America/Chicago'})
  tax.transactionTime=Date.parse('2026-02-01T05:59:00Z')/1000
  const tx=await kit.buy(await kit.quote()),ca=await kit.buy(await kit.quote({destination:{...taxAddress,state:'CA',city:'Los Angeles',postal_code:'90013'}}))
  await kit.ship(tx.order.id)
  tax.transactionTime=Date.parse('2026-02-01T06:01:00Z')/1000
  const refunded=await kit.refund(tx.order.id),refund=refunded.refunds[0]
  assert.equal(refund.status,'succeeded');assert.ok(refund.taxReversalId);assert.equal(refund.amountCents,1000+refund.taxAllocation.taxCents)
  const january=await h.api('/api/stall/tax/liability?from=2026-01-01&to=2026-02-01'),february=await h.api('/api/stall/tax/liability?from=2026-02-01&to=2026-03-01')
  assert.equal(january.transactions.length,2);assert.equal(january.totals.taxCents,tx.order.tax.taxCents+ca.order.tax.taxCents)
  assert.equal(january.totals.grossSalesCents,5000);assert.equal(january.totals.nonTaxableSalesCents,1000)
  assert.deepEqual(new Set(january.jurisdictions.map(j=>j.level)),new Set(['state','county','city','district']))
  assert.equal(february.transactions.length,1);assert.equal(february.transactions[0].originalTransactionId,tx.order.tax.transactionId)
  assert.equal(february.totals.refundGrossCents,-1000);assert.equal(february.totals.taxCents,-refund.taxAllocation.taxCents)
  assert.equal(february.transactions[0].id,refund.taxReversalId)
  assert.equal(february.totals.unallocatedTaxCents,0,'the real reversal names no jurisdiction, so the original provider breakdown is split pro rata and nothing stays unallocated')
  assert.ok(february.jurisdictions.length>=4&&february.jurisdictions.every(j=>j.refundTaxCents<=0&&j.taxCollectedCents===0))
  for(const level of ['state','county','city','district']) {
   const original=january.jurisdictions.filter(j=>j.level===level&&j.state==='TX'),reversed=february.jurisdictions.filter(j=>j.level===level)
   assert.ok(reversed.length&&reversed.every(r=>original.some(j=>j.name===r.name&&j.ratePercent===r.ratePercent)),'reversal jurisdictions are the original sale jurisdictions')
  }
  assert.equal(january.transactions.find(t=>t.orderId===ca.order.id).calculationId,ca.order.tax.calculationId)
  for(const report of [january,february])assert.equal(report.states.reduce((n,row)=>n+row.taxCents,0),report.totals.taxCents)
  for(const level of ['state','jurisdiction','transaction']) {
   const response=await h.request(`/api/stall/tax/liability.csv?from=2026-01-01&to=2026-03-01&level=${level}`)
   assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/csv/)
   const rows=readCsv(await response.text());assert.ok(rows.length>1)
   const exportedTax=rows.reduce((sum,row)=>sum+Number(row.taxCents),0)
   assert.equal(exportedTax,january.totals.taxCents+february.totals.taxCents)
   if(level==='transaction') {
    assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([tx.order.tax.transactionId,ca.order.tax.transactionId,refund.taxReversalId]))
    assert.ok(rows.every(row=>[tx.order.id,ca.order.id].includes(row.orderId)&&row.calculationId))
   }
   if(level==='jurisdiction')for(const row of rows) {
    const match=j=>j.state===row.state&&j.name===row.name&&j.level===row.level&&j.ratePercent===row.ratePercent,source=january.jurisdictions.find(match),reversed=february.jurisdictions.find(match)
    assert.ok(source);assert.equal(Number(row.taxCents),source.taxCents+(reversed?.taxCents??0));assert.equal(Number(row.refundTaxCents),reversed?.refundTaxCents??0)
   }
  }
  const nexus=await h.api('/api/stall/tax/nexus?from=2026-01-01&to=2026-02-01'),texas=nexus.states.find(s=>s.state==='TX')
  assert.equal(texas.netGrossCents,2500);assert.equal(texas.transactionCount,1);assert.equal(texas.status,'warning')
  const next=await kit.buy(await kit.quote());assert.ok(next.order.tax.transactionId)
  const full=await h.api('/api/stall/tax/nexus?from=2026-01-01&to=2026-03-01');assert.equal(full.states.find(s=>s.state==='TX').status,'crossed')
  let shipping=await kit.order(tx.order.id)
  for(const expectedTax of [9,8]) {
   shipping=await h.command('refund.prepare',{orderId:shipping.id,revision:shipping.revision,kind:'shipping',amountCents:100,reason:'Half of shipping paid'})
   assert.equal(shipping.refunds.at(-1).taxAllocation.taxCents,expectedTax)
   shipping=await h.command('refund.approve',{orderId:shipping.id,revision:shipping.revision})
   assert.ok(shipping.refunds.at(-1).taxReversalId)
  }
  assert.equal(shipping.refunds.filter(r=>r.kind==='shipping').reduce((sum,r)=>sum+r.amountCents,0),217,'partial shipping returns every original tax cent exactly once')
  const shippingRows=shipping.refunds.filter(r=>r.kind==='shipping')
  assert.deepEqual(shippingRows.map(r=>r.taxAllocation.shippingJurisdictions.reduce((n,j)=>n+j.amountCents,0)),[9,8])
  for(const entry of tx.order.tax.shippingJurisdictions)assert.equal(shippingRows.reduce((n,r)=>n+(r.taxAllocation.shippingJurisdictions.find(j=>j.name===entry.name&&j.level===entry.level)?.amountCents??0),0),entry.amountCents,'the last partial shipping return clears every jurisdiction exactly')
  await h.api('/api/stall/tax/liability?from=2026-02-01&to=2026-01-01',undefined,{status:400})
  await h.api('/api/stall/tax/liability?from=2026-01-01&to=2026-03-01',undefined,{as:'',status:401})
 }finally{await kit.close()}
})

test('TAX-004: taxed goodwill needs explicit confirmation, leaves recorded tax unchanged and posts a zero-tax adjustment',async()=>{
 const {taxCommerceInstallation}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h,tax}=kit
 try {
  const sale=await kit.buy(await kit.quote());await kit.ship(sale.order.id)
  const prepare=(extra,opts)=>kit.order(sale.order.id).then(order=>h.command('refund.prepare',{orderId:order.id,revision:order.revision,kind:'goodwill',amountCents:300,reason:'Late parcel apology',...extra},opts))
  assert.equal((await prepare({},{status:400})).error.code,'TAX_GOODWILL')
  const reversals=tax.transactions.size,prepared=await prepare({taxUnchanged:true}),draft=prepared.refunds.at(-1)
  assert.equal(draft.amountCents,300);assert.equal(draft.taxTreatment,'goodwill_tax_unchanged');assert.equal(draft.taxAllocation,undefined)
  const done=await h.command('refund.approve',{orderId:sale.order.id,revision:prepared.revision}),goodwill=done.refunds.at(-1)
  assert.equal(goodwill.status,'succeeded');assert.equal(goodwill.taxReversalId,undefined);assert.equal(tax.transactions.size,reversals,'goodwill sends no tax reversal')
  const report=await h.api('/api/stall/tax/liability?from=2000-01-01&to=2100-01-01'),posting=report.transactions.find(t=>t.kind==='adjustment')
  assert.equal(posting.amountCents,-300);assert.equal(posting.taxCents,0);assert.equal(posting.originalTransactionId,sale.order.tax.transactionId)
  assert.equal(report.totals.taxCents,sale.order.tax.taxCents,'recorded sales tax is untouched');assert.equal(report.totals.amountCents,sale.order.totalCents-300)
  await kit.refund(sale.order.id);assert.equal((await h.api('/api/stall/tax/liability?from=2000-01-01&to=2100-01-01')).transactions.filter(t=>t.kind==='adjustment').length,1)
 }finally{await kit.close()}
})

test('TAX-004: a payment to a different address than the reviewed tax address is refunded in full with no tax recorded and never fulfilled',async()=>{
 const {taxCommerceInstallation,taxAddress}=await import('./tax-commerce.mjs'),{deliverWebhook}=await import('./network.mjs'),kit=await taxCommerceInstallation(),{h,stripe,tax}=kit
 try {
  const reviewed=await kit.buy(await kit.quote())
  const matching=await kit.order(reviewed.order.id);assert.equal((await h.command('refund.prepare',{orderId:matching.id,revision:matching.revision,kind:'address_change',reason:'No remedy applies'},{status:409})).error.code,'REFUND_KIND')
  const quoted=await kit.quote(),paid=await kit.buy(quoted,{pay:false});stripe.pay(paid.session.id,{...taxAddress,line1:'9 synthetic-stall-elsewhere',postal_code:'78703'})
  const webhook=await deliverWebhook(h,kit.secret,paid.session);assert.equal(webhook.response.status,409);assert.equal(webhook.value.error.code,'TAX_DESTINATION_CHANGED')
  let order=await kit.order(paid.started.orderId);assert.equal(order.status,'paid');assert.equal(order.reservation,undefined);assert.equal(order.tax.transactionId,undefined)
  const prepared=await h.command('refund.prepare',{orderId:order.id,revision:order.revision,kind:'address_change',reason:'Customer paid for another address'}),draft=prepared.refunds.at(-1)
  assert.equal(draft.amountCents,quoted.result.totalCents);assert.equal(draft.taxTreatment,'sale_never_recorded')
  const approved=await h.command('refund.approve',{orderId:order.id,revision:prepared.revision});assert.equal(approved.refunds.at(-1).status,'succeeded')
  assert.equal([...stripe.refunds.values()].find(r=>r.amount===quoted.result.totalCents).status,'succeeded')
  await h.command('refund.prepare',{orderId:order.id,revision:approved.revision,kind:'address_change',reason:'Again'},{status:409})
  assert.equal(tax.transactions.size,1,'no tax transaction exists for the refunded payment (only the earlier reviewed sale)')
  const replay=await deliverWebhook(h,kit.secret,paid.session);assert.equal(replay.response.status,200,'the refunded payment is no longer retried')
  order=await kit.order(order.id);assert.equal(order.reservation,undefined);assert.equal(order.shipment?.status,undefined)
  const report=await h.api('/api/stall/tax/liability?from=2000-01-01&to=2100-01-01');assert.equal(report.transactions.length,1);assert.equal(report.transactions[0].orderId,reviewed.order.id)
 }finally{await kit.close()}
})

test('TAX-003: marketplace-facilitated sales are recorded as separate reporting evidence that counts toward nexus and never replaces existing evidence',async()=>{
 const h=await installation({outboundService:()=>{assert.fail('Marketplace evidence must not call a provider')}})
 try {
  const path='/api/stall/tax/marketplace',state=await h.api(path),sale={kind:'sale',marketplace:'Synthetic Marketplace',reference:'synthetic-stall-m-1',occurredOn:'2026-01-15',state:'WA',goodsCents:8000,nonTaxableCents:1000,shippingCents:500,taxCents:700}
  await h.api(path,{consent:'agree',rows:[sale]},{status:400});await h.api(path,{consent:state.consent,rows:[{...sale,state:'ZZ'}]},{status:400})
  const member=await h.signIn('synthetic-stall-market-member@example.test');await h.api(path,{consent:state.consent,rows:[sale]},{as:member,status:403})
  const refund={kind:'refund',marketplace:'Synthetic Marketplace',reference:'synthetic-stall-m-1-r',occurredOn:'2026-02-03',state:'WA',goodsCents:2000,shippingCents:0,taxCents:175,originalReference:'synthetic-stall-m-1'}
  await h.api(path,{consent:state.consent,rows:[{...refund,originalReference:'synthetic-stall-unrecorded'}]},{status:409})
  await h.api(path,{consent:state.consent,rows:[sale,refund]});await h.api(path,{consent:state.consent,rows:[sale]})
  await h.api(path,{consent:state.consent,rows:[{...sale,taxCents:701}]},{status:409})
  assert.equal((await h.api(path)).entries.length,2,'an identical replay adds nothing and a conflicting one replaces nothing')
  const january=await h.api('/api/stall/tax/liability?from=2026-01-01&to=2026-02-01'),february=await h.api('/api/stall/tax/liability?from=2026-02-01&to=2026-03-01')
  assert.deepEqual(january.states.map(row=>[row.state,row.channel]),[['WA','marketplace']])
  assert.equal(january.totals.taxCents,0,'the merchant totals never absorb tax the marketplace collected and remitted')
  assert.equal(january.marketplaceTotals.grossSalesCents,8000);assert.equal(january.marketplaceTotals.taxableSalesCents,7000);assert.equal(january.marketplaceTotals.nonTaxableSalesCents,1000)
  assert.equal(january.marketplaceTotals.shippingSalesCents,500);assert.equal(january.marketplaceTotals.taxCollectedCents,700)
  assert.equal(february.marketplaceTotals.refundGrossCents,-2000);assert.equal(february.marketplaceTotals.refundTaxCents,-175);assert.equal(february.transactions[0].originalTransactionId,january.transactions[0].id)
  const rows=readCsv(await (await h.request('/api/stall/tax/liability.csv?from=2026-01-01&to=2026-03-01&level=state')).text())
  assert.deepEqual(rows.map(row=>[row.state,row.channel,Number(row.taxCents)]),[['WA','marketplace',525]])
  const config=await h.api('/api/stall/tax/configuration')
  await h.api('/api/stall/tax/configuration',{revision:config.revision,value:{shipFrom:{line1:'1200 Cedar Avenue',city:'Austin',state:'TX',postal_code:'78702',country:'US'},categories:[],thresholds:[{state:'WA',salesCents:10000,transactions:10,warningPercent:50}]}})
  const nexus=await h.api('/api/stall/tax/nexus?from=2026-01-01&to=2026-03-01');assert.equal(nexus.states[0].netGrossCents,6000);assert.equal(nexus.states[0].status,'warning')
  assert.ok((await h.api('/api/stall/state')).audit.some(event=>event.action==='tax.marketplace-recorded'))
  let restored
  try {restored=await installation();await restore(restored,await archive(h));assert.deepEqual((await restored.api('/api/stall/tax/liability?from=2026-01-01&to=2026-02-01')).marketplaceTotals,january.marketplaceTotals)}finally{await restored?.close()}
 }finally{await h.close()}
})

test('uncertain sale tax survives archive restore as original-reference observation without replacement or checkout authority',async()=>{
 const {taxCommerceInstallation}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h,tax,stripe}=kit
 let receiving
 try {
  const quoted=await kit.quote(),pending=await kit.buy(quoted,{pay:false})
  stripe.pay(pending.session.id,quoted.input.destination);tax.fault='lost-sale'
  assert.equal((await deliverWebhook(h,kit.secret,pending.session)).response.status,503)
  assert.equal(tax.transactions.size,1)
  const original=[...tax.transactions.keys()][0],before=tax.calls.filter(c=>c.method==='POST').length,saved=await archive(h)
  receiving=await installation({bindings:{...kit.pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-806',STRIPE_WEBHOOK_SECRET:kit.secret},outboundService:request=>new URL(request.url).hostname==='api.stripe.com'&&(/^\/v1\/tax\//.test(new URL(request.url).pathname)||new URL(request.url).pathname==='/v1/account')?tax.handle(request):stripe.handle(request)})
  await restore(receiving,saved)
  const mode=await receiving.api('/api/stall/tax/mode',undefined,{as:''});assert.equal(mode.enabled,false);assert.equal(mode.requiresReview,true)
  await receiving.api('/api/stall/checkout',{...pending.payload,idempotencyKey:crypto.randomUUID()},{as:'',status:503})
  await receiving.api('/api/stall/tax/recover',{orderId:pending.order.id,transactionId:'tax_missing'},{status:503})
  const recovered=await receiving.api('/api/stall/tax/recover',{orderId:pending.order.id,transactionId:original})
  assert.equal(recovered.tax.transactionId,original)
  assert.equal(tax.calls.filter(c=>c.method==='POST').length,before,'restored recovery only reads original provider evidence')
  const report=await receiving.api('/api/stall/tax/liability?from=2026-01-01&to=2031-01-01')
  assert.equal(report.transactions.length,1);assert.equal(report.transactions[0].id,original)
  assert.equal((await receiving.api('/api/stall/tax/mode',undefined,{as:''})).requiresReview,true,'historical recovery does not reactivate tax checkout')
  assert.equal((await h.api('/api/stall/tax/recover',{orderId:pending.order.id,transactionId:original})).tax.transactionId,original)
  assert.equal(tax.transactions.size,1)
 }finally{await receiving?.close();await kit.close()}
})
