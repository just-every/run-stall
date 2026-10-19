import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, publish, purchase, deliverWebhook } from './network.mjs'
import { readCsv } from './csv-reader.mjs'

test('INTEGRATION-001: lost Pier command replies retain original work through owner key rotation, restore and reconciliation',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret}
 let h,destination,wrongCustomer
 try {
  h=await installation({bindings,outboundService:edge.handle})
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  await publish(h,'TOWEL-NAT','Natural linen towel',1800)
  const bought=await purchase(h,edge),paid=edge.pay(bought.session.id)
  edge.loseNextPierResponse('order.create')
  assert.equal((await deliverWebhook(h,secret,paid)).response.status,503)
  const work=async app=>(await app.api('/api/stall/operations')).pierWork.records.filter(row=>row.orderId===bought.orderId)
  const reserve=(await work(h)).find(row=>row.kind==='order.create')
  assert.equal(reserve.status,'uncertain')
  assert.equal(reserve.providerId,null)
  assert.ok(reserve.attempts>0&&Number.isFinite(Date.parse(reserve.attemptedAt)))
  assert.ok(reserve.errorCode)
  assert.equal((await pier.api('/api/pier/state')).orders.length,1)

  edge.loseNextPierResponse('order.channelPayment')
  await h.command('order.reconcile',{orderId:bought.orderId},{status:503})
  const before=await work(h),payment=before.find(row=>row.kind==='order.channelPayment')
  assert.equal(before.find(row=>row.id===reserve.id).status,'response_observed')
  assert.equal(payment.status,'uncertain')
  assert.equal(payment.providerCorrelation,paid.payment_intent)
  const stockBefore=await pier.api('/api/pier/state')
  assert.equal(stockBefore.orders[0].channelPayment.reference,paid.payment_intent)
  const saved=await archive(h)
  // A replacement key approved by the same Pier owner retains its command actor.
  const channel=stockBefore.channels.find(row=>row.id===pier.channelId)
  const rotated=await pier.command('channel.stallKey',{channelId:channel.id,version:channel.version,customerId:pier.customer.id})
  const callsBeforeRevocation=edge.pierCalls.length
  await h.command('order.reconcile',{orderId:bought.orderId},{status:503})
  assert.equal(edge.pierCalls.length,callsBeforeRevocation,'revoked credential fails the state read before any command replay')
  assert.equal((await work(h)).find(row=>row.id===payment.id).status,'uncertain')
  wrongCustomer=await installation({bindings:{...bindings,PIER_SESSION:`pier_channel=${rotated.key}`,PIER_CUSTOMER_ID:'another-shop'},outboundService:edge.handle})
  await restore(wrongCustomer,saved)
  const wrongCalls=edge.pierCalls.length
  const refused=await wrongCustomer.command('order.reconcile',{orderId:bought.orderId},{status:409})
  assert.equal(refused.error.code,'PIER_CHANGED')
  assert.equal(edge.pierCalls.length,wrongCalls)
  assert.deepEqual(await work(wrongCustomer),before)
  destination=await installation({bindings:{...bindings,PIER_SESSION:`pier_channel=${rotated.key}`},outboundService:edge.handle})
  await restore(destination,saved)
  assert.deepEqual(await work(destination),before)
  let order=await destination.command('order.reconcile',{orderId:bought.orderId})
  assert.equal(order.status,'reserved')
  const recovered=await work(destination)
  assert.equal(recovered.find(row=>row.id===payment.id).status,'response_observed')
  assert.ok(recovered.find(row=>row.id===payment.id).attempts>payment.attempts)
  assert.equal(new Set(edge.pierCalls.filter(row=>row.type==='order.create').map(row=>row.commandId)).size,1)
  assert.equal(new Set(edge.pierCalls.filter(row=>row.type==='order.channelPayment').map(row=>row.commandId)).size,1)

  order=await destination.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'JOURNAL-SHIPMENT'})
  edge.loseNextPierResponse('dispatch.create')
  await destination.command('shipment.approve',{orderId:order.id,revision:order.revision},{status:503})
  const dispatch=(await work(destination)).find(row=>row.kind==='dispatch.create')
  assert.equal(dispatch.status,'uncertain')
  assert.equal((await pier.api('/api/pier/state')).shipments.length,1)
  order=await destination.command('order.reconcile',{orderId:order.id})
  assert.equal(order.status,'shipped')
  const final=await work(destination),observed=final.find(row=>row.id===dispatch.id)
  assert.equal(observed.status,'response_observed')
  assert.equal(observed.providerId,order.shipment.pierShipmentId)
  await destination.command('order.reconcile',{orderId:order.id})
  const stock=await pier.api('/api/pier/state')
  assert.equal(stock.orders.length,1)
  assert.equal(stock.shipments.length,1)
  assert.equal(new Set(edge.pierCalls.filter(row=>row.type==='dispatch.create').map(row=>row.commandId)).size,1)
  const records=await destination.api('/api/stall/exports/records')
  assert.deepEqual(records.pierWork.filter(row=>row.orderId===order.id),await work(destination))
  const csv=readCsv(await (await destination.request('/api/stall/exports/pier-work')).text())
  assert.equal(csv.length,final.length)
  assert.ok(csv.some(row=>row.id===dispatch.id&&row.providerId===observed.providerId))
  const safe=JSON.stringify({records:records.pierWork,csv,work:final})
  for(const value of [secret,bindings.PIER_SESSION,rotated.key,'customer@example.test','1 Maker Lane'])assert.ok(!safe.includes(value))
  assert.ok(final.every(row=>!('intentHash' in row)&&!('payload' in row)))
 } finally {await wrongCustomer?.close();await destination?.close();await h?.close();await pier.close()}
})
