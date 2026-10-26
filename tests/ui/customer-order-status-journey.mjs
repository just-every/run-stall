import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { volumeStock } from '../api/volume-stock.mjs'
import { deliverWebhook,publish,purchase } from '../api/network.mjs'
import { startJourney } from './journey-kit.mjs'

const sku='synthetic-stall-2301',email='synthetic-stall-2302@example.test'
const destination={name:'Taylor Morgan',street1:'417 Montgomery Street',city:'San Francisco',state:'CA',zip:'94104',country:'US'}

// Paid stock-provider observations stay at the network edge; Stall's migrated
// Worker, own-account projection and browser remain the real application.
let journey,journeyError
try {
 const stock=volumeStock([sku]),forward=stock.forward,dispatches=[]
 stock.forward=async request=>{
  const response=await forward(request)
  if(request.method==='GET'&&new URL(request.url).pathname==='/api/pier/state')return Response.json({...await response.json(),shipments:dispatches})
  return response
 }
 journey=await startJourney({name:'customer-order-status',stock,skus:[sku]})
 const {h,page,context,ready,edge,secret,capture}=journey
 const member=await h.signIn(email),foreign=await h.signIn('synthetic-stall-2306@example.test')
 await publish(h,sku,'Blue ceramic mug',2450)
 const bought=await purchase(h,edge,{skus:[sku],quantities:[1],email})
 const paid=await deliverWebhook(h,secret,edge.pay(bought.session.id,{line1:destination.street1,line2:null,city:destination.city,state:destination.state,postal_code:destination.zip,country:destination.country}))
 assert.equal(paid.response.status,200)
 let order=(await h.api('/api/stall/state')).orders.find(row=>row.id===bought.orderId)
 const native=stock.orders.get(order.reservation.id)
 const label={trackingCode:'synthetic-stall-2307',trackingUrl:'https://carrier.example.test/track/synthetic-stall-2307'}
 dispatches.push({id:'synthetic-stall-2308',orderId:native.id,reference:'synthetic-stall-2309',createdAt:new Date(Date.now()-86400000).toISOString(),deliveryStatus:'in transit',tracking:[{carton:1,...label}],lines:native.lines.map(line=>({orderLineId:line.id,itemId:line.itemId,quantity:line.quantity}))})
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
   if(request)await card.getByText(received?/Goods received/:/return request · awaiting a person’s review/).first().waitFor()
  }
  await capture(labelName,card)
 }
 await showOwnOrder()
 await inspect('CUSTOMER-001-current-tracking')
 // The shipment is a day old, well inside the window.
 await h.command('return.policy.save',{revision:null,windowDays:30,condition:'Unused and in its packaging',feeCents:0,returnShipping:'The customer pays return postage',finalSaleSkus:[],exchanges:false})
 await card.getByText('Returns, exchanges and cancellation',{exact:true}).click()
 const requestForm=card.getByRole('form',{name:'Request help with this order',exact:true})
 await requestForm.getByRole('checkbox',{name:/Blue ceramic mug/}).check()
 await requestForm.getByLabel('Reason',{exact:true}).selectOption('defective')
 const submitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stall/returns/requests'&&response.request().method()==='POST')
 await requestForm.getByRole('button',{name:'Send request for review',exact:true}).click()
 const response=await submitted;assert.ok(response.ok(),await response.text())
 const receipt=await response.json()
 await card.getByText('Request received.',{exact:false}).first().waitFor()
 await showOwnOrder()
 await inspect('CUSTOMER-001-return-awaiting-review',{request:true})

 // A receipt records the owner's observation; money and stock remain separate.
 const positions=structuredClone([...stock.orders.values()]),refundsBefore=edge.refunds.size
 order=(await h.api('/api/stall/state')).orders.find(row=>row.id===order.id)
 const received=await h.api('/api/stall/returns',{requestId:receipt.case.id,orderRevision:order.revision,lines:[{sku,quantity:1}]},{status:201})
 assert.equal(received.request_id,receipt.case.id)
 assert.deepEqual([...stock.orders.values()],positions)
 assert.equal(edge.refunds.size,refundsBefore)
 const own=await h.api('/api/stall/account',undefined,{as:member})
 assert.equal(own.requests.find(row=>row.id===receipt.case.id).goodsReceivedAt,received.created_at)
 await showOwnOrder()
 await inspect('CUSTOMER-001-return-goods-received',{request:true,received:true})

 order=await h.command('refund.prepare',{orderId:order.id,revision:order.revision,lines:[{sku,quantity:1}],reason:'Refund for the received ceramic mug'})
 order=await h.command('refund.approve',{orderId:order.id,revision:order.revision})
 assert.equal(order.refunds.at(-1).status,'succeeded')
 assert.equal(edge.refunds.size,refundsBefore+1)
 dispatches[0].deliveryStatus='delivered'
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
  for(const hidden of [order.id,label.trackingCode,receipt.case.id,'Goods received','$24.50 · succeeded'])assert.ok(!visible.includes(hidden))
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
 if(journey?.page)await journey.page.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'./test-results/customer-order-status','failure.png'),fullPage:true})
 throw error
}finally{if(journey)await journey.finish(journeyError)}
