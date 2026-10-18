import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { installation } from './harness.mjs'

test('DEMO-001: a lived-in demo seeds once and commerce/invitations send nothing', async () => {
 const outbound=[]
 const h=await installation({entry:resolve('tests/api/demo-worker.ts'),bindings:{RER_DEMO:'1'},outboundService:async request=>{outbound.push(`${request.method} ${new URL(request.url).host}`);return new Response('demo requests must not leave',{status:599})}})
 try {
  const state=await h.api('/api/stall/state')
  assert.deepEqual(state.connections,{pier:true,stripe:true,webhook:true})
  assert.equal(state.products.length,15)
  const status=s=>s.orders.reduce((m,o)=>({...m,[o.status]:(m[o.status]??0)+1}),{})
  assert.deepEqual(status(state),{paid:1,awaiting_payment:2,reserved:6,shipped:34,shortfall:1})
  assert.ok(state.products.some(p=>p.value.active))
  assert.ok(state.products.some(p=>p.value.draft))
  for(const status of ['paid','awaiting_payment','reserved','shipped','shortfall'])assert.ok(state.orders.some(o=>o.status===status),`sample orders include ${status}`)
  assert.ok(Math.min(...state.orders.map(o=>Date.parse(o.createdAt)))<Date.now()-28*86400000)
  assert.ok(state.audit.some(e=>e.actor.startsWith('agent:')))
  assert.ok((await h.api('/api/stall/agent-token')).grants.length>0)
  const again=await h.api('/api/stall/state')
  assert.deepEqual(again.products,state.products)
  assert.deepEqual(again.orders,state.orders)
  assert.deepEqual(again.audit,state.audit)
  assert.ok(state.orders.some(o=>o.refunds.some(r=>r.status==='succeeded')))
  // A person approves the refund the shop's agent prepared: Stripe refunds the customer (mocked).
  const waiting=state.orders.find(o=>o.refunds.some(r=>r.status==='draft'))
  const refunded=await h.command('refund.approve',{orderId:waiting.id,revision:waiting.revision})
  assert.equal(refunded.refunds.at(-1).status,'succeeded')
  assert.match(refunded.refunds.at(-1).stripeId,/^re_demo_/)
  // Approving a packed order's shipping dispatches it through Pier (mocked).
  const packed=state.orders.find(o=>o.shipment?.status==='draft')
  const shipped=await h.command('shipment.approve',{orderId:packed.id,revision:packed.revision})
  assert.equal(shipped.status,'shipped')
  // A shopper buys from the public shop: Checkout is paid at once and stock is reserved.
  const shop=await h.api('/api/stall/catalogue')
  const mug=shop.items.find(i=>i.sku==='SC-MUG-SALT')
  assert.ok(shop.checkoutReady&&Number(mug.available)>=2)
  const paid=await h.api('/api/stall/checkout',{customerEmail:'shopper@example.test',lines:[{sku:mug.sku,quantity:2}],expectedTotalCents:2*mug.unitCents,idempotencyKey:crypto.randomUUID()})
  assert.match(paid.url,/^\/order\?checkout=success&orderId=/)
  assert.equal(paid.status,'reserved')
  assert.equal(Number((await h.api('/api/stall/catalogue')).items.find(i=>i.sku===mug.sku).available),Number(mug.available)-2)
  // Inviting a teammate is accepted and no mail reaches the provider.
  await h.api('/auth/invite',{email:'ellie@example.test',displayName:'Ellie',role:'admin',returnTo:'/app'},{status:202})
  assert.equal(h.messages.length,0)
  assert.deepEqual(outbound,[])
 }finally{await h.close()}
})


test('DEMO-001: an ordinary installation stays empty and production build/deploy refuse demo mode',async()=>{
 const fresh=await installation({entry:resolve('tests/api/demo-worker.ts')})
 const home=await mkdtemp(join(tmpdir(),'stall-demo-refusal-'))
 try {
  const state=await fresh.api('/api/stall/state')
  assert.deepEqual(state.products,[])
  assert.deepEqual(state.orders,[])
  assert.deepEqual(state.audit,[])
  assert.deepEqual((await fresh.api('/api/stall/agent-token')).grants,[])
  assert.deepEqual((await fresh.api('/api/stall/catalogue')).items,[])
  for(const verb of ['build','deploy']) {
   const result=spawnSync(process.execPath,[resolve('node_modules/@runeditrun/rer/global/rer.mjs'),verb,'--json'],{
    env:{...process.env,HOME:home,RER_DEMO:'1'},encoding:'utf8',timeout:30000,
   })
   assert.equal(result.error,undefined)
   assert.notEqual(result.status,0,`production ${verb} must refuse RER_DEMO`)
   const events=result.stdout.trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})
   assert.ok(events.some(e=>e.event==='error'&&e.code==='safety_refusal'&&/RER_DEMO/.test(e.message)),`production ${verb} must name demo mode as the refusal`)
  }
 }finally{await fresh.close();await rm(home,{recursive:true,force:true})}
})
