import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { installation } from '../api/harness.mjs'
import { pierInstallation } from '../api/pier.mjs'
import { deliverWebhook,publish,purchase } from '../api/network.mjs'
import { startJourney } from './journey-kit.mjs'

const sku='synthetic-stall-2301',email='synthetic-stall-2302@example.test'
const destination={name:'Taylor Morgan',street1:'417 Montgomery Street',city:'San Francisco',state:'CA',zip:'94104',country:'US'}

async function carrierStock() {
 // The existing helper prepares the exact pinned source and Worker entry.
 const prepared=await pierInstallation();await prepared.close()
 const source=resolve(process.env.PIER_SOURCE??'.cache/pier-source')
 const recordings=Object.fromEntries(await Promise.all(['address','shipment','purchased','tracker'].map(async name=>[name,JSON.parse(await readFile(join(source,'tests/fixtures/shipping',name+'.json'),'utf8'))])))
 let purchased=false
 const stock=await installation({source,entry:resolve('.cache/pier-api-worker.ts'),base:'/api/pier',outboundService:async request=>{
  const url=new URL(request.url)
  if(url.origin!=='https://api.easypost.com')return new Response('Shop callbacks are not connected in this journey.',{status:503})
  assert.match(request.headers.get('authorization'),/^Basic /)
  if(url.pathname==='/v2/addresses')return Response.json(recordings.address)
  if(url.pathname==='/v2/shipments')return Response.json(recordings.shipment)
  if(url.pathname===`/v2/shipments/${recordings.shipment.id}/buy`){assert.equal(purchased,false);purchased=true;return Response.json(recordings.purchased)}
  if(url.pathname===`/v2/shipments/${recordings.shipment.id}`)return Response.json(purchased?recordings.purchased:recordings.shipment)
  if(url.pathname===`/v2/trackers/${recordings.tracker.id}`)return Response.json(recordings.tracker)
  assert.fail('Unexpected carrier request '+request.method+' '+url.pathname)
 }})
 try {
  const location=await stock.command('location.save',{name:'A1',warehouse:'Brisbane',kind:'bin'})
  const supplier=await stock.command('party.save',{name:'Clay and Cotton Supply',kind:'supplier'})
  const customer=await stock.command('party.save',{name:'Online shop',kind:'customer'})
  const item=await stock.command('item.save',{sku,name:'Blue ceramic mug',unit:'each',packSize:'1'})
  const po=await stock.command('po.draft',{supplierId:supplier.id,promiseDate:new Date().toISOString().slice(0,10),reason:'Opening stock',lines:[{itemId:item.id,quantity:'4',price:'12.00'}]})
  await stock.command('po.approve',{poId:po.id,version:po.version})
  await stock.command('po.commit',{poId:po.id,version:po.version})
  await stock.command('receipt.create',{poId:po.id,supplierReference:'synthetic-stall-2303',lines:[{poLineId:po.lines[0].id,locationId:location.id,quantity:'4',cost:'12.00'}]})
  const channel=await stock.command('channel.save',{name:'Online shop',provider:'stall',baseUrl:'https://shop.example.test',warehouse:'Brisbane',buffer:'0',credentials:{token:'synthetic-stall-2304'}})
  const current=(await stock.api('/api/pier/state')).channels.find(row=>row.id===channel.id)
  const link=await stock.command('channel.stallKey',{channelId:current.id,version:current.version,customerId:customer.id})
  await stock.command('shipping.save',{apiKey:'EZTK_synthetic-stall-2305',mode:'test',fromAddress:{...destination,name:'Pier warehouse'}})
  return Object.assign(stock,{item,location,bindings:{PIER_ORIGIN:stock.origin,PIER_SESSION:`pier_channel=${link.key}`,PIER_CUSTOMER_ID:customer.id}})
 }catch(error){await stock.close();throw error}
}

