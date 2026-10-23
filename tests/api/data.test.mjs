import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, deliverWebhook, publish, purchase, sendFile, png, pdf } from './network.mjs'
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

test('CATALOG-001: personalization is validated, priced and carried to the order, packing slip, confirmation, exports and erasure',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 let h,destination
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
  const fields=[{key:'engraving',label:'Engraving',type:'text',maxLength:20,addOnCents:500},{key:'artwork',label:'Artwork',type:'file',fileTypes:['png','pdf'],maxBytes:2000},{key:'glaze',label:'Glaze',type:'choice',choices:['Matte','Gloss'],required:true}]
  const payload={sku:'MUG-BLUE',name:'Glazed mug',description:'Cobalt glaze',unitCents:2450,active:true,details:{personalization:fields}}
  for(const invalid of [[{...fields[0],maxLength:0}],[{...fields[1],fileTypes:['exe']}],[{...fields[1],maxBytes:700001}],[{...fields[2],choices:['Only']}],[{...fields[0],addOnCents:-1}],[fields[0],fields[0]],[{key:'x',label:'X',type:'photo'}]])
   await h.command('product.prepare',{...payload,details:{personalization:invalid}},{status:400})
  const prepared=await h.command('product.prepare',payload)
  await h.command('product.approve',{sku:'MUG-BLUE',revision:prepared.revision})
  const shop=await h.api('/api/stall/catalogue',undefined,{as:''})
  assert.deepEqual(shop.items[0].personalization,fields)
  const artwork=(name='logo.png',bytes=png(500),type='image/png',opts)=>sendFile(h,`/api/stall/personalization/upload?sku=MUG-BLUE&field=artwork&name=${encodeURIComponent(name)}`,bytes,type,{as:'',...opts})
  for(const [name,bytes,type,opts,status] of [['a.txt',Buffer.from('plain'),'text/plain',{},415],['a.pdf',png(),'application/pdf',{},415],['a.jpg',Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3]),'image/jpeg',{},415],['big.png',png(2001),'image/png',{},413],['logo.png',png(),'image/png',{origin:'https://elsewhere.test'},403],['empty.png',Buffer.alloc(0),'image/png',{},400]])
   assert.equal((await artwork(name,bytes,type,opts)).status,status,name)
  assert.equal((await sendFile(h,'/api/stall/personalization/upload?sku=MUG-BLUE&field=engraving',png(),'image/png',{as:''})).status,404)
  assert.equal((await sendFile(h,'/api/stall/personalization/upload?sku=TOWEL-NAT&field=artwork',png(),'image/png',{as:''})).status,404)
  const upload=await (await artwork()).json(),other=await (await artwork('proof.pdf',pdf(),'application/pdf')).json()
  assert.equal(upload.name,'logo.png')
  const answers={engraving:'Happy 40th, Sam',artwork:upload.fileId,glaze:'Matte'}
  const check=(personalization,opts={})=>h.api('/api/stall/catalogue/validate',{sku:'MUG-BLUE',quantity:2,personalization},{as:'',...opts})
  for(const bad of [{...answers,engraving:'x'.repeat(21)},{...answers,engraving:'line\nbreak'},{...answers,stamp:'new'},{...answers,glaze:'Neon'},{engraving:'Only text'},{...answers,artwork:randomUUID()},{...answers,engraving:7}])
   assert.equal((await check(bad,{status:400})).error.code,'PERSONALIZATION')
  await check(answers,{status:403,headers:{origin:'https://elsewhere.test'}})
  const priced=await check(answers)
  assert.deepEqual([priced.unitCents,priced.addOnCents,priced.lineTotalCents],[2950,500,5900])
  assert.deepEqual(priced.personalization.map(a=>[a.label,a.value,a.addOnCents]),[['Engraving','Happy 40th, Sam',500],['Artwork','logo.png',0],['Glaze','Matte',0]])
  const buy=(personalization,email)=>h.api('/api/stall/checkout',{customerEmail:email,lines:[{sku:'MUG-BLUE',quantity:2,personalization}],idempotencyKey:randomUUID()},{as:''})
  const shipCents=(await h.api('/api/stall/state')).shippingCents,total=2*2950+shipCents
  assert.equal((await h.api('/api/stall/checkout',{customerEmail:'sam@example.test',lines:[{sku:'MUG-BLUE',quantity:2,personalization:answers}],expectedTotalCents:2*2450+shipCents,idempotencyKey:randomUUID()},{as:'',status:409})).error.code,'PRICE_CHANGED')
  const bought=await h.api('/api/stall/checkout',{customerEmail:'sam@example.test',lines:[{sku:'MUG-BLUE',quantity:2,personalization:answers}],expectedTotalCents:total,idempotencyKey:randomUUID()},{as:''})
  const session=[...edge.sessions.values()].find(value=>value.client_reference_id===bought.orderId)
  assert.equal(session.amount_total,total)
  assert.equal((await h.api('/api/stall/checkout',{customerEmail:'sam@example.test',lines:[{sku:'MUG-BLUE',quantity:1,personalization:answers}],idempotencyKey:randomUUID()},{as:'',status:400})).error.code,'PERSONALIZATION','a claimed file cannot be reused')
  assert.equal((await deliverWebhook(h,secret,edge.pay(session.id))).response.status,200)
  let placed=(await state(h)).orders.find(value=>value.id===bought.orderId)
  assert.deepEqual([placed.status,placed.totalCents,placed.lines[0].unitCents,placed.lines[0].addOnCents,placed.confirmation.status],['reserved',total,2950,500,'sent'])
  assert.deepEqual(placed.lines[0].personalization.map(a=>[a.key,a.value,a.addOnCents]),[['engraving','Happy 40th, Sam',500],['artwork','logo.png',0],['glaze','Matte',0]])
  const mail=h.messages.findLast(message=>JSON.stringify(message.to).includes('sam@example.test'))
  for(const part of ['2 × Glazed mug','Engraving: Happy 40th, Sam (+$5.00 each)','Artwork: logo.png','Glaze: Matte',`Total: $${(total/100).toFixed(2)}`]) assert.ok(mail.text.includes(part),part)
  assert.equal(h.messages.filter(message=>JSON.stringify(message.to).includes('sam@example.test')).length,1)
  // The staff packing slip shows every selection with its add-on price and a private link to the file.
  const slip=await h.request('/api/stall/packing-slip?orderId='+bought.orderId)
  const html=await slip.text()
  assert.equal(slip.status,200);assert.match(slip.headers.get('content-type'),/text\/html/)
  for(const part of ['Happy 40th, Sam','+$5.00 each',`/api/stall/uploads/${upload.fileId}`,'Matte','MUG-BLUE']) assert.ok(html.includes(part),part)
  assert.equal((await h.request('/api/stall/packing-slip?orderId='+bought.orderId,{as:''})).status,401)
  // A second order proves hostile engraving text stays inert in mail and on the slip.
  const hostile=await buy({engraving:'A&B <i>x</i>',glaze:'Gloss'},'maker@example.test')
  assert.equal((await deliverWebhook(h,secret,edge.pay([...edge.sessions.values()].find(value=>value.client_reference_id===hostile.orderId).id))).response.status,200)
  const hostileHtml=await (await h.request('/api/stall/packing-slip?orderId='+hostile.orderId)).text()
  assert.ok(hostileHtml.includes('A&#38;B &#60;i&#62;x&#60;/i&#62;')&&!hostileHtml.includes('<i>x'))
  // Private file: staff only, and only once an order has claimed it.
  const stored=await h.request('/api/stall/uploads/'+upload.fileId)
  assert.equal(stored.status,200);assert.match(stored.headers.get('content-disposition'),/attachment/)
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()),png(500))
  assert.equal((await h.request('/api/stall/uploads/'+upload.fileId,{as:''})).status,401)
  assert.equal((await h.request('/api/stall/uploads/'+other.fileId)).status,404)
  assert.ok(!JSON.stringify(await h.api('/api/stall/catalogue',undefined,{as:''})).includes(upload.fileId))
  // Exports and archives carry the personalization; the private file travels in the archive.
  const rows=readCsv(await (await h.request('/api/stall/exports/lines')).text()).find(row=>row.orderId===bought.orderId)
  assert.equal(JSON.parse(rows.personalization)[0].value,'Happy 40th, Sam');assert.equal(rows.addOnCents,'500')
  const records=await h.api('/api/stall/exports/records')
  assert.equal(records.orders.find(value=>value.id===bought.orderId).lines[0].personalization[1].value,'logo.png')
  assert.ok(!JSON.stringify(records).includes(upload.fileId))
  const saved=await archive(h)
  destination=await installation()
  await restore(destination,saved)
  assert.deepEqual(Buffer.from(await (await destination.request('/api/stall/uploads/'+upload.fileId)).arrayBuffer()),png(500))
  // Erasure removes the customer's file but keeps the commercial line and its price.
  let shipping=(await state(h)).orders.find(value=>value.id===bought.orderId)
  shipping=await h.command('shipment.prepare',{orderId:shipping.id,revision:shipping.revision,reference:'AU-TRACK-2001'})
  await h.command('shipment.approve',{orderId:shipping.id,revision:shipping.revision})
  await h.command('customer.erase',{email:'sam@example.test',confirm:'ERASE'})
  assert.equal((await h.request('/api/stall/uploads/'+upload.fileId)).status,404)
  placed=(await state(h)).orders.find(value=>value.id===bought.orderId)
  assert.deepEqual([placed.customerEmail,placed.lines[0].unitCents,placed.lines[0].personalization[1].value,placed.lines[0].personalization[1].fileId,placed.lines[0].personalization[0].value],[null,2950,'Erased with customer files',undefined,'Happy 40th, Sam'])
  assert.ok(!JSON.stringify(await archive(h)).includes(Buffer.from(png(500)).toString('base64')))
 } finally {await destination?.close();await h?.close();await pier.close()}
})

