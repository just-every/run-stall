import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, deliverWebhook, publish, purchase } from './network.mjs'
const state=h=>h.api('/api/stall/state')

test('owner data doors preserve orders and import custody, exclude credentials and fence erasure',async t=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 let destination
 const destinations=[]
 const fresh=async()=>{const value=await installation();destinations.push(value);return value}
 try {
  const csv=await readFile(new URL('../../fixtures/shopify-products.csv',import.meta.url),'utf8')
  const preview=await h.api('/api/stall/imports/preview',{csv})
  const job=await h.api('/api/stall/imports/apply',{csv,fingerprint:preview.fingerprint})
  for(const [sku,name,cents] of [['MUG-BLUE','Blue ceramic mug',2450],['TOWEL-NAT','Natural linen towel',1800]]) {
   const p=(await state(h)).products.find(p=>p.id===sku)
   const draft=await h.command('product.prepare',{sku,name,description:'Australian made',unitCents:cents,active:true,revision:p.revision})
   await h.command('product.approve',{sku,revision:draft.revision})
  }
  const bought=await purchase(h,edge)
  const paid=edge.pay(bought.session.id)
  assert.equal((await deliverWebhook(h,secret,paid)).response.status,200)
  let order=(await state(h)).orders.find(o=>o.id===bought.orderId)
  await h.command('customer.erase',{email:'customer@example.test',confirm:'ERASE'},{status:409})
  order=await h.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'AU-TRACK-1001'})
  await h.command('shipment.approve',{orderId:order.id,revision:order.revision})
  const grant=await h.api('/api/stall/agent-token',{})
  const old=await archive(h)
  await t.test('anonymous, member and agent cannot export or restore',async()=>{
   await h.api('/api/stall/portability/exports',{}, {as:'',status:401})
   const member=await h.signIn('staff@example.test')
   await h.api('/api/stall/portability/exports',{}, {as:member,status:403})
   await h.api('/api/stall/portability/exports',{}, {as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
   await h.command('customer.erase',{email:'customer@example.test',confirm:'ERASE'},{as:member,status:403})
  })
  await t.test('human confirmation erases contact details and outstanding archive copies',async()=>{
   await h.command('customer.erase',{email:'customer@example.test',confirm:'WRONG'},{status:400})
   await h.command('customer.erase',{email:'customer@example.test',confirm:'ERASE'})
   const erased=(await state(h)).orders.find(o=>o.id===bought.orderId)
   assert.equal(erased.customerEmail,null)
   assert.equal(erased.shippingDetails,undefined)
   assert.equal(erased.requestDigest,'')
   assert.equal(erased.status,'shipped')
   assert.equal(erased.totalCents,4250)
   assert.ok(erased.shipment.approval.by)
  })
  const later=await archive(h)
  await t.test('post-erasure archive restores commercial history and the import journal',async()=>{
   destination=await fresh()
   assert.equal((await restore(destination,later)).phase,'complete')
   const restored=await state(destination)
   assert.equal(restored.orders.length,1)
   assert.equal(restored.orders[0].customerEmail,null)
   assert.equal(restored.orders[0].totalCents,4250)
   assert.equal((await destination.api('/api/stall/imports/'+job.id)).job.state,'completed')
   await destination.api('/api/stall/state',undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:401})
   await destination.api('/api/stall/state',undefined,{as:h.cookie,status:401})
   await restore(destination,later,{status:409})
   destination=undefined
  })
  await t.test('later journal refuses an old backup and tampering never restores a row',async()=>{
   destination=await fresh()
   await restore(destination,old,{status:400,laterJournal:{sourceIdentity:later[0].sourceIdentity,epoch:later[0].epoch,journal:later[0].journal}})
   assert.equal((await state(destination)).orders.length,0)
   destination=undefined
   destination=await fresh()
   const damaged=structuredClone(later)
   const part=damaged.find(x=>x.kind==='part'&&x.items.some(item=>item.kind==='row'&&item.table==='st_orders'))
   const row=part.items.find(x=>x.kind==='row'&&x.table==='st_orders')
   row.row.value_json='{}'
   const {id}=await destination.api('/api/stall/portability/imports',{manifest:damaged[0],confirmed:true})
   await destination.api(`/api/stall/portability/imports/${id}/parts/${part.index}`,part,{method:'PUT',status:400})
   assert.equal((await state(destination)).orders.length,0)
  })
 }finally{for(const value of destinations)await value.close();await h.close();await pier.close()}
})
