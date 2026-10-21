import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, deliverWebhook, publish, purchase } from './network.mjs'
import { readCsv } from './csv-reader.mjs'
const state=h=>h.api('/api/stall/state')

test('BASE-001 / INTEGRATION-001: native owner data doors preserve commerce and custody, exclude authority and fence erasure',async t=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret='whsec_'+randomBytes(32).toString('hex'),stripeKey='sk_test_'+randomBytes(32).toString('hex')
 const providerBodies=[]
 const h=await installation({outboundService:async request=>{providerBodies.push(await request.clone().text());return edge.handle(request)}})
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
  let annotated
  await t.test('ORDER-001a: internal notes and tags require human staff, exact revisions and owner redaction',async()=>{
   const admin=await h.signIn('synthetic-stall-101@example.test','admin')
   const member=await h.signIn('synthetic-stall-102@example.test')
   const owner=(await state(h)).actor.id
   let current=(await state(h)).orders.find(value=>value.id===bought.orderId)
   const oldRevision=current.revision
   current=await h.command('order.note.add',{orderId:current.id,revision:current.revision,text:'synthetic-stall-103'})
   const original=current.notes[0]
   assert.equal(original.by,owner)
   assert.ok(Number.isFinite(Date.parse(original.at)))
   current=await h.command('order.note.add',{orderId:current.id,revision:current.revision,text:'synthetic-stall-104'},{as:admin})
   assert.equal(current.notes[0].text,original.text,'a correction appends without replacing the original')
   assert.equal(current.notes[1].by,(await h.api('/auth/session',undefined,{as:admin})).operator.id)
   const commands=[['order.note.add',{text:'synthetic-stall-105'}],['order.note.redact',{noteId:original.id,reason:'customer@example.test'}],['order.tag.add',{tag:'synthetic-stall-106'}],['order.tag.remove',{tag:'synthetic-stall-106'}]]
   for(const [type,payload] of commands) {
    await h.command(type,{orderId:current.id,revision:oldRevision,...payload},{status:409})
    for(const refused of [{as:'',status:401},{as:member,status:403},{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403}])await h.command(type,{orderId:current.id,revision:current.revision,...payload},refused)
   }
   await h.command('order.note.add',{orderId:current.id,revision:current.revision,text:'synthetic-stall-107'.repeat(120)},{status:400})
   await h.command('order.tag.add',{orderId:current.id,revision:current.revision,tag:'synthetic-stall-108'.repeat(3)},{status:400})
   await h.command('order.note.redact',{orderId:current.id,revision:current.revision,noteId:original.id,reason:'synthetic-stall-109'},{as:admin,status:403})
   await h.command('order.note.redact',{orderId:current.id,revision:current.revision,noteId:original.id},{status:400})
   current=await h.command('order.note.redact',{orderId:current.id,revision:current.revision,noteId:original.id,reason:'customer@example.test'})
   assert.deepEqual({...current.notes[0],text:original.text,redaction:undefined},{...original,redaction:undefined})
   assert.ok(!current.notes[0].text.includes(original.text))
   assert.equal(current.notes[0].redaction.by,owner)
   assert.equal(current.notes[0].redaction.reason,'customer@example.test')
   current=await h.command('order.tag.add',{orderId:current.id,revision:current.revision,tag:'synthetic-stall-110'},{as:admin})
   assert.deepEqual(current.tags,['synthetic-stall-110'])
   current=await h.command('order.tag.remove',{orderId:current.id,revision:current.revision,tag:'synthetic-stall-110'},{as:admin})
   assert.deepEqual(current.tags,[])
   for(let index=200;index<250;index++)current=await h.command('order.tag.add',{orderId:current.id,revision:current.revision,tag:`synthetic-stall-${index}`})
   await h.command('order.tag.add',{orderId:current.id,revision:current.revision,tag:'synthetic-stall-250'},{status:400})
   annotated=current
   for(const path of ['/api/stall/state','/api/stall/orders','/api/stall/orders/history?orderId='+current.id]) {
    await h.api(path,undefined,{as:member,status:403})
    if(path==='/api/stall/state') {
     const agentRead=await h.api(path,undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`}})
     assert.equal(agentRead.orders.find(value=>value.id===current.id).notes,undefined)
     assert.equal(agentRead.orders.find(value=>value.id===current.id).tags,undefined)
    } else await h.api(path,undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
   }
   const read=(await h.api('/api/stall/orders',undefined,{as:admin})).orders.find(value=>value.id===current.id)
   assert.deepEqual(read.notes,current.notes)
   assert.deepEqual(read.tags,current.tags)
   const history=await h.api('/api/stall/orders/history?orderId='+current.id)
   for(const action of ['order.note.added','order.note.redacted','order.tag.added','order.tag.removed'])assert.ok(history.events.some(event=>event.action===action&&event.actor&&Number.isFinite(Date.parse(event.at))))
   for(const publicResult of [await h.api('/api/stall/catalogue',undefined,{as:''}),await h.api('/api/stall/checkout/confirm',{orderId:current.id},{as:''})]) {
    const bytes=JSON.stringify(publicResult)
    for(const value of [original.text,current.notes[1].text,...current.tags])assert.ok(!bytes.includes(value),'internal annotations never reach a shop visitor')
   }
  })
  await t.test('EXPORT-001: owner downloads independent-readable business CSVs, exact totals and complete commercial JSON',async()=>{
   const current=(await state(h)).products.find(p=>p.id==='MUG-BLUE')
   const description='Care, "hand wash"\nClay & cotton — made by Zoë'
   await h.command('product.prepare',{sku:current.id,revision:current.revision,name:'=HYPERLINK("https://unsafe.example.test")',description,unitCents:2999,active:true})
   let returned=(await state(h)).orders.find(o=>o.id===bought.orderId)
   returned=await h.command('refund.prepare',{orderId:returned.id,revision:returned.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Damaged mug, no restock'},{as:'',headers:{authorization:`Bearer ${grant.token}`}})
   assert.equal(returned.notes,undefined,'agent draft responses cannot reveal internal notes')
   assert.equal(returned.tags,undefined,'agent draft responses cannot reveal internal tags')
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
   assert.deepEqual(JSON.parse(csv.orders[0].notes),annotated.notes)
   assert.deepEqual(JSON.parse(csv.orders[0].tags),annotated.tags)
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
   assert.deepEqual(records.orders[0].notes,annotated.notes)
   assert.deepEqual(records.orders[0].tags,annotated.tags)
   assert.ok(!('checkoutKey' in records.orders[0]))
   assert.ok(!('requestDigest' in records.orders[0]))
   for(const privateValue of [stripeKey,secret,pierKey,grant.token])assert.ok(!JSON.stringify(records).includes(privateValue))
   await h.api('/api/stall/exports/unknown',undefined,{status:400})
   assert.ok((await state(h)).audit.some(a=>a.action==='business.exported'&&a.actor&&a.at))
  })
  const old=await archive(h)
  const beforeErasure=await fresh()
  await restore(beforeErasure,old)
  const roundTrip=(await state(beforeErasure)).orders.find(value=>value.id===bought.orderId)
  assert.deepEqual(roundTrip.notes,annotated.notes)
  assert.deepEqual(roundTrip.tags,annotated.tags)
  const privateValues=[['Stripe secret',stripeKey],['Stripe signing secret',secret],['Pier key',pierKey],['agent token',grant.token],...h.cookie.split(';').map((part,i)=>[`session cookie ${i}`,part.trim().slice(part.trim().indexOf('=')+1)])]
  for(const bytes of [JSON.stringify(old),JSON.stringify(await state(h))])for(const [label,value] of privateValues)assert.ok(!bytes.includes(value),`${label} must stay out of state and archive bytes`)
  await t.test('anonymous, member and agent cannot export or restore',async()=>{
   await h.api('/api/stall/portability/exports',{}, {as:'',status:401})
   const member=await h.signIn('staff@example.test')
   await h.api('/api/stall/portability/exports',{}, {as:member,status:403})
   await h.api('/api/stall/portability/exports',{}, {as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
   for(const kind of ['products','customers','orders','lines','payments','refunds','shipments','reconciliation','stripe-work','pier-work','records']) {
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
   assert.deepEqual(erased.notes,annotated.notes.map(({id,by,at})=>({id,by,at,text:'Erased with customer contact'})))
   assert.equal(erased.tags,undefined)
   assert.equal(erased.manualPayment?.reference,undefined)
   for(const [type,payload] of [['order.note.add',{text:'synthetic-stall-301'}],['order.tag.add',{tag:'synthetic-stall-302'}]])await h.command(type,{orderId:erased.id,revision:erased.revision,...payload},{status:409})
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
   for(const action of ['product.prepared','product.published','shipment.approved','shipment.shipped','agent.granted','customer.email-erased','order.note.added','order.note.redacted','order.tag.added','order.tag.removed'])assert.ok(restored.audit.some(a=>a.action===action&&a.actor&&Number.isFinite(Date.parse(a.at))),`restored activity retains ${action}`)
   assert.equal(restored.orders[0].customerEmail,null)
   assert.equal(restored.orders[0].totalCents,4250)
   assert.deepEqual(restored.orders[0].notes,annotated.notes.map(({id,by,at})=>({id,by,at,text:'Erased with customer contact'})))
   assert.equal(restored.orders[0].tags,undefined)
   assert.equal(restored.orders[0].manualPayment?.reference,undefined)
   for(const [type,payload] of [['order.note.add',{text:'synthetic-stall-303'}],['order.tag.add',{tag:'synthetic-stall-304'}]])await destination.command(type,{orderId:restored.orders[0].id,revision:restored.orders[0].revision,...payload},{status:409})
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
  await t.test('ORDER-001a: erasure removes a recorded payment reference and manual annotations through archive restore',async()=>{
   const current=await state(h)
   const total=current.products.find(value=>value.id==='MUG-BLUE').value.unitCents+current.shippingCents
   let manual=await h.command('order.manual',{idempotencyKey:randomUUID(),customerEmail:'synthetic-stall-501@example.test',name:'synthetic-stall-502',address:{line1:'synthetic-stall-503',line2:'',city:'synthetic-stall-504',state:'TX',postal_code:'78702',country:'US'},lines:[{sku:'MUG-BLUE',quantity:1}],expectedTotalCents:total,amountCents:total,method:'check',receivedOn:'2026-10-20',reference:'synthetic-stall-505'})
   assert.equal(manual.manualPayment.reference,'synthetic-stall-505')
   manual=await h.command('order.note.add',{orderId:manual.id,revision:manual.revision,text:'synthetic-stall-506'})
   manual=await h.command('order.tag.add',{orderId:manual.id,revision:manual.revision,tag:'synthetic-stall-507'})
   manual=await h.command('shipment.prepare',{orderId:manual.id,revision:manual.revision,reference:'synthetic-stall-508'})
   manual=await h.command('shipment.approve',{orderId:manual.id,revision:manual.revision})
   await h.command('customer.erase',{email:'synthetic-stall-501@example.test',confirm:'ERASE'})
   const erased=(await state(h)).orders.find(value=>value.id===manual.id)
   const {reference,...payment}=manual.manualPayment
   assert.deepEqual(erased.manualPayment,payment,'erasure keeps recorded payment facts while removing its free text')
   assert.deepEqual(erased.notes,manual.notes.map(({id,by,at})=>({id,by,at,text:'Erased with customer contact'})))
   assert.equal(erased.tags,undefined)
   const records=await h.api('/api/stall/exports/records')
   const bytes=JSON.stringify(records)
   for(const value of ['synthetic-stall-501@example.test','synthetic-stall-505','synthetic-stall-506','synthetic-stall-507'])assert.ok(!bytes.includes(value))
   const recipient=await fresh()
   await restore(recipient,await archive(h))
   const restored=(await state(recipient)).orders.find(value=>value.id===manual.id)
   assert.deepEqual(restored.manualPayment,payment)
   assert.deepEqual(restored.notes,erased.notes)
   assert.equal(restored.tags,undefined)
  })
  // The ruling asks for a probe of the existing abandoned-checkout policy, not
  // a change to that separate policy in this notes/erasure slice.
  const abandoned=await purchase(h,edge,{email:'synthetic-stall-401@example.test'})
  assert.equal((await state(h)).orders.find(value=>value.id===abandoned.orderId).status,'awaiting_payment')
  const blocked=await h.command('customer.erase',{email:'synthetic-stall-401@example.test',confirm:'ERASE'},{status:409})
  assert.equal(blocked.error.code,'PENDING_EFFECT')
  for(const value of ['synthetic-stall-103','synthetic-stall-104',...annotated.tags,'synthetic-stall-506','synthetic-stall-507'])assert.ok(!providerBodies.some(bytes=>bytes.includes(value)),'internal notes and tags never leave for a provider')
 }finally{for(const value of destinations)await value.close();await h.close();await pier.close()}
})

test('CATALOG-001: exact approved metadata stays private until publication, renders typed facts and travels without losing purchased descriptions',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 let h,destination
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
  const details={costCents:735,weightGrams:350,dimensionsMm:{length:120,width:90,height:100},taxCategory:'ceramics',hsCode:'691200',countryOfOrigin:'US',customFields:[
   {key:'care',label:'Care instructions',type:'text',value:'Hand wash. <img src=x onerror=alert(1)>'},
   {key:'capacity',label:'Capacity · ml',type:'number',value:325},
   {key:'dishwasher',label:'Dishwasher safe',type:'boolean',value:false},
  ]}
  const payload={sku:'MUG-BLUE',name:'Glazed mug',description:'Original cobalt glaze',unitCents:2450,active:true,details}
  for(const invalid of [
   {...details,costCents:7.35}, {...details,weightGrams:0}, {...details,dimensionsMm:{length:120,width:90}},
   {...details,hsCode:'ceramic'}, {...details,countryOfOrigin:'usa'},
   {...details,customFields:[{key:'care',label:'Care',type:'number',value:'three'}]},
   {...details,customFields:[details.customFields[0],details.customFields[0]]}, {...details,secret:'not a documented merchant fact'},
  ]) await h.command('product.prepare',{...payload,details:invalid},{status:400})
  assert.equal((await state(h)).products.length,0)
  let prepared=await h.command('product.prepare',payload)
  assert.deepEqual((await h.api('/api/stall/catalogue',undefined,{as:''})).items,[])
  await h.command('product.approve',{sku:prepared.id,revision:'stale'},{status:409})
  const published=await h.command('product.approve',{sku:prepared.id,revision:prepared.revision})
  assert.deepEqual(published.value.details,details)
  const listing=(await h.api('/api/stall/catalogue',undefined,{as:''})).items[0]
  assert.deepEqual(listing.customFields,details.customFields)
  for(const field of ['details','costCents','taxCategory','dimensionsMm','hsCode']) assert.equal(Object.hasOwn(listing,field),false)
  const bought=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],expectedTotalCents:2450})
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200)
  prepared=await h.command('product.prepare',{...payload,revision:published.revision,name:'New glaze',description:'Later green glaze',unitCents:3100,details:{...details,costCents:900,customFields:[{key:'care',label:'Care instructions',type:'text',value:'New care'}]}})
  assert.deepEqual((await h.api('/api/stall/catalogue',undefined,{as:''})).items[0].customFields,details.customFields)
  const pending=(await h.api('/api/stall/exports/records')).products[0].value
  assert.equal(pending.details.costCents,735)
  assert.equal(pending.draft.details.costCents,900)
  await h.command('product.approve',{sku:prepared.id,revision:prepared.revision})
  const purchased=(await state(h)).orders[0].lines[0]
  assert.deepEqual({name:purchased.name,description:purchased.description,unitCents:purchased.unitCents},{name:payload.name,description:payload.description,unitCents:2450})
  const exported=await h.api('/api/stall/exports/records')
  assert.equal(exported.orders[0].lines[0].description,payload.description)
  const rows=readCsv(await (await h.request('/api/stall/exports/products')).text())
  assert.deepEqual(JSON.parse(rows[0].details),exported.products[0].value.details)
  assert.equal(readCsv(await (await h.request('/api/stall/exports/lines')).text())[0].description,payload.description)
  // Narrow imports must refuse rich current or pending native values, never erase them.
  let native=await h.command('product.prepare',{sku:'RICH-STAGED',name:'Staged',description:'',unitCents:100,active:false,details})
  await h.command('product.approve',{sku:native.id,revision:native.revision})
  const csv='Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\nrich,Replacement,,RICH-STAGED,1.00,FALSE\n'
  await h.api('/api/stall/imports/preview',{csv},{status:409})
  assert.deepEqual((await state(h)).products.find(p=>p.id===native.id).value.details,details)
  const saved=await archive(h)
  destination=await installation()
  await restore(destination,saved)
  const transferred=await destination.api('/api/stall/exports/records')
  assert.deepEqual(transferred.products, (await h.api('/api/stall/exports/records')).products)
  assert.equal(transferred.orders[0].lines[0].description,payload.description)
  // Old callers can edit without dropping metadata; an explicit empty object clears it.
  const source=(await state(h)).products.find(p=>p.id===native.id)
  const retained=await h.command('product.prepare',{sku:source.id,revision:source.revision,name:'Renamed',description:'',unitCents:100,active:false})
  assert.deepEqual(retained.value.draft.details,details)
  const cleared=await h.command('product.prepare',{sku:source.id,revision:retained.revision,name:'Renamed',description:'',unitCents:100,active:false,details:{}})
  assert.equal(cleared.value.draft.details,undefined)
  await h.command('product.approve',{sku:source.id,revision:cleared.revision})
  const unblocked=await h.api('/api/stall/imports/preview',{csv})
  assert.equal(unblocked.counts.mapped,1)
 } finally {await destination?.close();await h?.close();await pier.close()}
})