test('staff, customer carts, events and workflow history transfer without restoring authority and erase attributable follow-up',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-801',STRIPE_WEBHOOK_SECRET:secret}
 const h=await installation({bindings,outboundService:edge.handle});let destination
 try {
  const address='synthetic-stall-802@example.test',customer=await h.signIn(address),staff=await h.signIn('synthetic-stall-803@example.test')
  const staffId=(await h.api('/auth/session',undefined,{as:staff})).operator.id,owner=(await h.api('/auth/session')).operator.id
  await h.command('staff.configure',{actorId:staffId,staffRole:'customer_support'})
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  await h.command('shipping.configure',{shippingCents:450})
  const promotion=await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-807',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),minimumBasketCents:2000,maxUsesPerCustomer:1,maxTotalUses:2,maxShippingDiscountCents:900})
  const origin='https://shop.synthetic-stall-804.com',base='/api/stall/v1',app=await h.api(base+'/admin/apps',{label:'Storefront',origin,scopes:['cart:write','checkout:write','orders:read']})
  const headers={authorization:`Bearer ${app.token}`,origin},cart=await h.api(base+'/carts',{lines:[{sku:'MUG-BLUE',quantity:1}]},{as:customer,headers:{...headers,'idempotency-key':randomUUID()}})
  const sub=await h.api(base+'/admin/subscriptions',{appId:app.id,endpoint:'https://hooks.synthetic-stall-805.com/events',kinds:['order'],consent:'Send minimal Stall event identifiers to this endpoint'})
  const bought=await h.api(base+'/checkout',{cartId:cart.id,expectedTotalCents:2450,promotionCode:'SYNTHETIC-STALL-807'},{as:customer,headers:{...headers,'idempotency-key':randomUUID()}})
  await deliverWebhook(h,secret,edge.pay([...edge.sessions.keys()][0]))
  const workflow=async(type,payload)=>(await h.api('/api/stall/workflows',{type,payload})).result
  const rule=await workflow('workflow.save',{rule:{name:'Order follow-up',trigger:'order',assigneeId:owner,dueMinutes:60,action:'draft_followup',conditions:{status:'reserved'}}})
  await workflow('workflow.activate',{id:rule.id,revision:rule.revision});await workflow('workflow.run',{})
  const task=(await h.api('/api/stall/workflows')).tasks.find(t=>t.ruleId===rule.id)
  let prepared=(await state(h)).orders.find(o=>o.id===bought.orderId)
  await workflow('workflow.task.prepare-shipment',{id:task.id,revision:prepared.revision,reference:'synthetic-stall-806'})
  prepared=(await state(h)).orders.find(o=>o.id===bought.orderId)
  const shipped=await h.command('shipment.approve',{orderId:prepared.id,revision:prepared.revision})
  await h.api('/api/stall/customer-requests',{orderId:bought.orderId,kind:'return'},{as:customer})
  const request=(await h.api('/api/stall/returns')).requests[0]
  const receipt=await h.api('/api/stall/returns',{requestId:request.id,orderRevision:shipped.revision,lines:[{sku:'MUG-BLUE',quantity:1}]})
  const commercial=await h.api('/api/stall/exports/records')
  assert.equal(commercial.headless.customers[0].email,address);assert.equal(commercial.headless.carts[0].id,cart.id)
  assert.ok(commercial.headless.events.length);assert.ok(commercial.headless.deliveries.length);assert.equal(commercial.workflows.tasks.length,1)
  assert.equal(commercial.workflows.drafts.length,1);assert.equal(commercial.returns.receipts[0].id,receipt.id)
  assert.equal(commercial.promotions.rules[0].id,promotion.id);assert.equal(commercial.promotions.allocations[0].status,'used')
  assert.ok(!JSON.stringify(commercial.promotions).includes('customer_key'))
  for(const value of [app.token,sub.signingSecret,bindings.STRIPE_SECRET_KEY])assert.ok(!JSON.stringify(commercial).includes(value))
  const originalKey=(await h.db.prepare("SELECT commerce_key FROM st_headless_requests WHERE operation='checkout'").first()).commerce_key
  const saved=await archive(h),encoded=JSON.stringify(saved)
  for(const value of [app.token,sub.signingSecret,originalKey])assert.ok(!encoded.includes(value))
  destination=await installation({bindings,outboundService:edge.handle});await restore(destination,saved)
  const restored=await destination.api('/api/stall/exports/records')
  assert.deepEqual(restored.headless,commercial.headless);assert.deepEqual(restored.workflows,commercial.workflows);assert.deepEqual(restored.returns,commercial.returns);assert.deepEqual(restored.promotions,commercial.promotions)
  assert.equal((await destination.db.prepare('SELECT COUNT(*) AS n FROM st_promotion_authority').first()).n,0)
  assert.equal((await destination.db.prepare('SELECT customer_key FROM st_promotion_allocations WHERE order_id=?').bind(bought.orderId).first()).customer_key,'restored:'+bought.orderId)
  const local=await destination.api('/api/stall/workflows');assert.equal(local.rules[0].localAuthority,false)
  await destination.api('/api/stall/workflows',{type:'workflow.run',payload:{}})
  assert.equal((await destination.api('/api/stall/workflows')).notifications.length,local.notifications.length)
  await destination.api(base+'/orders',undefined,{as:'',headers,status:401})
  assert.equal((await destination.api('/api/stall/staff')).staff.filter(p=>p.staffRole).length,0)
  await destination.command('customer.erase',{email:address,confirm:'ERASE'})
  const erased=await destination.api('/api/stall/exports/records')
  assert.deepEqual(erased.headless.customers,[]);assert.deepEqual(erased.headless.carts,[]);assert.deepEqual(erased.workflows.requests,[])
  assert.ok(erased.workflows.tasks.every(t=>t.status==='paused'&&t.error_code==='CUSTOMER_ERASED'))
  assert.deepEqual(erased.workflows.notifications,[])
  assert.ok(!JSON.stringify(await archive(destination)).includes(address))
 } finally {await destination?.close();await h.close();await pier.close()}
})

