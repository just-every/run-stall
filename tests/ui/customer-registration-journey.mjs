import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { startJourney } from './journey-kit.mjs'

const intake='/api/stall/customer/registration'
const reviews='/api/stall/customer/registration-requests'
const screenshots=process.env.STALL_SCREENSHOTS??'./test-results/customer-registration'
let journey,journeyError,customerPage

try {
 journey=await startJourney({name:'customer-registration',skus:[]})
 const {h,page,ready,browser,capture}=journey
 const owner=await h.api('/auth/session')
 assert.equal(owner.kind,'native')
 assert.equal(owner.operator.role,'owner')
 await Promise.all([
  {email:'synthetic-stall-2205@example.test',displayName:'Avery Roberts'},
  {email:'synthetic-stall-2206@example.test',displayName:'Alexandra Montgomery Chen'},
 ].map(person=>h.api(intake,{...person,necessaryAccountConsent:true},{as:'',status:202})))

 for(const [index,width] of [1440,390].entries()) {
  const person={email:`synthetic-stall-${2201+index}@example.test`,displayName:index?'Morgan Ellis Nelson':'Taylor Morgan'}
  const publicContext=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'})
  customerPage=await publicContext.newPage()
  customerPage.on('pageerror',error=>journey.errors.push(error.message))
  let customerCookie=''
  await publicContext.route('**/api/stall/**',async route=>{
   const incoming=route.request(),url=new URL(incoming.url())
   const response=await h.request(url.pathname+url.search,{method:incoming.method(),as:customerCookie,...(incoming.postData()?{body:JSON.parse(incoming.postData())}:{})})
   await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:Buffer.from(await response.arrayBuffer())})
  })
  // Preserve the native confirmation page and its ordinary form submission.
  // Only the transport origin changes; the real Worker creates the session.
  await publicContext.route('**/auth/**',async route=>{
   const incoming=route.request(),url=new URL(incoming.url()),type=incoming.headers()['content-type']
   const response=await h.mf.dispatchFetch(h.origin+url.pathname+url.search,{
    method:incoming.method(),redirect:'manual',headers:{host:new URL(h.origin).host,origin:h.origin,...(type?{'content-type':type}:{}),...(customerCookie?{cookie:customerCookie}:{})},
    ...(!['GET','HEAD'].includes(incoming.method())?{body:incoming.postDataBuffer()}:{}),
   })
   const cookies=response.headers.getSetCookie()
   if(cookies.length)customerCookie=cookies.map(value=>value.split(';')[0]).join('; ')
   const headers=Object.fromEntries([...response.headers].filter(([name])=>!['set-cookie','content-length','transfer-encoding'].includes(name)))
   await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
  })

  await customerPage.goto(ready.url+'/order')
  const form=customerPage.getByRole('form',{name:'Customer account request',exact:true})
  await form.waitFor()
  await form.getByLabel('Your name',{exact:true}).fill(person.displayName)
  await form.getByLabel('Email address',{exact:true}).fill(person.email)
  const consent=form.getByRole('checkbox'),submit=form.getByRole('button',{name:'Request account review',exact:true})
  assert.equal(await consent.isChecked(),false)
  assert.ok(await submit.isDisabled())
  await consent.check()
  if(!index)await capture('CUSTOMER-001-registration-form',form,customerPage)
  const mailBefore=h.messages.length
  const requested=customerPage.waitForResponse(response=>new URL(response.url()).pathname===intake&&response.request().method()==='POST')
  await submit.click()
  assert.equal((await requested).status(),202)
  await customerPage.getByRole('status').filter({hasText:/your request will be reviewed/}).waitFor()
  assert.equal(h.messages.length,mailBefore)
  assert.equal(await h.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(person.email).first(),null)
  assert.equal((await h.request('/api/stall/account',{as:''})).status,401)
  if(!index)await capture('CUSTOMER-001-registration-pending',customerPage.locator('main'),customerPage)

  await page.setViewportSize({width,height:1000})
  await page.goto(ready.url+'/app#customers')
  await page.reload()
  await page.getByRole('heading',{name:'Customers',exact:true,level:1}).waitFor()
  const card=page.getByRole('article',{name:`Account request from ${person.email}`,exact:true})
  await card.waitFor()
  await card.getByRole('heading',{name:person.displayName,exact:true}).waitFor()
  const approve=card.getByRole('button',{name:'Approve and send verification',exact:true})
  assert.ok(await approve.isDisabled())
  await card.getByRole('checkbox').check()
  if(!index)await capture('CUSTOMER-001-registration-owner-review',card)
  const approving=page.waitForResponse(response=>new URL(response.url()).pathname===reviews&&response.request().method()==='POST')
  await approve.click()
  const approved=await approving
  assert.ok(approved.ok(),await approved.text())
  await page.getByRole('status').filter({hasText:/Invitation sent/}).waitFor()
  await card.waitFor({state:'detached'})
  assert.equal(h.messages.length,mailBefore+1)
  assert.equal((await h.db.prepare('SELECT status FROM oa_operators WHERE email=?').bind(person.email).first()).status,'invited')

  const message=h.messages.at(-1)
  assert.ok(JSON.stringify(message.to).includes(person.email))
  const tokenLink=message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0]
  assert.ok(tokenLink,'Native account approval must send a usable verification link')
  const link=new URL(tokenLink)
  await customerPage.goto(ready.url+link.pathname+link.search)
  await customerPage.getByRole('heading',{name:/Accept your invitation/}).waitFor()
  assert.equal(customerCookie,'')
  assert.equal((await h.request('/api/stall/account',{as:''})).status,401)
  if(!index)await capture('CUSTOMER-001-registration-native-verification',customerPage.locator('main'),customerPage)
  await customerPage.getByRole('button',{name:'Confirm',exact:true}).click()
  await customerPage.waitForURL(url=>url.pathname==='/order')
  await customerPage.getByRole('heading',{name:'Order history',exact:true}).waitFor()
  await customerPage.getByText('No orders are recorded for this verified email.',{exact:true}).waitFor()
  assert.ok(customerCookie)
  const session=await h.api('/auth/session',undefined,{as:customerCookie})
  assert.equal(session.kind,'native')
  assert.equal(session.operator.email,person.email)
  assert.equal(session.operator.role,'member')
  assert.equal((await h.api('/api/stall/account',undefined,{as:customerCookie})).orders.length,0)
  assert.equal(await customerPage.getByRole('form',{name:'Customer account request',exact:true}).count(),0)
  assert.equal(await customerPage.getByRole('article',{name:/^Order /}).count(),0)
  assert.ok((await customerPage.locator('main').innerText()).includes(person.email))
  if(!index)await capture('CUSTOMER-001-registration-verified-account',customerPage.locator('main'),customerPage)
  assert.equal(h.messages.length,mailBefore+1)
  await publicContext.close();customerPage=undefined
 }
 assert.deepEqual(journey.errors,[])
 await journey.dev.assertRunning()
 console.log('PASS CUSTOMER-001 public account request, native owner approval and emailed verification at 1440 and 390')
}catch(error){
 journeyError=error
 const shown=customerPage&&!customerPage.isClosed()?customerPage:journey?.page
 if(shown&&!shown.isClosed())await shown.screenshot({path:resolve(screenshots,'failure.png'),fullPage:true})
 throw error
}finally{await journey?.finish(journeyError)}
