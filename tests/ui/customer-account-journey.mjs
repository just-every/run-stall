import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startJourney } from './journey-kit.mjs'
import { purchase,publish,deliverWebhook,sendFile,png } from '../api/network.mjs'
let journey,journeyError
try {
 journey=await startJourney({name:'customer-account',skus:['synthetic-stall-1601','synthetic-stall-1602','synthetic-stall-1603','synthetic-stall-1604']})
 const {h,page,context,ready,stock,edge,secret,capture}=journey
 const email='synthetic-stall-1605@example.test',member=await h.signIn(email),other=await h.signIn('synthetic-stall-1606@example.test')
 for(const [i,name] of ['Linen napkins','Ceramic bowl','Oak tray'].entries())await publish(h,`synthetic-stall-${1601+i}`,name,[1200,2400,3600][i])
 const first=await purchase(h,edge,{skus:['synthetic-stall-1601','synthetic-stall-1602','synthetic-stall-1603'],quantities:[2,1,1],email});await deliverWebhook(h,secret,edge.pay(first.session.id))
 const second=await purchase(h,edge,{skus:['synthetic-stall-1603'],quantities:[1],email});await deliverWebhook(h,secret,edge.pay(second.session.id))
 const hidden=await purchase(h,edge,{skus:['synthetic-stall-1603'],quantities:[1],email:'synthetic-stall-1606@example.test'});await deliverWebhook(h,secret,edge.pay(hidden.session.id))
 let product=(await h.api('/api/stall/state')).products.find(p=>p.id==='synthetic-stall-1601')
 product=await h.command('product.prepare',{sku:product.id,revision:product.revision,...product.value,unitCents:1500});await h.command('product.approve',{sku:product.id,revision:product.revision});stock.setAvailable('synthetic-stall-1602','0')
 let fileProduct=await h.command('product.prepare',{sku:'synthetic-stall-1604',name:'Custom print',description:'Print from your artwork',unitCents:2000,active:true,details:{personalization:[{key:'art',label:'Artwork',type:'file',required:true,fileTypes:['png'],maxBytes:1000}]}})
 await h.command('product.approve',{sku:fileProduct.id,revision:fileProduct.revision})
 const uploaded=await (await sendFile(h,'/api/stall/personalization/upload?sku=synthetic-stall-1604&field=art&name=artwork.png',png(),'image/png',{as:''})).json()
 const withFile=await h.api('/api/stall/checkout',{customerEmail:email,lines:[{sku:'synthetic-stall-1604',quantity:1,personalization:{art:uploaded.fileId}}],idempotencyKey:randomUUID()},{as:''})
 await deliverWebhook(h,secret,edge.pay([...edge.sessions.values()].find(s=>s.client_reference_id===withFile.orderId).id))
 await h.api('/api/stall/checkout-fields',{revision:'initial',fields:[{key:'occasion',label:'Occasion',type:'choice',required:true,choices:['Birthday','Thank you']}]})
 let as=member,guestCookie='';const checkoutReceipts=[]
 await context.route('**/api/stall/**',async route=>{const req=route.request(),url=new URL(req.url());const response=await h.request(url.pathname+url.search,{method:req.method(),as:as?as:guestCookie,headers:{...(req.headers()['x-stall-order-token']?{'x-stall-order-token':req.headers()['x-stall-order-token']}:{})},...(req.postData()?{body:JSON.parse(req.postData())}:{})});const body=Buffer.from(await response.arrayBuffer());if(url.pathname==='/api/stall/cart/checkout'&&response.ok)checkoutReceipts.push(JSON.parse(body.toString()));const cookies=response.headers.getSetCookie();if(cookies.length)guestCookie=cookies.map(v=>v.split(';')[0]).join('; ');await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body})})
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});as=member;await page.goto(ready.url+'/order')
  await page.getByRole('heading',{name:'Order history',exact:true}).waitFor()
  const firstCard=page.getByRole('article',{name:'Order '+first.orderId,exact:true})
  await firstCard.waitFor();assert.equal(await page.getByRole('article',{name:'Order '+second.orderId,exact:true}).count(),1)
  assert.equal(await page.getByRole('article',{name:'Order '+hidden.orderId,exact:true}).count(),0)
  assert.match(await firstCard.innerText(),/Linen napkins × 2/);assert.match(await firstCard.innerText(),/\$84\.00/)
  await capture(`history-${width}`)
  const addressForm=page.getByRole('form',{name:'Your address',exact:true})
  const addAddress=page.locator('summary').filter({hasText:'Add an address'})
  if(!await addressForm.isVisible())await addAddress.click()
  for(const [label,value] of [['Recipient','Morgan Lane'],['Address line 1','12 Market Street'],['City','Austin'],['State or province','TX'],['Postal code','78702']])await addressForm.getByLabel(label,{exact:true}).fill(value)
  await addressForm.getByRole('button',{name:'Save address',exact:true}).click();await page.getByText('Address saved.',{exact:true}).waitFor();await capture(`address-book-${width}`)

  const effects=[edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await h.api('/api/stall/state')).orders.length]
  await firstCard.getByRole('button',{name:/^Reorder/}).click()
  await page.getByRole('heading',{name:'Review your reorder',exact:true}).waitFor()
  await page.getByText('Prices changed',{exact:true}).waitFor();await page.getByText('Items left out',{exact:true}).waitFor()
  assert.match(await page.locator('main').innerText(),/\$12\.00 → \$15\.00/)
  assert.match(await page.locator('main').innerText(),/synthetic-stall-1602: There is not enough stock/)
  assert.deepEqual([edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await h.api('/api/stall/state')).orders.length],effects)
  if(width===1440){await page.reload();await page.getByText('Prices changed',{exact:true}).waitFor();await page.getByText('Items left out',{exact:true}).waitFor()}
  await page.locator('summary').filter({hasText:'Delivery address'}).click();assert.equal(await page.getByLabel('Postal code',{exact:true}).inputValue(),'78702')
  await page.getByLabel('Occasion (required)',{exact:true}).selectOption('Thank you')
  await capture(`reorder-changes-${width}`)
  await page.getByRole('button',{name:'Review current total',exact:true}).click();await page.getByRole('button',{name:'Pay $66.00 with Stripe',exact:true}).waitFor()
  await capture(`reorder-total-${width}`)
  const original=structuredClone((await h.api('/api/stall/state')).orders.find(o=>o.id===first.orderId))
  const beforeCheckout=checkoutReceipts.length
  await context.route('https://checkout.stripe.com/**',route=>route.fulfill({status:200,body:'Payment provider network edge'}))
  await page.getByRole('button',{name:'Pay $66.00 with Stripe',exact:true}).click();await page.waitForURL(url=>url.hostname==='checkout.stripe.com');assert.equal(checkoutReceipts.length,beforeCheckout+1);const paid=checkoutReceipts.at(-1);assert.notEqual(paid.orderId,first.orderId)
  const session=[...edge.sessions.values()].find(s=>s.client_reference_id===paid.orderId);await deliverWebhook(h,secret,edge.pay(session.id))
  assert.deepEqual((await h.api('/api/stall/state')).orders.find(o=>o.id===first.orderId),original)
  await page.goto(ready.url+'/order');await page.getByRole('article',{name:'Order '+paid.orderId,exact:true}).waitFor();await capture(`new-order-${width}`)
  await page.getByRole('article',{name:'Order '+withFile.orderId,exact:true}).getByRole('button',{name:/^Reorder/}).click()
  await page.getByText('Items left out',{exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/Upload the personalization file again/)
  assert.equal(await page.getByRole('button',{name:'Review current total',exact:true}).count(),0);await capture(`fresh-upload-required-${width}`)
  await page.getByRole('button',{name:'Back to order history',exact:true}).click()
  await firstCard.getByRole('button',{name:/^Create guest order link/}).click();const href=await page.getByRole('link',{name:'Open guest order link',exact:true}).getAttribute('href')
  as='';guestCookie='';await page.goto(href);await page.getByRole('heading',{name:'Your guest order',exact:true}).waitFor();assert.equal(await page.getByRole('article').count(),1);assert.ok(!page.url().includes('orderLink'))
  await capture(`guest-order-${width}`);await page.getByRole('button',{name:/^Reorder/}).click();await page.getByRole('heading',{name:'Review your reorder',exact:true}).waitFor();await page.getByLabel('Occasion (required)',{exact:true}).selectOption('Birthday');await page.getByRole('button',{name:'Review current total',exact:true}).click();await page.getByRole('button',{name:'Pay $66.00 with Stripe',exact:true}).waitFor();await capture(`guest-reorder-${width}`)
  as=other;await page.goto(ready.url+'/order');await page.getByRole('article',{name:'Order '+hidden.orderId,exact:true}).waitFor();assert.equal(await page.getByRole('article',{name:'Order '+first.orderId,exact:true}).count(),0)
  assert.equal(await page.evaluate(async id=>(await fetch('/api/stall/cart/reorder',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:id})})).status,first.orderId),404)
  await capture(`foreign-order-refused-${width}`)
 }
 assert.deepEqual(journey.errors,[]);console.log('PASS customer account history, fresh reorder checkout, guest links and upload refusal at 1440 and 390')
} catch(error){journeyError=error;if(journey?.page){await journey.page.screenshot({path:(process.env.STALL_SCREENSHOTS??'test-results/customer-account')+'/failure.png',fullPage:true});if(await journey.page.locator('main').count())console.log('Visible failure:',(await journey.page.locator('main').innerText()).slice(0,4000));console.log('Journey failure:',error)}throw error}finally{await journey?.finish(journeyError)}
