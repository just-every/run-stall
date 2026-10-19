import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, deliverWebhook, publish, purchase } from './network.mjs'
import { readCsv } from './csv-reader.mjs'
const state=h=>h.api('/api/stall/state')

test('BASE-001: native owner data doors preserve commerce and custody, exclude authority and fence erasure',async t=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret='whsec_'+randomBytes(32).toString('hex'),stripeKey='sk_test_'+randomBytes(32).toString('hex')
 const h=await installation({outboundService:edge.handle})
 let destination
 const destinations=[]
 const fresh=async()=>{const value=await installation();destinations.push(value);return value}
 try {
  // Connect through the same owner-only Settings commands as a real install.
  const pierKey=pier.bindings.PIER_SESSION.slice('pier_channel='.length)
  await h.command('connection.pier',{origin:pier.origin,key:pierKey})
  await h.command('connection.stripe',{secretKey:stripeKey,webhookSecret:secret})
  assert.deepEqual((await state(h)).connections,{pier:true,stripe:true,webhook:true})
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
  await t.test('EXPORT-001: owner downloads independent-readable business CSVs, exact totals and complete commercial JSON',async()=>{
   const current=(await state(h)).products.find(p=>p.id==='MUG-BLUE')
   const description='Care, "hand wash"\nClay & cotton — made by Zoë'
   await h.command('product.prepare',{sku:current.id,revision:current.revision,name:'=HYPERLINK("https://unsafe.example.test")',description,unitCents:2999,active:true})
   let returned=(await state(h)).orders.find(o=>o.id===bought.orderId)
   returned=await h.command('refund.prepare',{orderId:returned.id,revision:returned.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Damaged mug, no restock'})
   await h.command('refund.approve',{orderId:returned.id,revision:returned.revision,refundId:returned.refunds[0].id})
   const csv={}
   for(const kind of ['products','customers','orders','lines','payments','refunds','shipments','reconciliation']) {
    const response=await h.request('/api/stall/exports/'+kind)
    assert.equal(response.status,200)
    assert.match(response.headers.get('content-type'),/^text\/csv/)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.match(response.headers.get('content-disposition'),/attachment/)
    const bytes=await response.text()
    csv[kind]=readCsv(bytes)
    for(const privateValue of [stripeKey,secret,pierKey,grant.token])assert.ok(!bytes.includes(privateValue))
   }
   assert.equal(csv.products.length,3,'two current products plus the separate pending draft')
   const draft=csv.products.find(row=>row.state==='draft')
   assert.equal(draft.name,'\'=HYPERLINK("https://unsafe.example.test")')
   assert.equal(draft.description,description)
   assert.equal(draft.unitCents,'2999')
   assert.equal(csv.customers[0].email,'customer@example.test')
   assert.equal(csv.customers[0].paidCents,'4250')
   assert.equal(csv.customers[0].refundedCents,'2450')
   assert.equal(csv.orders.length,1)
   assert.equal(csv.orders[0].totalCents,'4250')
   assert.equal(JSON.parse(csv.orders[0].shippingDetails).address.country,'US')
   assert.equal(csv.lines.reduce((n,row)=>n+Number(row.lineTotalCents),0),4250)
   assert.equal(csv.payments[0].amountCents,'4250')
   assert.equal(csv.refunds[0].amountCents,'2450')
   assert.equal(csv.refunds[0].status,'succeeded')
   assert.equal(csv.shipments[0].status,'shipped')
   assert.equal(csv.reconciliation[0].netRecordedCents,'1800')
   assert.ok(csv.payments[0].paidAt.endsWith('Z'))
   assert.ok(csv.orders[0].createdAt.endsWith('Z'))
   const records=await h.api('/api/stall/exports/records')
   assert.equal(records.products.find(p=>p.id==='MUG-BLUE').value.draft.name,'=HYPERLINK("https://unsafe.example.test")')
   assert.equal(records.orders[0].refunds[0].amountCents,2450)
   assert.equal(records.orders[0].totalCents,4250)
   assert.ok(!('checkoutKey' in records.orders[0]))
   assert.ok(!('requestDigest' in records.orders[0]))
   for(const privateValue of [stripeKey,secret,pierKey,grant.token])assert.ok(!JSON.stringify(records).includes(privateValue))
   await h.api('/api/stall/exports/unknown',undefined,{status:400})
   assert.ok((await state(h)).audit.some(a=>a.action==='business.exported'&&a.actor&&a.at))
  })
  const old=await archive(h)
  const privateValues=[['Stripe secret',stripeKey],['Stripe signing secret',secret],['Pier key',pierKey],['agent token',grant.token],...h.cookie.split(';').map((part,i)=>[`session cookie ${i}`,part.trim().slice(part.trim().indexOf('=')+1)])]
  for(const bytes of [JSON.stringify(old),JSON.stringify(await state(h))])for(const [label,value] of privateValues)assert.ok(!bytes.includes(value),`${label} must stay out of state and archive bytes`)
  await t.test('anonymous, member and agent cannot export or restore',async()=>{
   await h.api('/api/stall/portability/exports',{}, {as:'',status:401})
   const member=await h.signIn('staff@example.test')
   await h.api('/api/stall/portability/exports',{}, {as:member,status:403})
   await h.api('/api/stall/portability/exports',{}, {as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
   for(const kind of ['products','customers','orders','lines','payments','refunds','shipments','reconciliation','records']) {
    await h.api('/api/stall/exports/'+kind,undefined,{as:'',status:401})
    await h.api('/api/stall/exports/'+kind,undefined,{as:member,status:403})
    await h.api('/api/stall/exports/'+kind,undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
   }
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
   assert.deepEqual(readCsv(await (await h.request('/api/stall/exports/customers')).text()),[])
   assert.ok(!JSON.stringify(await h.api('/api/stall/exports/records')).includes('customer@example.test'))
   assert.ok(erased.shipment.approval.by)
  })
  await h.command('shipping.configure',{shippingCents:625})
  const later=await archive(h)
  await t.test('post-erasure archive restores commercial history and the import journal',async()=>{
   const empty=await fresh()
   assert.equal((await empty.api('/api/stall/exports/records')).orders.length,0)
   assert.deepEqual(readCsv(await (await empty.request('/api/stall/exports/products')).text()),[])
   // Sensitive exports are audited. Preserve that destination's history rather
   // than replacing it; use an untouched installation for the actual restore.
   await restore(empty,later,{status:409})
   destination=await fresh()
   assert.equal((await restore(destination,later)).phase,'complete')
   const restored=await state(destination)
   assert.equal(restored.orders.length,1)
   assert.equal(restored.shippingCents,625)
   assert.deepEqual(restored.connections,{pier:false,stripe:false,webhook:false})
   for(const action of ['product.prepared','product.published','shipment.approved','shipment.shipped','agent.granted','customer.email-erased'])assert.ok(restored.audit.some(a=>a.action===action&&a.actor&&Number.isFinite(Date.parse(a.at))),`restored activity retains ${action}`)
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
