import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { installation,archive,restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge,deliverWebhook,publish,purchase } from './network.mjs'

test('reviewed historical imports preserve exact facts without live effects and belong only to a newly proven native mailbox',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1601',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 let destination
 try {
  const base='/api/stall/customers/history',account='/api/stall/account',email='synthetic-stall-1602@example.test',foreign='synthetic-stall-1603@example.test',erased='synthetic-stall-1604@example.test'
  const alice=await h.signIn(email),bob=await h.signIn(foreign),admin=await h.signIn('synthetic-stall-1615@example.test','admin'),grant=await h.api('/api/stall/agent-token',{})
  const directoryRows=[email,foreign,erased].map(email=>({email,name:'Synthetic historical customer'}))
  const directoryPreview=await h.api('/api/stall/customers/import/preview',{rows:directoryRows})
  await h.api('/api/stall/customers/import/apply',{rows:directoryRows,fingerprint:directoryPreview.fingerprint})
  const row={recordId:'synthetic-stall-1605',email:'  SYNTHETIC-STALL-1602@EXAMPLE.TEST  ',createdAt:'2021-03-01T09:30:00+10:00',status:'partially_refunded',paid:true,lines:[{sku:'MUG-BLUE',name:'Original handmade mug',quantity:2,unitCents:1000}],shippingCents:500,taxCents:300,totalCents:2800,address:{name:'Synthetic buyer',line1:'10 Historical Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'},refunds:[{recordId:'synthetic-stall-1606',status:'succeeded',amountCents:500},{recordId:'synthetic-stall-1607',status:'failed',amountCents:800}],tracking:{shippedAt:'2021-03-02T09:30:00+10:00',deliveryStatus:'delivered',trackingCode:'synthetic-stall-1608',trackingUrl:'https://carrier.example.test/track/synthetic-stall-1608'}}
  const auxiliary={source:'Synthetic legacy source',rows:[{...row,recordId:'synthetic-stall-1609',email:erased}]}
  let checked=await h.api(base+'/preview',auxiliary)
  await h.api(base+'/apply',{...auxiliary,fingerprint:checked.fingerprint,confirmed:true})
  const payload={source:'Synthetic legacy source',rows:[row,{...row,recordId:'synthetic-stall-1610',paid:false,status:'cancelled',refunds:[],tracking:undefined},{...row,recordId:'synthetic-stall-1611',email:foreign}]}
  await h.api(base+'/preview',payload,{as:'',status:401})
  await h.api(base+'/preview',payload,{as:bob,status:403})
  await h.api(base+'/preview',payload,{as:'',headers:{authorization:'Bearer '+grant.token},status:403})
  await h.api(base+'/preview',payload,{headers:{origin:'https://foreign.example.test'},status:403})
  for(const createdAt of ['2021-03-01','2021-03-01T09:30:00','2021-02-29T09:30:00Z','2021-03-01T24:00:00Z'])await h.api(base+'/preview',{...payload,rows:[{...row,createdAt}]},{status:400})
  for(const change of [{payment:{intentId:'synthetic-stall-1612'}},{tracking:{...row.tracking,trackingUrl:'javascript:alert(1)'}},{tracking:{...row.tracking,trackingUrl:'bad url'}},{refunds:[row.refunds[0],row.refunds[0]]},{totalCents:2801}])await h.api(base+'/preview',{...payload,rows:[{...row,...change}]},{status:400})
  await h.api(base+'/preview',{...payload,rows:[row,row]},{status:400})
  const oversized=await h.mf.dispatchFetch(h.origin+base+'/preview',{method:'POST',headers:{origin:h.origin,cookie:h.cookie,'content-type':'application/json'},body:' '.repeat(1000001)})
  assert.equal(oversized.status,413)
  checked=await h.api(base+'/preview',payload)
  assert.equal(checked.rows[0].email,email)
  const before={mail:h.messages.length,provider:edge.calls.length,pier:(await pier.api('/api/pier/state')).orders.length,live:(await h.api('/api/stall/state')).orders.length}
  // Erasure changes a revision while retaining the same history row count.
  await h.command('customer.erase',{email:erased,confirm:'ERASE'})
  await h.api(base+'/apply',{...payload,fingerprint:checked.fingerprint,confirmed:true},{status:409})
  assert.deepEqual((await h.api(account,undefined,{as:alice})).orders,[])
  await h.api(base+'/preview',auxiliary,{status:409})
  checked=await h.api(base+'/preview',payload)
  await h.api(base+'/apply',{...payload,fingerprint:checked.fingerprint,confirmed:false},{status:409})
  await h.api(base+'/apply',{...payload,rows:[{...row,totalCents:2800,lines:[{...row.lines[0],name:'Changed after review'}]}],fingerprint:checked.fingerprint,confirmed:true},{status:409})
  assert.deepEqual(await h.api(base+'/apply',{...payload,fingerprint:checked.fingerprint,confirmed:true}),{imported:3,duplicates:0})
  checked=await h.api(base+'/preview',payload)
  assert.equal(checked.duplicateCount,3)
  assert.deepEqual(await h.api(base+'/apply',{...payload,fingerprint:checked.fingerprint,confirmed:true},{as:admin}),{imported:0,duplicates:3})
  await h.api(base+'/preview',{...payload,rows:[{...row,lines:[{...row.lines[0],name:'Conflicting source facts'}]}]},{status:409})
  assert.equal((await h.api(base+'/preview',{...payload,source:'Another exact source',rows:[row]})).newCount,1)
  assert.equal(h.messages.length,before.mail)
  assert.equal(edge.calls.length,before.provider)
  assert.equal((await pier.api('/api/pier/state')).orders.length,before.pier)
  assert.equal((await h.api('/api/stall/state')).orders.length,before.live)
  let mine=await h.api(account,undefined,{as:alice})
  assert.equal(mine.orders.length,2)
  const imported=mine.orders.find(order=>order.paid),ownDoor=account+'/orders/'+imported.id
  assert.equal(imported.createdAt,'2021-02-28T23:30:00.000Z')
  assert.equal(imported.totalCents,2800)
  assert.equal(imported.refunds.find(refund=>refund.status==='succeeded').amountCents,500)
  assert.equal(imported.shipment.dispatches[0].tracking[0].trackingUrl,row.tracking.trackingUrl)
  for(const field of ['payment','checkout','reservation','requestDigest','customerEmail'])assert.equal(field in imported,false)
  assert.equal((await h.api(ownDoor,undefined,{as:alice})).order.id,imported.id)
  await h.api(ownDoor,undefined,{as:bob,status:404})
  await h.api(ownDoor,undefined,{as:'',status:401})
  await h.api(ownDoor,undefined,{as:'',headers:{authorization:'Bearer '+grant.token},status:401})
  assert.equal((await h.api(account,undefined,{as:bob})).orders.length,1)
  const unproven=await h.signIn('synthetic-stall-1613@example.test')
  await h.api('/auth/email',{email:erased},{as:unproven})
  await h.api(account,undefined,{as:unproven,status:403})
  await h.api(ownDoor,undefined,{as:unproven,status:403})
  let customer=(await h.api('/api/stall/customers')).customers.find(customer=>customer.emails.includes(email))
  assert.equal(customer.orderCount,1)
  assert.equal(customer.paidCents,2800)
  assert.equal(customer.refundedCents,500)
  assert.equal(customer.lifetimeValueCents,2300)
  assert.ok(customer.states.includes('TX'))

  await publish(h,'MUG-BLUE','Current handmade mug',2450)
  const bought=await purchase(h,edge,{skus:['MUG-BLUE'],email})
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200)
  mine=await h.api(account,undefined,{as:alice})
  assert.equal(mine.orders.length,3)
  assert.equal(mine.orders[0].id,bought.orderId)
  assert.deepEqual(mine.orders.find(order=>order.id===imported.id),imported)
  customer=(await h.api('/api/stall/customers')).customers.find(customer=>customer.emails.includes(email))
  assert.equal(customer.orderCount,2)
  assert.equal(customer.paidCents,5250)
  assert.equal(customer.refundedCents,500)

  const business=await h.api('/api/stall/exports/records')
  assert.ok(JSON.stringify(business).includes(row.recordId))
  assert.ok(!JSON.stringify(business).includes(erased))
  const lines=await archive(h),snapshot={calls:edge.calls.length,mail:h.messages.length}
  destination=await installation()
  await restore(destination,lines)
  await destination.api(account,undefined,{as:alice,status:401})
  await destination.api(account,undefined,{as:h.cookie,status:401})
  await destination.api('/api/stall/state',undefined,{as:'',headers:{authorization:'Bearer '+grant.token},status:401})
  const restored=await destination.signIn(email),restoredMine=await destination.api(account,undefined,{as:restored})
  assert.deepEqual(new Set(restoredMine.orders.map(order=>order.id)),new Set(mine.orders.map(order=>order.id)))
  assert.deepEqual(restoredMine.orders.find(order=>order.id===imported.id),imported)
  const restoredBob=await destination.signIn(foreign)
  await destination.api(ownDoor,undefined,{as:restoredBob,status:404})
  const duplicates=await destination.api(base+'/preview',payload)
  assert.equal(duplicates.duplicateCount,3)
  assert.deepEqual(await destination.api(base+'/apply',{...payload,fingerprint:duplicates.fingerprint,confirmed:true}),{imported:0,duplicates:3})
  assert.equal(edge.calls.length,snapshot.calls)
  assert.equal(h.messages.length,snapshot.mail)
 } finally {await destination?.close();await h.close();await pier.close()}
})
