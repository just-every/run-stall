import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
import { resolve,join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { installation } from '../api/harness.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { stripeEdge,publish,deliverWebhook } from '../api/network.mjs'
import { taxEdge } from '../api/tax-edge.mjs'
import { startOwnedDev,finishCleanup } from '../owned-dev.mjs'

let dev,browser,h,problem
const screenshots=resolve(process.env.STALL_SCREENSHOTS??'./test-results/buy-links')
try {
 await mkdir(screenshots,{recursive:true})
 console.log('Start owned native commerce UI')
 dev=await startOwnedDev({launcher:resolve('node_modules/@runeditrun/rer/global/rer.mjs'),checkout:process.cwd(),env:process.env})
 const ready=await dev.ready,stock=volumeStock(['TEE-S','TEE-M','HAT-1']),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex'),tax=taxEdge()
 h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-3210',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-806',STRIPE_WEBHOOK_SECRET:secret},outboundService:request=>{const url=new URL(request.url);return url.hostname==='api.stripe.com'&&(url.pathname.startsWith('/v1/tax/')||url.pathname==='/v1/account')?tax.handle(request):edge.handle(request)}})
 let tee=await h.command('product.prepare',{sku:'TEE',name:'Linen tee',description:'A linen tee',unitCents:2500,active:true,details:{handle:'linen-tee',options:[{name:'Size',values:['S','M']}],variants:[{sku:'TEE-S',options:{Size:'S'},unitCents:2500},{sku:'TEE-M',options:{Size:'M'},unitCents:2700}]}})
 await h.command('product.approve',{sku:'TEE',revision:tee.revision});await publish(h,'HAT-1','Wool hat',1800)
 await h.command('collection.save',{handle:'gifts',title:'Gifts',description:'Maker gifts',kind:'manual',skus:['TEE','HAT-1']})
 await h.command('shipping.configure',{shippingCents:625})
 await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-3212',startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),minimumBasketCents:2500,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:12500})
 const base='/api/stall/buy-links',allowed='https://allowed.synthetic-stall-3213.test',denied='https://denied.synthetic-stall-3214.test'
 const link=await h.api(base,{label:'Two sizes',lines:[{sku:'TEE-S',quantity:2},{sku:'TEE-M',quantity:1}],promotionCode:'SYNTHETIC-STALL-3212'}),widgets=[]
 for(const [kind,selection] of [['buy_button',{lines:[{sku:'TEE-S',quantity:2}]}],['product_card',{productSku:'TEE'}],['collection',{collection:'gifts'}]])widgets.push(await h.api(base,{label:'Maker gifts',kind,...selection,allowedOrigins:[allowed]}))
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext(),page=await context.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 let guest='',owner=false,lastCheckout
 await context.route('**/api/stall/**',async route=>{
  const req=route.request(),url=new URL(req.url()),response=await h.request(url.pathname+url.search,{method:req.method(),as:owner?h.cookie:guest,...(url.pathname.endsWith('/widget')?{headers:{origin:req.headers().origin??''}}:{}),...(req.postData()?{body:JSON.parse(req.postData())}:{})})
  if(url.pathname==='/api/stall/cart/checkout')lastCheckout=await response.clone().json()
  const cookies=response.headers.getSetCookie();if(cookies.length)guest=cookies.map(v=>v.split(';')[0]).join('; ')
  const headers=Object.fromEntries([...response.headers].filter(([name])=>['content-type','access-control-allow-origin','vary'].includes(name)))
  await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
 })
 await context.route(h.origin+'/shop**',route=>{const url=new URL(route.request().url());return route.fulfill({status:302,headers:{location:ready.url+url.pathname+url.search},body:''})})
 for(const origin of [allowed,denied])await context.route(origin+'/**',route=>{const index=Number(new URL(route.request().url()).searchParams.get('widget')??0);return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>External maker blog</h1>'+widgets[index].embed+'</main></body></html>'})})
 await context.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Provider checkout boundary</h1>'}))
 await page.goto(ready.openUrl);await page.waitForURL(url=>['/setup','/app'].includes(url.pathname))
 if(new URL(page.url()).pathname==='/setup'){await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click()}
 const capture=async(label,width)=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} overflow at ${width}`);await page.screenshot({path:join(screenshots,`${label}-${width}.png`),fullPage:true})}
 let purchaseIndex=0
 const widgetOrders=[]
 async function buy(width,label,total,taxed=false){
  await page.getByRole('button',{name:'Continue to native cart',exact:true}).click();await page.getByRole('heading',{name:'Review checkout link',exact:true}).waitFor()
  await page.getByLabel('Email for your order',{exact:true}).fill(`synthetic-stall-${width}-${purchaseIndex++}@example.test`)
  const address=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Delivery address$/})})
  for(const [field,value] of [['Recipient','Taylor Maker'],['Address line 1','1 Maker Lane'],['City','Austin'],['State or province','TX'],['Postal code','78702']])await address.getByLabel(field,{exact:true}).fill(value)
  if(taxed){
   const quote=page.locator('[aria-label="Sales tax quote"]')
   await expect(page.getByRole('button',{name:'Review current total',exact:true})).toBeDisabled()
   await expect(quote.getByRole('button',{name:'Calculate sales tax',exact:true})).toBeDisabled()
   await expect(page.getByText('Checking shipping options…',{exact:true})).toBeHidden()
   await quote.getByRole('checkbox').check();await quote.getByRole('button',{name:'Calculate sales tax',exact:true}).click()
   await expect(quote.getByText('$6.37',{exact:true})).toBeVisible()
  }
  await page.getByRole('button',{name:'Review current total',exact:true}).click()
  const pay=page.getByRole('button',{name:`Pay $${(total / 100).toFixed(2)} with Stripe`,exact:true});await expect(pay).toBeVisible();await capture(label+'-reviewed-cart',width)
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stall/cart/checkout');await pay.click();const response=await created;assert.equal(response.status(),200,JSON.stringify(lastCheckout))
  await page.waitForURL('https://checkout.stripe.com/**')
  const bought=lastCheckout,session=[...edge.sessions.values()].find(s=>s.client_reference_id===bought.orderId);assert.equal(session.amount_total,total);await deliverWebhook(h,secret,edge.pay(session.id));return bought.orderId
 }
 for(const width of [1440,390]) {
  console.log(`Checkout links and external embeds at ${width}`)
  await page.setViewportSize({width,height:1000});owner=false
  await page.goto(ready.url+'/shop?buy='+link.id);await page.getByRole('heading',{name:'Two sizes',exact:true}).waitFor()
  await expect(page.getByText('$50.00',{exact:true})).toBeVisible();await expect(page.getByText('$27.00',{exact:true})).toBeVisible();await capture('two-variant-link',width)
  const id=await buy(width,'two-variant-link',7700);assert.equal((await h.api('/api/stall/orders?channel=checkout_link')).orders.find(o=>o.id===id).channel,'checkout_link')
  for(const [index,widget] of widgets.entries()) {
   await page.goto(allowed+'/?widget='+index)
   await expect(page.getByRole('heading',{name:'Maker gifts',exact:true})).toBeVisible()
   const expected=index===0?1:index===1?2:3;assert.equal(await page.getByRole('button',{name:'Buy in Stall',exact:true}).count(),expected)
   await capture(widget.value.kind+'-allowed',width)
   await page.locator('article').filter({hasText:'Linen tee'}).first().getByRole('button',{name:'Buy in Stall',exact:true}).click();await page.getByRole('heading',{name:'Maker gifts',exact:true}).waitFor()
   const orderId=await buy(width,widget.value.kind,index===0?5625:3125)
   widgetOrders.push(orderId)
   assert.equal((await h.api('/api/stall/orders?channel=buy_button')).orders.find(o=>o.id===orderId).status,'reserved')
   await page.goto(denied+'/?widget='+index);await expect(page.getByText('This embed is unavailable or is not allowed on this website.',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:'Buy in Stall',exact:true}).count(),0);await capture(widget.value.kind+'-denied',width)
  }
  owner=true;await page.goto(ready.url+'/app#orders');const filtered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stall/orders'&&new URL(response.url()).searchParams.get('channel')==='buy_button');await page.getByLabel('Channel',{exact:true}).selectOption('buy_button');assert.deepEqual((await (await filtered).json()).orders.map(o=>o.id).sort(),[...widgetOrders].sort())
  const control=page.getByRole('button',{name:/^Account menu for /}),tooltip=page.getByRole('tooltip',{name:'Account menu',exact:true})
  await page.mouse.move(0,0);await control.evaluate(element=>element.blur());await control.focus();assert.equal(await tooltip.isVisible(),true);await page.keyboard.press('Escape');await control.evaluate(element=>element.blur())
  const started=Date.now();await control.hover();assert.equal(await tooltip.isVisible(),false);await expect(tooltip).toBeVisible({timeout:1500});assert.ok(Date.now()-started>=250);await capture('channel-filter-account-tooltip',width)
 }
 const config=await h.api('/api/stall/tax/configuration')
 await h.api('/api/stall/tax/configuration',{revision:config.revision,value:{shipFrom:{line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'},categories:['TEE-S','TEE-M','HAT-1'].map(sku=>({sku,taxCode:'txcd_99999999'})),thresholds:[]}})
 const mode=await h.api('/api/stall/tax/commerce?review=1');await h.api('/api/stall/tax/commerce',{revision:mode.revision,enabled:true,consent:mode.consent})
 for(const width of [1440,390]){owner=false;await page.setViewportSize({width,height:1000});await page.goto(ready.url+'/shop?buy='+link.id);await page.getByRole('heading',{name:'Two sizes',exact:true}).waitFor();const id=await buy(width,'taxed-two-variant-link',8337,true);const order=(await h.api('/api/stall/orders?channel=checkout_link')).orders.find(o=>o.id===id);assert.equal(order.tax.taxCents,637);assert.equal(order.tax.totalCents,8337);assert.equal(order.promotion.discountCents,625)}
 owner=false;stock.setAvailable('TEE-S','0')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(allowed+'/?widget=0');await expect(page.getByText('$25.00 · Sold out',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Buy in Stall',exact:true})).toBeDisabled();await capture('sold-out-button',width)}
 tee=(await h.api('/api/stall/state')).products.find(p=>p.id==='TEE');tee=await h.command('product.prepare',{sku:tee.id,revision:tee.revision,...tee.value,active:false});await h.command('product.approve',{sku:tee.id,revision:tee.revision})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(allowed+'/?widget=0');await expect(page.getByText('No published products available.',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:'Buy in Stall',exact:true}).count(),0);await capture('unpublished-button',width)}
 await h.api(base+'/'+link.id+'/revoke',{revision:link.revision})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(ready.url+'/shop?buy='+link.id);await expect(page.getByRole('alert')).toHaveText('This checkout link is no longer available.');assert.equal(await page.getByRole('button',{name:'Continue to native cart',exact:true}).count(),0);await capture('revoked-link',width)}
 assert.deepEqual(errors,[]);assert.equal(stock.orders.size,10)
 console.log('Native links, all three embeds, exact totals, channel, stock, domain refusals and account tooltips passed at 1440 and 390')
}catch(error){problem=error;throw error}
finally{await finishCleanup(async()=>{await browser?.close();await h?.close();await dev?.stop()},problem)}
