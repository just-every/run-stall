import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { startJourney } from './journey-kit.mjs'

let journey,journeyError
try {
 journey=await startJourney({name:'customer-history',skus:[]})
 const {h,page,context,ready}=journey
 let as=h.cookie
 // Keep the built page and native sessions. Only transport its requests to
 // the migrated commerce Worker, as the other customer journeys do.
 await context.route('**/api/stall/**',async route=>{
  const incoming=route.request(),url=new URL(incoming.url())
  const response=await h.request(url.pathname+url.search,{method:incoming.method(),as,...(incoming.postData()?{body:JSON.parse(incoming.postData())}:{})})
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:Buffer.from(await response.arrayBuffer())})
 })
 const base='/api/stall/customers/history',account='/api/stall/account'
 const screenshot=async(label,target,width)=>{
  await target.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} overflow at ${width}`)
  await target.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'./test-results/customer-history',`${label}-${width}.png`)})
 }
 for(const [index,width] of [1440,390].entries()) {
  const fixture=2610+index*10,email=`synthetic-stall-${fixture}@example.test`,foreign=`synthetic-stall-${fixture+1}@example.test`,recordId=`synthetic-stall-${fixture+2}`,trackingCode=`synthetic-stall-${fixture+3}`
  const source=`Historical shop ${index+1}`,trackingUrl=`https://carrier.example.test/track/${trackingCode}`
  const rows=[{recordId,email:`  ${email.toUpperCase()}  `,createdAt:'2021-06-01T12:00:00+10:00',status:'partially_refunded',paid:true,lines:[{sku:'MUG-BLUE',name:'Original blue ceramic mug',quantity:2,unitCents:1000}],shippingCents:500,taxCents:300,totalCents:2800,refunds:[{recordId:`synthetic-stall-${fixture+4}`,status:'succeeded',amountCents:500}],tracking:{shippedAt:'2021-06-02T12:00:00+10:00',deliveryStatus:'delivered',trackingCode,trackingUrl}}]
  as=h.cookie
  await page.setViewportSize({width,height:1000})
  await page.goto(ready.url+'/app#customers')
  await page.reload()
  await page.getByRole('heading',{name:'Customers',level:1,exact:true}).waitFor()
  await page.locator('summary').filter({hasText:/^Import historical orders$/}).click()
  const form=page.getByRole('form',{name:'Import historical orders',exact:true})
  await form.getByLabel('Historical source system',{exact:true}).fill(source)
  await form.getByLabel('Historical order rows · JSON',{exact:true}).fill(JSON.stringify(rows))
  await screenshot('CUSTOMER-001-history-import-form',form,width)
  const messages=h.messages.length,liveOrders=(await h.api('/api/stall/state')).orders.length,providerCalls=journey.edge.calls.length
  await form.getByRole('button',{name:'Preview historical orders',exact:true}).click()
  const review=page.getByRole('region',{name:'Historical order import preview',exact:true})
  await review.getByText('1 new · 0 exact duplicates skipped',{exact:true}).waitFor()
  assert.ok((await review.innerText()).includes(email))
  assert.ok(!(await review.innerText()).includes(email.toUpperCase()))
  assert.match(await review.innerText(),/Recorded as paid/)
  const amount=label=>review.locator('dt').filter({hasText:new RegExp('^'+label+'$')}).locator('..')
  await amount('Original total').getByText('$28.00',{exact:true}).waitFor()
  await amount('Succeeded refunds').getByText('$5.00',{exact:true}).waitFor()
  await review.getByText(`Tracking: ${trackingCode}`,{exact:false}).waitFor()
  assert.equal(await review.getByRole('link',{name:'Track historical shipment',exact:true}).getAttribute('href'),trackingUrl)
  const approve=review.getByRole('button',{name:'Import 1 reviewed historical orders',exact:true})
  assert.ok(await approve.isDisabled())
  assert.equal((await h.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first()),null)
  await h.api(account,undefined,{as:'',status:401})
  await review.getByRole('checkbox').check()
  // Changing source after approval must discard the checked preview.
  await form.getByLabel('Historical source system',{exact:true}).fill(source+' corrected')
  await review.waitFor({state:'detached'})
  assert.equal(h.messages.length,messages)
  await form.getByRole('button',{name:'Preview historical orders',exact:true}).click()
  await review.getByText('1 new · 0 exact duplicates skipped',{exact:true}).waitFor()
  assert.equal(await review.getByRole('checkbox').isChecked(),false)
  assert.ok(await approve.isDisabled())
  await review.getByRole('checkbox').check()
  await screenshot('CUSTOMER-001-history-reviewed-import',review,width)
  const applied=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/apply'&&response.request().method()==='POST')
  await approve.click()
  const result=await applied
  assert.ok(result.ok(),await result.text())
  await page.getByRole('status').filter({hasText:'1 historical orders imported.'}).waitFor()
  assert.equal(h.messages.length,messages,'historical imports never send mail')
  assert.equal(journey.edge.calls.length,providerCalls,'historical imports never contact the payment provider')
  assert.equal((await h.api('/api/stall/state')).orders.length,liveOrders,'history never becomes an executable live order')
  assert.equal((await h.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first()),null,'import creates no native account')
  await form.getByRole('button',{name:'Preview historical orders',exact:true}).click()
  await review.getByText('0 new · 1 exact duplicates skipped',{exact:true}).waitFor()
  assert.ok(await review.getByRole('button',{name:'Import 0 reviewed historical orders',exact:true}).isDisabled())

  const alice=await h.signIn(email),bob=await h.signIn(foreign)
  const session=await h.api('/auth/session',undefined,{as:alice})
  assert.equal(session.kind,'native')
  assert.equal(session.operator.email,email)
  const mine=await h.api(account,undefined,{as:alice})
  assert.equal(mine.orders.length,1)
  const imported=mine.orders[0]
  assert.equal(imported.imported,true)
  as=alice
  await page.goto(ready.url+'/order')
  const order=page.getByRole('article',{name:`Order ${imported.id}`,exact:true})
  await order.getByRole('heading',{name:'Imported order '+recordId,exact:true}).waitFor()
  await order.getByText('Original blue ceramic mug × 2',{exact:true}).waitFor()
  await order.getByText('$28.00',{exact:true}).waitFor()
  await order.locator('summary').filter({hasText:'Delivery, refunds and requests'}).click()
  await order.getByText('Tracking: '+trackingCode,{exact:false}).waitFor()
  assert.equal(await order.getByRole('link',{name:'Track shipment',exact:true}).getAttribute('href'),trackingUrl)
  await order.getByText('$5.00 · succeeded',{exact:true}).waitFor()
  assert.equal(await order.getByRole('button',{name:/Create guest order link/}).count(),0)
  await screenshot('CUSTOMER-001-history-own-account',order,width)

  await h.api(account+'/orders/'+imported.id,undefined,{as:bob,status:404})
  as=bob
  await page.goto(ready.url+'/order')
  await page.getByRole('heading',{name:'Order history',exact:true}).waitFor()
  await page.getByText('No orders are recorded for this verified email.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('article',{name:/^Order /}).count(),0)
  assert.ok(!(await page.locator('main').innerText()).includes(recordId))
  assert.ok(!(await page.locator('main').innerText()).includes(trackingCode))
  assert.deepEqual((await h.api(account,undefined,{as:bob})).orders,[])
  await screenshot('CUSTOMER-001-history-other-account',page.locator('main'),width)
 }
 assert.deepEqual(journey.errors,[])
 await journey.dev.assertRunning()
 console.log('PASS CUSTOMER-001 reviewed historical imports, native mailbox history and foreign denial at 1440 and 390')
}catch(error){
 journeyError=error
 if(journey?.page){await journey.page.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'./test-results/customer-history','failure.png'),fullPage:true});if(await journey.page.locator('main').count())console.log('Visible failure:',(await journey.page.locator('main').innerText()).slice(0,4000))}
 throw error
}finally{await journey?.finish(journeyError)}