let journey,journeyError,stock,handedOff=false
try {
 stock=await carrierStock();handedOff=true
 journey=await startJourney({name:'customer-order-status',stock,skus:[sku]})
 const {h,page,context,ready,edge,secret,capture}=journey
 const member=await h.signIn(email),foreign=await h.signIn('synthetic-stall-2306@example.test')
 await publish(h,sku,'Blue ceramic mug',2450)
 const bought=await purchase(h,edge,{skus:[sku],quantities:[1],email})
 const paid=await deliverWebhook(h,secret,edge.pay(bought.session.id,{line1:destination.street1,line2:null,city:destination.city,state:destination.state,postal_code:destination.zip,country:destination.country}))
 assert.equal(paid.response.status,200)
 let order=(await h.api('/api/stall/state')).orders.find(row=>row.id===bought.orderId)
 const native=(await stock.api('/api/pier/state')).orders.find(row=>row.id===order.reservation.id)
 const carrier=await stock.command('carrier.save',{name:'Parcel pickup',warehouse:'Brisbane',dock:'Dock A',cutoff:'16:00',timeZone:'Australia/Brisbane'})
 let wave=await stock.command('wave.release',{carrierId:carrier.id,orderIds:[native.id]})
 wave=await stock.command('pick.scan',{waveId:wave.id,lineId:wave.lines[0].id,binCode:stock.location.name,itemCode:sku,quantity:'1'})
 const packing={waveId:wave.id,orderId:native.id}
 await stock.command('pack.scan',{...packing,code:sku})
 await stock.command('pack.measure',{...packing,carton:1,weight:'2.5',length:'12',width:'8',height:'4'})
 const pack=await stock.command('pack.close',packing)
 let label=await stock.command('shipping.prepare',{packId:pack.id,carton:1,address:destination,email})
 for(const [type,extra] of [['shipping.verify',{}],['shipping.address',{choice:'suggested'}],['shipping.rates',{}]])label=await stock.command(type,{jobId:label.id,version:label.version,...extra})
 const rate=label.rates.find(row=>row.carrier==='USPS');assert.ok(rate)
 label=await stock.command('shipping.buy',{jobId:label.id,version:label.version,rateId:rate.id})
 assert.equal(label.status,'labelled')
 await stock.command('pack.dispatch',{...packing,shipmentReference:'synthetic-stall-2307'})
 order=(await h.api('/api/stall/state')).orders.find(row=>row.id===bought.orderId)
 assert.equal(order.shipment.status,'shipped')
 assert.equal(order.shipment.dispatches[0].tracking[0].trackingCode,label.trackingCode)

 let as=member
 await context.route('**/api/stall/**',async route=>{
  const incoming=route.request(),url=new URL(incoming.url())
  const response=await h.request(url.pathname+url.search,{method:incoming.method(),as,...(incoming.postData()?{body:JSON.parse(incoming.postData())}:{})})
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:Buffer.from(await response.arrayBuffer())})
 })
 const card=page.getByRole('article',{name:'Order '+order.id,exact:true})
 async function showOwnOrder(){await page.goto(ready.url+'/order');await page.reload();await card.waitFor();await card.locator('summary').filter({hasText:'Delivery, refunds and requests'}).click()}
 async function inspect(labelName,{delivery='in transit',refund=false,request=false,received=false}={}) {
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await card.getByText('Shipment: shipped',{exact:true}).waitFor()
   assert.ok((await card.innerText()).includes(delivery))
   assert.ok((await card.innerText()).includes(label.trackingCode))
   assert.equal(await card.getByRole('link',{name:'Track shipment',exact:true}).getAttribute('href'),label.trackingUrl)
   if(refund)await card.getByText('$24.50 · succeeded',{exact:true}).waitFor()
   else await card.getByText('No refunds recorded.',{exact:true}).waitFor()
   if(request)await card.getByText(received?/return request received .*Goods received/:/return request received .*Awaiting staff review/).waitFor()
  }
  await capture(labelName,card)
 }
 await showOwnOrder()
 await inspect('CUSTOMER-001-current-tracking')
 const requestForm=page.getByRole('form',{name:'Request order help',exact:true})
 await requestForm.getByLabel('Order',{exact:true}).selectOption(order.id)
 await requestForm.getByLabel('Request type',{exact:true}).selectOption('return')
 const submitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stall/customer-requests'&&response.request().method()==='POST')
 await requestForm.getByRole('button',{name:'Request staff review',exact:true}).click()
 const response=await submitted;assert.ok(response.ok(),await response.text())
 const receipt=await response.json()
 await page.getByText('Request received for staff review.',{exact:true}).waitFor()
 await showOwnOrder()
 await inspect('CUSTOMER-001-return-awaiting-review',{request:true})

 // A receipt records the owner's observation; money and stock remain separate.
 const positions=(await stock.api('/api/pier/state')).positions,refundsBefore=edge.refunds.size
 order=(await h.api('/api/stall/state')).orders.find(row=>row.id===order.id)
 const received=await h.api('/api/stall/returns',{requestId:receipt.request.id,orderRevision:order.revision,lines:[{sku,quantity:1}]},{status:201})
 assert.equal(received.request_id,receipt.request.id)
 assert.deepEqual((await stock.api('/api/pier/state')).positions,positions)
 assert.equal(edge.refunds.size,refundsBefore)
 const own=await h.api('/api/stall/account',undefined,{as:member})
 assert.equal(own.requests.find(row=>row.id===receipt.request.id).goodsReceivedAt,received.created_at)
 await showOwnOrder()
 await inspect('CUSTOMER-001-return-goods-received',{request:true,received:true})

 order=await h.command('refund.prepare',{orderId:order.id,revision:order.revision,lines:[{sku,quantity:1}],reason:'Refund for the received ceramic mug'})
 order=await h.command('refund.approve',{orderId:order.id,revision:order.revision})
 assert.equal(order.refunds.at(-1).status,'succeeded')
 assert.equal(edge.refunds.size,refundsBefore+1)
 label=(await stock.api('/api/pier/state')).shippingJobs.find(row=>row.id===label.id)
 label=await stock.command('shipping.track',{jobId:label.id,version:label.version})
 assert.equal(label.status,'delivered')
 order=(await h.api('/api/stall/state')).orders.find(row=>row.id===order.id)
 assert.equal(order.shipment.dispatches[0].deliveryStatus,'delivered')
 await showOwnOrder()
 await inspect('CUSTOMER-001-current-refund-and-return',{delivery:'delivered',refund:true,request:true,received:true})

 as=foreign
 await page.reload()
 await page.getByText('No orders are recorded for this verified email.',{exact:true}).waitFor()
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.getByRole('article',{name:'Order '+order.id,exact:true}).count(),0)
  assert.equal(await page.getByRole('link',{name:'Track shipment',exact:true}).count(),0)
  const visible=await page.locator('main').innerText()
  for(const hidden of [order.id,label.trackingCode,receipt.request.id,'Goods received','$24.50 · succeeded'])assert.ok(!visible.includes(hidden))
 }
 const foreignAccount=await h.api('/api/stall/account',undefined,{as:foreign})
 assert.deepEqual(foreignAccount.orders,[]);assert.deepEqual(foreignAccount.requests,[])
 await h.api('/api/stall/account/orders/'+order.id,undefined,{as:foreign,status:404})
 await capture('CUSTOMER-001-foreign-current-order-refused')
 assert.deepEqual(journey.errors,[])
 await journey.dev.assertRunning()
 console.log('PASS CUSTOMER-001 own current tracking, refund and recorded return facts with foreign refusal at 1440 and 390')
}catch(error){
 journeyError=error
 if(journey?.page)await journey.page.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'test-results/customer-order-status','failure.png'),fullPage:true})
 throw error
}finally{if(journey)await journey.finish(journeyError);else if(!handedOff)await stock?.close()}
