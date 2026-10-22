import { riskJourney } from './risk-journey.mjs'
import { workflowJourney } from './workflow-journey.mjs'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { mkdtemp,mkdir,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve,join } from 'node:path'
import { installation } from '../api/harness.mjs'
import { pierInstallation } from '../api/pier.mjs'
import { stripeEdge,publish,purchase,deliverWebhook } from '../api/network.mjs'
import { startOwnedDev,finishCleanup } from '../owned-dev.mjs'
const exec=promisify(execFile),screenshots=resolve(process.env.STALL_SCREENSHOTS??'test-results/staff')
const scratch=await mkdtemp(join(tmpdir(),'stall-staff-')),checkout=join(scratch,'run-stall'),rerHome=join(scratch,'rer-home')
await mkdir(screenshots,{recursive:true});await mkdir(rerHome)
let browser,dev,h,pier,page,journeyError,cleaning
function cleanup(){return cleaning??=(async()=>{await browser?.close();const results=await Promise.allSettled([h?.close(),pier?.close(),dev?.stop()].filter(Boolean));if(results.some(r=>r.status==='rejected'))throw new AggregateError(results.filter(r=>r.status==='rejected').map(r=>r.reason),'Staff journey cleanup');await rm(scratch,{recursive:true,force:true})})()}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void cleanup().then(()=>process.exit(1),()=>process.exit(1)))
try {
 await exec('git',['clone','--no-hardlinks',process.cwd(),checkout])
 dev=await startOwnedDev({launcher:resolve('node_modules/@runeditrun/rer/global/rer.mjs'),checkout,env:{...process.env,HOME:rerHome,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}})
 const ready=await dev.ready
 pier=await pierInstallation();const edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const riskLevels=new Map()
 h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-601',STRIPE_WEBHOOK_SECRET:secret},outboundService:async request=>{const url=new URL(request.url);if(url.hostname==='api.stripe.com'&&url.pathname.startsWith('/v1/payment_intents/')){const id=decodeURIComponent(url.pathname.split('/').at(-1)),session=[...edge.sessions.values()].find(s=>s.payment_intent===id);assert.ok(session);const level=riskLevels.get(session.client_reference_id)??'normal';return Response.json({id,object:'payment_intent',metadata:session.metadata,amount:session.amount_total,currency:session.currency,status:'succeeded',latest_charge:{id:'synthetic-stall-660-'+session.client_reference_id,object:'charge',payment_intent:id,outcome:{risk_level:level,risk_score:level==='normal'?4:90},payment_method_details:{card:{checks:{cvc_check:'pass',address_postal_code_check:'pass',address_line1_check:'pass'}}}}})}return edge.handle(request)}})
 await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
 const bought=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],expectedTotalCents:2450,email:'ana.ruiz@example.test'})
 await deliverWebhook(h,secret,edge.pay(bought.session.id))
 const people={}
 for(const [index,role] of ['catalog','fulfillment','customer_support','marketing','finance','administrator'].entries()) {
  const cookie=await h.signIn(`synthetic-stall-${610+index}@example.test`),person=(await h.api('/auth/session',undefined,{as:cookie})).operator
  await h.db.prepare('UPDATE oa_operators SET display_name=? WHERE id=?').bind(['Maya Chen','Luis Rivera','Ana Patel','Rowan Park','Elena Ruiz','Jonah Brooks'][index],person.id).run()
  people[role]={cookie,...person}
 }
 let as=h.cookie
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page=await context.newPage();const errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await context.route('**/api/stall/**',async route=>{const req=route.request(),url=new URL(req.url());const response=await h.request(url.pathname+url.search,{method:req.method(),as,...(req.postData()?{body:JSON.parse(req.postData())}:{})});await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:Buffer.from(await response.arrayBuffer())})})
 await page.goto(ready.openUrl);await page.waitForURL(url=>['/setup','/app'].includes(url.pathname))
 if(new URL(page.url()).pathname==='/setup'){await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click()}
 async function capture(name,selector=page.locator('main')){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await selector.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} overflows ${width}`);await page.screenshot({path:join(screenshots,`ROLE-001-${name}-${width}.png`)});await selector.screenshot({path:join(screenshots,`ROLE-001-${name}-detail-${width}.png`)})}await page.setViewportSize({width:1440,height:1000})}
 const staffResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/stall/staff')
 await page.goto(ready.url+'/app#settings')
 const loaded=await staffResponse;assert.ok(loaded.ok(),await loaded.text());const visibleStaff=await loaded.json();assert.ok(visibleStaff.staff.some(p=>p.email===people.catalog.email),JSON.stringify(visibleStaff))
 await page.getByRole('heading',{name:'Staff permissions',exact:true}).waitFor()
 for(const [role,person] of Object.entries(people)) {
  const form=page.getByRole('form',{name:`Permissions for ${person.email}`,exact:true})
  await form.getByLabel('Shop role',{exact:true}).selectOption(role)
  await form.getByLabel('Refund approval limit (USD)',{exact:true}).fill('100.00')
  const response=page.waitForResponse(r=>r.url().endsWith('/api/stall/commands')&&r.request().method()==='POST')
  await form.getByRole('button',{name:'Save permissions',exact:true}).click();assert.ok((await response).ok())
  await page.getByText('Saved. The latest recorded state is shown.',{exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('#staff-access button:disabled'))
 }
 await capture('owner-permissions',page.getByRole('form',{name:`Permissions for ${people.catalog.email}`,exact:true}))
 for(const [role,person] of Object.entries(people)) {
  as=person.cookie
  const view=role==='catalog'?'products':role==='marketing'?'shopfront':role==='administrator'?'shipping':'orders'
  await page.goto(ready.url+'/app#'+view);await page.reload()
  await page.getByRole('heading',{name:role==='catalog'?'Products':role==='marketing'?'Collections and search':role==='administrator'?'Shipping':'Orders',exact:true,level:1}).waitFor()
  assert.equal(await page.getByRole('navigation',{name:'Shop desk',exact:true}).getByRole('link',{name:'Activity',exact:true}).count(),0)
  if(role==='customer_support') {
   await page.getByLabel('Internal note',{exact:true}).fill('Ana requested careful packing for the ceramic glaze.')
   const response=page.waitForResponse(r=>r.url().endsWith('/api/stall/commands'))
   await page.getByRole('button',{name:'Add note',exact:true}).click();assert.ok((await response).ok())
   await page.getByText('Ana requested careful packing for the ceramic glaze.',{exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Record paid sale',exact:true}).count(),0)
  }
  if(role==='finance') {
   assert.ok(!(await page.locator('main').textContent()).includes('careful packing'))
   assert.equal(await page.getByLabel('Internal note',{exact:true}).count(),0)
  }
  await capture(role)
  await page.goto(ready.url+'/app#settings');await page.getByRole('heading',{name:'Your staff account',exact:true}).waitFor()
  if(role==='administrator')await capture('administrator-settings')
 }
 as=h.cookie
 await riskJourney({page,h,edge,secret,origin:ready.url,riskLevels,capture})
 await workflowJourney({page,h,origin:ready.url,assignee:people.fulfillment,capture,setActor:value=>{as=value}})
 await h.command('staff.configure',{actorId:people.customer_support.id,staffRole:'marketing',refundLimitCents:0})
 as=people.customer_support.cookie;await page.goto(ready.url+'/app#orders');await page.reload();await page.getByRole('heading',{name:'Staff workspace',exact:true}).waitFor();await capture('downgraded')
 assert.deepEqual(errors,[])
 console.log('PASS staff permissions and scoped desk journey at 1440 and 390')
} catch(error){journeyError=error;if(page){await page.screenshot({path:join(screenshots,'failure.png'),fullPage:true});console.log('Visible failure state:',(await page.locator('main').innerText()).slice(0,10000))}throw error} finally {await finishCleanup(cleanup,journeyError)}
