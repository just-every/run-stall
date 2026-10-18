import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium } from '@playwright/test'

// Real hosted acceptance: the production link retains its human check. The
// separate test host uses Cloudflare's testing keys and private admission cookie.
test('DEMO-001: the built homepage opens the hosted demo; a hosted visitor buys and approves drafts', { timeout: 180000 }, async () => {
 const home=await readFile(resolve('dist/site/index.html'),'utf8')
 const links=[...home.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
 const link=links.find(m=>/try\s+(?:the\s+)?demo/i.test(m[2].replace(/<[^>]+>/g,' ')))
 assert.ok(link,'built homepage exposes its demo link')
 const production=new URL(link[1])
 const origin=new URL(process.env.STALL_DEMO_TEST_ORIGIN).origin
 assert.notEqual(origin,production.origin,'automated starts belong on the separate test host')
 assert.ok(process.env.RER_DEMO_MEASUREMENT_TOKEN,'hosted test admission must be configured')
 const directory=resolve('test-results/DEMO-001');await mkdir(directory,{recursive:true})
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 let context,step='production demo entry'
 try {
  context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  const page=await context.newPage()
  const response=await page.goto(production.href)
  assert.equal(response.status(),200)
  await page.locator('form[action="/__demo/start"]').waitFor()
  async function capture(name,locator) {
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000})
    if(locator)await locator.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} overflows at ${width}`)
    await page.screenshot({path:join(directory,`${name}-${width}.png`),fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  await capture('production-entry')
  step='hosted test admission'
  await context.addCookies([{name:'rer_demo_measure',value:process.env.RER_DEMO_MEASUREMENT_TOKEN,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}])
  await page.goto(origin)
  await page.waitForURL(u=>u.pathname==='/app',{timeout:60000})
  await page.getByRole('heading',{name:'Orders',exact:true,level:1}).waitFor()
  const api=async(path,body)=>{
   const response=await context.request.fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin},...(body===undefined?{}:{data:body})})
   assert.ok(response.ok(),`${path}: HTTP ${response.status()}`)
   return response.json()
  }
  const health=await api('/health')
  assert.equal(health.ok,true)
  // Native demos do not populate deploy-kit's sourceSha binding. Compare the
  // served application chunks with this checkout's emitted build instead.
  const chunks=await page.locator('script[src]').evaluateAll(scripts=>scripts.map(s=>new URL(s.src).pathname).filter(path=>path.startsWith('/assets/')))
  assert.ok(chunks.length,'the sample shop loads the emitted application')
  for(const path of chunks) {
   const response=await context.request.get(origin+path)
   assert.equal(response.status(),200)
   assert.deepEqual(await response.body(),await readFile(resolve('dist/client','.'+path)),`hosted ${path} differs from this commit's build`)
  }
  const before=await api('/api/stall/state')
  assert.ok(before.products.some(p=>p.value.draft))
  for(const status of ['paid','awaiting_payment','reserved','shipped','shortfall'])assert.ok(before.orders.some(o=>o.status===status))
  assert.ok(before.audit.some(a=>a.actor.startsWith('agent:')))
  await capture('orders')
  step='approve prepared refund'
  const refund=before.orders.find(o=>o.refunds.some(r=>r.status==='draft'))
  assert.ok(refund)
  await page.goto(origin+'/app#orders/'+refund.id)
  const approveRefund=page.getByRole('button',{name:/Approve \$[\d,.]+ refund/})
  await approveRefund.waitFor();await capture('refund-draft',approveRefund)
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/stall/commands')&&r.request().postDataJSON()?.type==='refund.approve'),approveRefund.click()])
  assert.equal((await api('/api/stall/state')).orders.find(o=>o.id===refund.id).refunds.at(-1).status,'succeeded')
  await page.goto(origin+'/app#orders/'+refund.id)
  await page.locator('.st-order-panel .st-badge').filter({hasText:/^Succeeded$/}).waitFor()
  await capture('refund-complete',page.locator('.st-order-panel'))
  step='approve prepared shipment'
  const packed=before.orders.find(o=>o.shipment?.status==='draft');assert.ok(packed)
  await page.goto(origin+'/app#orders/'+packed.id)
  const approveShipment=page.getByRole('button',{name:/Approve shipping · revision/})
  await approveShipment.waitFor();await capture('shipment-draft',approveShipment)
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/stall/commands')&&r.request().postDataJSON()?.type==='shipment.approve'),approveShipment.click()])
  assert.equal((await api('/api/stall/state')).orders.find(o=>o.id===packed.id).status,'shipped')
  await page.goto(origin+'/app#orders/'+packed.id)
  await page.getByText('Shipping has been confirmed by Pier.',{exact:true}).waitFor()
  await capture('shipment-complete',page.locator('.st-order-panel'))
  step='buy from public shop'
  const catalogue=await api('/api/stall/catalogue'),item=catalogue.items.find(p=>Number(p.available)>=2)
  assert.ok(item&&catalogue.checkoutReady)
  await page.goto(origin+'/shop')
  await page.getByLabel('Quantity for '+item.name,{exact:true}).fill('2')
  await page.getByLabel('Email for your order',{exact:true}).fill('shopper@example.test')
  await page.getByRole('button',{name:'Review order',exact:true}).click()
  const pay=page.getByRole('button',{name:/Pay \$[\d,.]+ with Stripe/})
  await pay.waitFor();await capture('shop-review',pay)
  await pay.click();await page.waitForURL(u=>u.pathname==='/order')
  const orderId=new URL(page.url()).searchParams.get('orderId')
  const bought=(await api('/api/stall/state')).orders.find(o=>o.id===orderId)
  assert.equal(bought.status,'reserved');assert.equal(bought.totalCents,2*item.unitCents)
  assert.equal(bought.customerEmail,'shopper@example.test')
  assert.equal(Number((await api('/api/stall/catalogue')).items.find(p=>p.sku===item.sku).available),Number(item.available)-2)
  await capture('purchase-complete')
  step='invite without sending mail'
  await api('/auth/invite',{email:'teammate@example.test',displayName:'Teammate',role:'admin',returnTo:'/app'})
  console.log('DEMO-001 hosted sample, exact-SHA purchase, refund, shipment and invitation passed at 1440 and 390. Outbound suppression is separately exercised by DEMO-001 in tests/api/demo.test.mjs.')
 }catch(error){throw new Error(`DEMO-001 failed at ${step} (${error.name}); private browser credentials were not logged.`)}
 finally {
  if(context){try{await context.request.post(origin+'/__demo/cancel',{headers:{origin}})}finally{await context.close()}}
  await browser.close()
 }
})