test('customer directory resolves duplicates without granting account access and derives live net-value segments',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1001',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  const firstEmail='synthetic-stall-1002@example.test',otherEmail='synthetic-stall-1003@example.test'
  const rows=[{email:firstEmail,name:'Sam',tags:['vip']},{email:otherEmail,name:'Sam',tags:['repeat']},{email:firstEmail.toUpperCase(),name:'Different spelling',tags:['ignored']}]
  const operators=(await h.api('/auth/operators')).length
  const preview=await h.api('/api/stall/customers/import/preview',{rows})
  assert.deepEqual([preview.newCount,preview.duplicateCount],[2,1])
  let dir=await h.api('/api/stall/customers/import/apply',{rows,fingerprint:preview.fingerprint})
  assert.equal(dir.imported,2);assert.equal(dir.customers.length,2)
  assert.equal((await h.api('/auth/operators')).length,operators,'commercial import creates no login authority')
  await h.api('/api/stall/customers/import/apply',{rows:[...rows,{email:'synthetic-stall-1004@example.test'}],fingerprint:preview.fingerprint},{status:409})
  const repeat=await h.api('/api/stall/customers/import/preview',{rows})
  assert.equal(repeat.newCount,0)
  dir=await h.api('/api/stall/customers/import/apply',{rows,fingerprint:repeat.fingerprint});assert.equal(dir.customers.length,2)
  const alice=await h.signIn(firstEmail),bob=await h.signIn(otherEmail),support=await h.signIn('synthetic-stall-1005@example.test'),marketing=await h.signIn('synthetic-stall-1006@example.test')
  for(const [cookie,staffRole] of [[support,'customer_support'],[marketing,'marketing']])await h.command('staff.configure',{actorId:(await h.api('/auth/session',undefined,{as:cookie})).operator.id,staffRole})
  for(const opts of [{as:'',status:401},{as:alice,status:403},{as:marketing,status:403}])await h.api('/api/stall/customers',undefined,opts)
  await h.api('/api/stall/customers',undefined,{as:support})
  await h.api('/api/stall/customers/import/preview',{rows},{as:support,status:403})
  const grant=await h.api('/api/stall/agent-token',{})
  await h.api('/api/stall/customers',undefined,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  const bought=[]
  for(const [address,quantity] of [[firstEmail,1],[otherEmail,2]]) {
   const order=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[quantity],email:address});await deliverWebhook(h,secret,edge.pay(order.session.id));bought.push(order)
  }
  dir=await h.api('/api/stall/customers')
  let first=dir.customers.find(c=>c.emails.includes(firstEmail)),other=dir.customers.find(c=>c.emails.includes(otherEmail))
  assert.deepEqual([first.orderCount,first.lifetimeValueCents,other.orderCount,other.lifetimeValueCents],[1,2450,1,4900])
  const old=first.revision
  dir=await h.api('/api/stall/customers',{type:'note.add',id:first.id,revision:first.revision,text:'synthetic-stall-1007 <script>plain text</script>'},{as:support})
  first=dir.customers.find(c=>c.id===first.id)
  assert.equal(first.notes[0].by,(await h.api('/auth/session',undefined,{as:support})).operator.id)
  await h.api('/api/stall/customers',{type:'profile.save',id:first.id,revision:old,name:'Stale',tags:[]},{status:409})
  await h.api('/api/stall/customers',{type:'merge',id:other.id,revision:other.revision,targetId:first.id,targetRevision:first.revision},{as:support,status:403})
  dir=await h.api('/api/stall/customers',{type:'merge',id:other.id,revision:other.revision,targetId:first.id,targetRevision:first.revision})
  assert.equal(dir.customers.length,1);first=dir.customers[0]
  assert.deepEqual([first.orderCount,first.paidCents,first.refundedCents,first.lifetimeValueCents],[2,7350,0,7350])
  assert.deepEqual(new Set(first.tags),new Set(['vip','repeat']))
  assert.deepEqual((await h.api('/api/stall/account',undefined,{as:alice})).orders.map(o=>o.id),[bought[0].orderId])
  await h.api('/api/stall/account/orders/'+bought[1].orderId,undefined,{as:alice,status:404})
  await h.api('/api/stall/account/orders/'+bought[0].orderId,undefined,{as:bob,status:404})
  dir=await h.api('/api/stall/customers',{type:'segment.save',segment:{name:'Repeat Texas VIP',tag:'vip',minimumSpentCents:8000,minimumOrders:3,state:'TX'}})
  const segment=dir.segments[0];assert.deepEqual(segment.members,[])
  const third=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],email:firstEmail});await deliverWebhook(h,secret,edge.pay(third.session.id))
  dir=await h.api('/api/stall/customers');assert.deepEqual(dir.segments[0].members,[first.id]);assert.equal(dir.customers[0].lifetimeValueCents,9800)
  let order=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought[0].orderId)
  order=await h.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'synthetic-stall-1008'})
  order=await h.command('shipment.approve',{orderId:order.id,revision:order.revision})
  order=await h.command('refund.prepare',{orderId:order.id,revision:order.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'synthetic-stall-1009'})
  order=await h.command('refund.approve',{orderId:order.id,revision:order.revision})
  dir=await h.api('/api/stall/customers')
  assert.deepEqual([dir.customers[0].orderCount,dir.customers[0].refundedCents,dir.customers[0].lifetimeValueCents],[3,2450,7350])
  assert.deepEqual(dir.segments[0].members,[],'successful refunds immediately recalculate dynamic segment membership')
  await h.command('staff.configure',{actorId:(await h.api('/auth/session',undefined,{as:support})).operator.id,staffRole:'catalog'})
  await h.api('/api/stall/customers',undefined,{as:support,status:403})
 } finally {await h.close();await pier.close()}
})

