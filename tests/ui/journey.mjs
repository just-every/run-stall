import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, mkdtemp, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import { installation } from '../api/harness.mjs'
import { pierInstallation } from '../api/pier.mjs'
import { stripeEdge, deliverWebhook } from '../api/network.mjs'
const exec=promisify(execFile),rer=resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const evidence=resolve(process.env.STALL_SCREENSHOTS??'test-results/browser')
await mkdir(evidence,{recursive:true})
const scratch=await mkdtemp(join(tmpdir(),'stall-browser-')),checkout=join(scratch,'run-stall')
let browser,h,pier,restored,original
try {
 await exec('git',['clone','--no-hardlinks',process.cwd(),checkout])
 const {stdout}=await exec(process.execPath,[rer,'dev','--detach','--json','--cwd',checkout],{maxBuffer:4*1024*1024,timeout:600000,env:{...process.env,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}}).catch(error=>{const events=String(error.stdout??'').split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});const code=events.findLast(event=>event.event==='error')?.code;throw Error(`rer dev failed (${error.code}; ${typeof code==='string'&&/^[A-Za-z0-9_.-]+$/.test(code)?code:'no structured code'}); run rer dev for its private diagnostic.`)})
 const ready=stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}).find(event=>event.event==='ready')
 const origin=ready?.url,open=ready?.openUrl,site=ready?.siteUrl
 assert.ok(origin&&open&&site,'RER must print its app, automatic entry and local run site')
 assert.equal((await fetch(site+'/run')).status,200)
 pier=await pierInstallation()
 const edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 // This test transport directs browser API requests to the real migrated
 // Worker and native owner session. The application contains no fixture path.
 await page.route('**/api/stall/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  const response=await h.request(url.pathname+url.search,{method:req.method(),...(req.postData()?{body:JSON.parse(req.postData())}:{} )})
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json',...(response.headers.get('content-disposition')?{'content-disposition':response.headers.get('content-disposition')}:{})},body:Buffer.from(await response.arrayBuffer())})
 })
 async function capture(name,selector) {
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   if(selector)await (typeof selector==='string'?page.locator(selector):selector).scrollIntoViewIfNeeded()
   else await page.evaluate(()=>window.scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page overflows at ${width}: ${name}`)
   await page.screenshot({path:resolve(evidence,`${name}-${width}.png`)})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 // Follow the run site's public links, including Markdown-derived docs.
 const pending=['/','/404'], visited=new Set()
 while(pending.length) {
  const path=pending.shift();if(visited.has(path))continue;visited.add(path)
  const response=await fetch(site+path);assert.equal(response.status,200,`run site ${path}`)
  const html=await response.text()
  for(const match of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
   if(!visited.has(match[1])) {
    if(/\.[a-z0-9]+$/i.test(match[1]))assert.equal((await fetch(site+match[1])).status,200,match[1])
    else pending.push(match[1])
   }
  }
 }
 await page.goto(site);await capture('landing')
 for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});await page.screenshot({path:resolve(evidence,`landing-full-${width}.png`),fullPage:true})}
 await page.goto(site+'/run');await capture('run')
 await page.goto(site+'/docs');await capture('docs')
 await page.goto(origin);await capture('lobby')
 await page.route('**/signin', async route => { const response = await h.request('/signin', { as: '' }); await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }) });
 await page.goto(origin+'/signin');await page.getByRole('heading',{name:'Sign in to Stall'}).waitFor();await capture('signin')
 await page.goto(open)
 await page.waitForURL(url=>url.pathname==='/setup'||url.pathname==='/app')
 if(new URL(page.url()).pathname==='/setup') {
  await capture('setup')
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Finish setup',exact:true}).click()
 }
 await page.getByRole('heading',{name:'Your shop, in view.'}).waitFor()
 await page.getByText('Bring your products into Stall',{exact:true}).waitFor()
 await capture('empty')
 await capture('desk-empty','#products')
 const csv=await readFile(new URL('../../fixtures/shopify-products.csv',import.meta.url),'utf8')
 await page.getByLabel('CSV source',{exact:true}).fill(csv)
 await page.getByRole('button',{name:'Run dry run',exact:true}).click()
 await page.getByLabel('Reviewed fingerprint').waitFor()
 await capture('move-in-preview','#move-in')
 await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click()
 await page.getByText('Import completed. Products are staged for review.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'View',exact:true}).first().click()
 await page.getByText('Source custody',{exact:true}).waitFor()
 await capture('import-journal',page.getByRole('heading',{name:'Import journal',exact:true}))
 for(const name of ['Stoneware mug','Linen towel']) {
  const card=page.locator('#products .st-product').filter({has:page.getByRole('heading',{name,exact:true})})
  await card.getByRole('button',{name:'Edit product',exact:true}).click()
  await page.getByLabel('Available for publication',{exact:true}).check()
  await page.getByRole('button',{name:'Prepare revision',exact:true}).click()
  await card.getByRole('button',{name:/Approve & publish revision/}).waitFor()
  await capture('product-approval-'+name.split(' ')[0].toLowerCase(),'#products')
  await card.getByRole('button',{name:/Approve & publish revision/}).click()
  await card.getByText('Published',{exact:true}).waitFor()
 }
 await page.getByRole('link',{name:'Products',exact:true}).click()
 await page.locator('.st-tabs a[href="#products"][aria-current="true"]').waitFor()
 await capture('products','#products')
 await capture('products-published','#products')
 await page.goto(origin+'/shop')
 await page.getByLabel('Quantity for Stoneware mug').fill('1')
 await page.getByLabel('Quantity for Linen towel').fill('1')
 await page.getByLabel('Email for your order').fill('customer@example.test')
 await page.getByRole('button',{name:'Review order',exact:true}).click()
 await page.getByRole('button',{name:'Pay $42.50 with Stripe',exact:true}).waitFor()
 await capture('shop-review')
 await capture('shop-total',page.getByRole('button',{name:'Pay $42.50 with Stripe',exact:true}))
 const payment=page.waitForResponse(response=>response.url().startsWith('https://checkout.stripe.com/'))
 await page.route('https://checkout.stripe.com/**',route=>route.fulfill({status:204,body:''}))
 await page.getByRole('button',{name:'Pay $42.50 with Stripe',exact:true}).click()
 await payment
 const session=[...edge.sessions.values()][0];assert.ok(session)
 const paid=edge.pay(session.id)
 assert.equal((await deliverWebhook(h,secret,paid)).response.status,200)
 await page.goto(origin+'/order?checkout=success')
 await capture('checkout-return')
 await page.goto(origin+'/app')
 await capture('home')
 await page.locator('#orders .st-order-summary').first().click()
 await page.getByLabel('Shipping reference').fill('AU-TRACK-1001')
 await page.getByRole('button',{name:'Prepare shipping for approval',exact:true}).click()
 await page.getByRole('button',{name:/Approve shipping · revision/}).waitFor()
 await capture('order','#orders')
 await capture('shipment-approval',page.getByRole('button',{name:/Approve shipping · revision/}))
 await page.getByRole('button',{name:/Approve shipping · revision/}).click()
 await page.getByText('Shipping has been confirmed by Pier.',{exact:true}).waitFor()
 await page.getByText('Prepare a one-line partial refund',{exact:true}).click()
 await page.getByLabel('Reason',{exact:true}).fill('One mug returned damaged; no restock')
 await page.getByRole('button',{name:'Prepare partial refund',exact:true}).click()
 await page.getByRole('button',{name:/Approve \$24.50 refund/}).waitFor()
 await capture('refund-approval',page.getByRole('button',{name:/Approve \$24.50 refund/}))
 await page.getByRole('button',{name:/Approve \$24.50 refund/}).click()
 await page.locator('#orders .st-badge').filter({hasText:/^Succeeded$/}).waitFor()
 await capture('order-reconciled','#orders')
 await capture('activity','#history')
 await page.getByRole('button',{name:'Create agent credential',exact:true}).click()
 await page.getByLabel('Private agent credential').waitFor()
 await page.getByRole('button',{name:'Hide credential',exact:true}).click()
 await page.getByRole('button',{name:'Revoke agent credentials',exact:true}).click()
 await page.getByText('Agent credentials revoked.',{exact:true}).waitFor()
 await capture('settings','#portability')
 await capture('data','#portability')
 await page.getByRole('button',{name:'Prepare export download',exact:true}).click()
 await page.locator('#portability [role=status]').waitFor()
 for(let part=0;part<100;part++) {
  if(await page.getByRole('button',{name:'Download archive',exact:true}).count())break
  await page.getByRole('button',{name:'Continue preparing export',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('#portability button:disabled'))
 }
 const downloading=page.waitForEvent('download')
 await page.getByRole('button',{name:'Download archive',exact:true}).click()
 const downloaded=await downloading,bytes=await readFile(await downloaded.path())
 original=h
 restored=await installation();h=restored
 await page.reload()
 await page.getByText('Restore an archive into this empty installation',{exact:true}).click()
 await page.getByLabel('Choose archive',{exact:true}).setInputFiles({name:'stall.rer',mimeType:'application/x-ndjson',buffer:bytes})
 await page.getByRole('checkbox',{name:'I have reviewed this archive and confirm restoring it into this empty installation.'}).check()
 await page.getByRole('button',{name:'Restore reviewed archive',exact:true}).click()
 await page.getByText('Archive restored. Review provider connections before taking orders.',{exact:true}).waitFor()
 assert.equal((await h.api('/api/stall/state')).orders[0].refunds[0].status,'succeeded')
 await capture('data-restored','#portability')
 h=original;await restored.close();restored=undefined
 await page.reload()

 await page.getByLabel('Customer email',{exact:true}).fill('customer@example.test')
 await page.getByRole('button',{name:'Review customer erasure',exact:true}).click()
 await page.getByLabel('Type ERASE to confirm',{exact:true}).fill('ERASE')
 await capture('erasure-confirm','dialog')
 await page.getByRole('button',{name:'Permanently erase customer details',exact:true}).click()
 await page.getByText('Customer details erased',{exact:true}).waitFor()
 await capture('order-erased','#orders')
 const state=await h.api('/api/stall/state')
 assert.equal(state.orders[0].status,'shipped');assert.equal(state.orders[0].customerEmail,null)
 assert.equal(state.orders[0].refunds[0].status,'succeeded')
 assert.equal(edge.refunds.size,1)
 assert.deepEqual(errors,[])
 console.log(`Run site linked pages: ${[...visited].join(', ')}`)
 console.log('Browser journey passed: move-in, product approvals, customer checkout, shipping, refund, backup/restore, credentials and erasure at 1440 and 390.')
} finally {
 await browser?.close();await restored?.close();if(h!==restored)await h?.close();if(original&&original!==h&&original!==restored)await original.close();await pier?.close()
 await exec(process.execPath,[rer,'dev','--stop','--cwd',checkout],{timeout:60000,env:{...process.env,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}}).catch(()=>{})
 await rm(scratch,{recursive:true,force:true})
}