test('native customer account recovers verified access, isolates addresses and preserves directory erasure through transfer',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1010',STRIPE_WEBHOOK_SECRET:secret}
 const h=await installation({bindings,outboundService:edge.handle});let destination
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  const email='synthetic-stall-1011@example.test',otherEmail='synthetic-stall-1012@example.test'
  const rows=[{email,name:'synthetic-stall-1013',tags:['customer']},{email:otherEmail,name:'synthetic-stall-1013'}]
  const preview=await h.api('/api/stall/customers/import/preview',{rows});await h.api('/api/stall/customers/import/apply',{rows,fingerprint:preview.fingerprint})
  const bought=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],email});await deliverWebhook(h,secret,edge.pay(bought.session.id))
  await h.api('/api/stall/account',undefined,{as:'',status:401})
  const alice=await h.signIn(email),bob=await h.signIn(otherEmail)
  let mine=await h.api('/api/stall/account',undefined,{as:alice})
  assert.deepEqual(mine.orders.map(o=>o.id),[bought.orderId]);assert.deepEqual((await h.api('/api/stall/account',undefined,{as:bob})).orders,[])
  const us={name:'synthetic-stall-1014',line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
  mine=await h.api('/api/stall/account/addresses',{address:us},{as:alice});const saved=mine.addresses[0]
  assert.deepEqual((await h.api('/api/stall/account',undefined,{as:bob})).addresses,[])
  for(const method of ['POST','DELETE'])await h.api('/api/stall/account/addresses',{id:saved.id,revision:saved.revision,...(method==='POST'?{address:us}:{})},{as:bob,method,status:404})
  await h.api('/api/stall/account/addresses',{address:us,email:otherEmail},{as:alice,status:400})
  await h.api('/api/stall/account/addresses',{address:us},{as:alice,headers:{origin:'https://synthetic-stall-1015.test'},status:403})
  const ca={...us,line1:'2 Maker Lane',city:'Vancouver',state:'BC',postal_code:'V6B 1A1',country:'CA'}
  mine=await h.api('/api/stall/account/addresses',{id:saved.id,revision:saved.revision,address:ca},{as:alice})
  assert.equal(mine.addresses[0].address.country,'CA')
  await h.api('/api/stall/account/addresses',{id:saved.id,revision:saved.revision,address:us},{as:alice,status:404})
  await h.api('/auth/magic-link',{email,returnTo:'/order'},{as:'',status:202})
  const message=h.messages.findLast(m=>JSON.stringify(m.to).includes(email)),link=new URL(message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0])
  const confirm=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:link.searchParams.get('token')}});assert.equal(confirm.status,303)
  const recovered=confirm.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.deepEqual((await h.api('/api/stall/account',undefined,{as:recovered})).addresses,mine.addresses)
  assert.equal((await h.request('/auth/confirm',{method:'POST',as:'',body:{token:link.searchParams.get('token')}})).status,400,'access recovery proof is one-use')
  let order=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId)
  order=await h.command('order.note.add',{orderId:order.id,revision:order.revision,text:'synthetic-stall-1016 internal note'})
  const own=await h.api('/api/stall/account/orders/'+order.id,undefined,{as:alice})
  assert.ok(!JSON.stringify(own).includes('internal note'));assert.ok(!JSON.stringify(own).includes('requestDigest'));assert.equal(own.order.shippingDetails.address.state,'TX')
  await h.api('/api/stall/customer-requests',{orderId:order.id,kind:'return'},{as:alice})
  assert.equal((await h.api('/api/stall/account',undefined,{as:alice})).requests[0].kind,'return')
  order=await h.command('shipment.prepare',{orderId:order.id,revision:order.revision,reference:'synthetic-stall-1017'});await h.command('shipment.approve',{orderId:order.id,revision:order.revision})
  const original=await archive(h),business=await h.api('/api/stall/exports/records')
  assert.equal(business.customerDirectory.addresses[0].value.country,'CA');assert.equal(business.customerDirectory.profiles.length,2)
  destination=await installation({bindings,outboundService:edge.handle});await restore(destination,original)
  assert.deepEqual((await destination.api('/api/stall/exports/records')).customerDirectory,business.customerDirectory)
  await destination.api('/api/stall/account',undefined,{as:alice,status:401})
  await destination.command('customer.erase',{email,confirm:'ERASE'})
  const erased=await destination.api('/api/stall/exports/records')
  assert.equal(erased.customerDirectory.addresses.length,0);assert.ok(!JSON.stringify(erased.customerDirectory).includes(email));assert.ok(!JSON.stringify(erased.customerDirectory).includes('synthetic-stall-1014'))
  assert.ok(!JSON.stringify(await archive(destination)).includes(email))
 } finally {await destination?.close();await h.close();await pier.close()}
})

test('customer consent is explicit at every HTTP capture door and privacy refusal, GPC and erasure survive restore',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1020',STRIPE_WEBHOOK_SECRET:secret}
 const h=await installation({bindings,outboundService:edge.handle});let restored,oldTarget
 try {
  const email='synthetic-stall-1021@example.test',otherEmail='synthetic-stall-1022@example.test',alice=await h.signIn(email),bob=await h.signIn(otherEmail)
  await h.api('/api/stall/customers/consent/import',{rows:[{email,channel:'email',status:'unknown'},{email,channel:'sms',status:'unsubscribed'}]})
  assert.deepEqual([(await h.api('/api/stall/account/consent',undefined,{as:alice})).emailMarketing,(await h.api('/api/stall/account/consent',undefined,{as:alice})).smsMarketing],[false,false])
  await h.api('/api/stall/customers/consent/import',{rows:[{email:otherEmail,channel:'email',status:'subscribed'}]},{status:400})
  await h.api('/api/stall/customers/consent/import',{rows:[{email:otherEmail,channel:'email',status:'subscribed',proof:{source:'synthetic-stall-1023',at:new Date(Date.now()-86400000).toISOString(),reference:'synthetic-stall-1024'}}]})
  assert.equal((await h.api('/api/stall/account/consent',undefined,{as:bob})).emailMarketing,true)
  for(const source of ['account','checkout','newsletter','contact','popup']) {
   const path='/api/stall/'+source+'/consent'
   await h.api(path,{emailMarketing:true,smsMarketing:false},{as:alice})
   let value=await h.api('/api/stall/account/consent',undefined,{as:alice})
   assert.equal(value.history.find(r=>r.channel==='email').source,source)
   assert.equal(value.emailMarketing,true);assert.equal(value.smsMarketing,false);assert.equal(value.necessaryOrderNotices,'separate')
   assert.ok(value.history.every(r=>r.createdAt&&r.policyVersion))
   value=await h.api(path,{emailMarketing:false,smsMarketing:false},{as:alice})
   assert.equal(value.emailMarketing,false);assert.ok(value.history.some(r=>r.channel==='email'&&r.subscribed),'withdrawal retains the prior affirmative history')
   await h.api(path,{emailMarketing:true},{as:alice,status:400})
   await h.api(path,{emailMarketing:true,smsMarketing:true,email:otherEmail},{as:alice,status:400})
   await h.api(path,{emailMarketing:true,smsMarketing:true},{as:'',status:401})
  }
  assert.equal((await h.api('/api/stall/account/consent',undefined,{as:bob})).emailMarketing,true,'another mailbox choice is unchanged')
  let response=await h.request('/api/stall/privacy',{as:''}),privacy=await response.json()
  let visitor=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.deepEqual([privacy.mode,privacy.analyticsAllowed,privacy.advertisingAllowed],['notice_opt_out',false,false])
  const before=edge.calls.length
  privacy=await h.api('/api/stall/privacy',{policyVersion:privacy.policyVersion,analytics:false,advertising:false,doNotSellOrShare:true,region:'US'},{as:visitor})
  assert.deepEqual([privacy.googleConsentMode.analytics_storage,privacy.googleConsentMode.ad_storage],['denied','denied'])
  assert.deepEqual(privacy.installedPixels,[]);assert.deepEqual(privacy.serverConversionProviders,[])
  privacy=await h.api('/api/stall/privacy',{policyVersion:privacy.policyVersion,analytics:true,advertising:true,doNotSellOrShare:false,region:'US'},{as:visitor})
  assert.equal(privacy.advertisingAllowed,true);assert.equal(privacy.analyticsAllowed,true)
  privacy=await h.api('/api/stall/privacy',undefined,{as:visitor,headers:{'sec-gpc':'1'}})
  assert.equal(privacy.advertisingAllowed,false);assert.equal(privacy.doNotSellOrShare,true)
  assert.equal((await h.api('/api/stall/privacy',undefined,{as:visitor})).advertisingAllowed,false,'GPC persists the refusal for later requests')
  assert.equal(edge.calls.length,before,'privacy changes trigger no external provider or historical event replay')
  const cfg=await h.api('/api/stall/privacy/config')
  await h.api('/api/stall/privacy/config',{revision:cfg.revision,mode:'notice_opt_out',optInRegions:['CA']},{as:alice,status:403})
  const next=await h.api('/api/stall/privacy/config',{revision:cfg.revision,mode:'notice_opt_out',optInRegions:['CA']})
  await h.api('/api/stall/privacy',{policyVersion:cfg.policyVersion,analytics:true,advertising:true,doNotSellOrShare:false},{as:visitor,status:400})
  privacy=await h.api('/api/stall/privacy',{policyVersion:next.policyVersion,analytics:false,advertising:false,doNotSellOrShare:false,region:'CA'},{as:visitor});assert.equal(privacy.mode,'opt_in')
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  const bought=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],email});await deliverWebhook(h,secret,edge.pay(bought.session.id))
  const original=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId),providerWrites=edge.calls.length
  const request=await h.api('/api/stall/account/privacy-requests',{kind:'erasure'},{as:alice})
  assert.deepEqual(request.retainedFinancialOrderIds,[bought.orderId]);assert.equal(request.status,'requested')
  assert.ok(request.providerFollowUp.length);assert.deepEqual((await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId),original)
  assert.equal(edge.calls.length,providerWrites,'a request sends no provider or deletion effect')
  await h.api('/api/stall/account/privacy-requests',{kind:'erasure',email:otherEmail},{as:alice,status:400})
  assert.deepEqual((await h.api('/api/stall/account/privacy-requests',undefined,{as:bob})).requests,[])
  await h.api('/api/stall/customers/privacy-requests',undefined,{as:alice,status:403})
  const own=await h.api('/api/stall/account/export',undefined,{as:alice});assert.equal(own.account.orders[0].id,bought.orderId);assert.ok(!JSON.stringify(own).includes(otherEmail))
  await h.api('/api/stall/privacy',{policyVersion:next.policyVersion,analytics:true,advertising:true,doNotSellOrShare:false,region:'US'},{as:visitor})
  const older=await archive(h)
  let order=await h.command('shipment.prepare',{orderId:original.id,revision:original.revision,reference:'synthetic-stall-1025'});await h.command('shipment.approve',{orderId:order.id,revision:order.revision})
  await h.command('customer.erase',{email,confirm:'ERASE'})
  const erased=await archive(h)
  assert.ok(!JSON.stringify(erased).includes(email))
  restored=await installation({bindings,outboundService:edge.handle});await restore(restored,erased)
  assert.equal((await restored.api('/api/stall/privacy',undefined,{as:visitor})).advertisingAllowed,false,'restored anonymous preferences carry history without granting pixel authority')
  const reverified=await restored.signIn(email)
  assert.equal((await restored.api('/api/stall/account/consent',undefined,{as:reverified})).emailMarketing,false)
  await restored.api('/api/stall/customers/consent/import',{rows:[{email,channel:'email',status:'subscribed',proof:{source:'synthetic-stall-1026',at:new Date(Date.now()-86400000).toISOString(),reference:'synthetic-stall-1027'}}]})
  assert.equal((await restored.api('/api/stall/account/consent',undefined,{as:reverified})).emailMarketing,false,'old import proof cannot lift an erased customer suppression')
  assert.equal((await restored.api('/api/stall/customers/privacy-requests')).requests.find(r=>r.id===request.id).status,'erased')
  oldTarget=await installation({bindings,outboundService:edge.handle})
  await restore(oldTarget,older,{status:400,laterJournal:{sourceIdentity:erased[0].sourceIdentity,epoch:erased[0].epoch,journal:erased[0].journal}})
 } finally {await oldTarget?.close();await restored?.close();await h.close();await pier.close()}
})
