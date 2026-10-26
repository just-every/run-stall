import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { startJourney } from './journey-kit.mjs'

let journey,journeyError
try {
 journey=await startJourney({name:'customer-balances',skus:[]})
 const {h,page,context,ready}=journey
 let as=h.cookie
 // Transport the built native UI to the real migrated commerce Worker.
 await context.route('**/api/stall/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  const response=await h.request(url.pathname+url.search,{method:req.method(),as,...(req.postData()?{body:JSON.parse(req.postData())}:{})})
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:Buffer.from(await response.arrayBuffer())})
 })
 const base='/api/stall/customer-balances',own='/api/stall/account/balances'
 const balances=address=>h.api(base+'?email='+encodeURIComponent(address))
 const amount=(panel,label)=>panel.locator('dt').filter({hasText:new RegExp('^'+label+' · USD$')}).locator('..')
 for(const [index,width] of [1440,390].entries()) {
  const fixture=2510+index*10,email=`synthetic-stall-${fixture}@example.test`,otherEmail=`synthetic-stall-${fixture+1}@example.test`,name=`synthetic-stall-${fixture+2}`
  const reasons={gift:`synthetic-stall-${fixture+3}`,credit:`synthetic-stall-${fixture+4}`,adjust:`synthetic-stall-${fixture+5}`}
  const rows=[{email,name},{email:otherEmail,name}]
  const preview=await h.api('/api/stall/customers/import/preview',{rows})
  await h.api('/api/stall/customers/import/apply',{rows,fingerprint:preview.fingerprint})
  const member=await h.signIn(email),other=await h.signIn(otherEmail),mailBefore=h.messages.length
  const issue={commandId:randomUUID(),type:'issue',email,kind:'gift',amountCents:2000,currency:'usd',revision:(await balances(email)).revision,reason:reasons.gift,confirmed:true}
  let current=await h.api(base,issue)
  current=await h.api(base,{...issue,commandId:randomUUID(),kind:'credit',amountCents:750,revision:current.revision,reason:reasons.credit})
  assert.equal(current.giftCents,2000);assert.equal(current.creditCents,750)
  await page.setViewportSize({width,height:1000});as=h.cookie
  await page.goto(ready.url+'/app#customers')
  await page.getByRole('heading',{name:'Customers',level:1,exact:true}).waitFor()
  const customer=page.getByRole('article',{name:'Customer '+email,exact:true})
  await customer.getByRole('button',{name:'Manage customer',exact:true}).click()
  const merchant=customer.getByRole('region',{name:'Customer balances',exact:true})
  await amount(merchant,'Gift balance').getByText('$20.00',{exact:true}).waitFor()
  await amount(merchant,'Goodwill credit').getByText('$7.50',{exact:true}).waitFor()
  const form=merchant.getByRole('form',{name:'Review balance change',exact:true})
  await form.getByLabel('Balance action',{exact:true}).selectOption('adjust')
  await form.getByLabel('Balance kind',{exact:true}).selectOption('gift')
  await form.getByLabel('Amount · whole USD cents',{exact:true}).fill('137')
  await form.getByLabel('Customer-visible reason',{exact:true}).fill(reasons.adjust)
  await form.getByRole('button',{name:'Review balance change',exact:true}).click()
  const review=merchant.getByRole('region',{name:'Balance change review',exact:true}),approve=review.getByRole('button',{name:'Approve reviewed reduction',exact:true})
  await review.waitFor()
  assert.ok(await approve.isDisabled())
  assert.match(await review.innerText(),/\$20\.00 → \$18\.63/)
  assert.match(await review.innerText(),/137 cents/)
  assert.ok((await review.innerText()).includes(email))
  assert.equal((await balances(email)).giftCents,2000,'review alone cannot reduce value')
  await review.getByRole('checkbox',{name:'I reviewed this exact mailbox, amount and reason and approve this balance entry.',exact:true}).check()
  async function screenshot(label,target) {
   await target.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} overflow at ${width}`)
   await target.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'test-results/customer-balances',`${label}-${width}.png`)})
  }
  await screenshot('CUSTOMER-001-balance-merchant-review',review)
  await approve.click()
  await merchant.getByRole('status').filter({hasText:'The reviewed balance entry is recorded.'}).waitFor()
  await amount(merchant,'Gift balance').getByText('$18.63',{exact:true}).waitFor()
  await amount(merchant,'Goodwill credit').getByText('$7.50',{exact:true}).waitFor()
  const ledger=merchant.getByRole('list',{name:'Balance history',exact:true})
  await ledger.getByText(reasons.adjust,{exact:true}).waitFor()
  assert.equal(await ledger.getByRole('listitem').count(),3)
  await ledger.getByText('Gift balance · -$1.37',{exact:true}).waitFor()
  current=await balances(email)
  assert.equal(current.giftCents,1863);assert.equal(current.creditCents,750)
  assert.equal(current.ledger.filter(entry=>entry.action==='adjust').length,1)
  assert.equal(current.ledger.find(entry=>entry.action==='adjust').amountCents,-137)
  assert.equal(h.messages.length,mailBefore,'native balance changes never send mail')
  await screenshot('CUSTOMER-001-balance-merchant-ledger',merchant)

  as=member;await page.goto(ready.url+'/order')
  const account=page.locator('section').filter({has:page.getByRole('heading',{name:'Gift balances',level:2,exact:true})})
  await amount(account,'Gift balance').getByText('$18.63',{exact:true}).waitFor()
  await amount(account,'Goodwill credit').getByText('$7.50',{exact:true}).waitFor()
  const ownLedger=account.getByRole('list',{name:'Balance history',exact:true})
  assert.equal(await ownLedger.getByRole('listitem').count(),3)
  await ownLedger.getByText(reasons.adjust,{exact:true}).waitFor()
  assert.equal((await h.api(own,undefined,{as:member})).giftCents,1863)
  await screenshot('CUSTOMER-001-balance-own-account',account)

  as=other;await page.goto(ready.url+'/order')
  await amount(account,'Gift balance').getByText('$0.00',{exact:true}).waitFor()
  await amount(account,'Goodwill credit').getByText('$0.00',{exact:true}).waitFor()
  await account.getByText('No gift balance or goodwill credit has been recorded for this mailbox.',{exact:true}).waitFor()
  assert.equal(await account.getByRole('list',{name:'Balance history',exact:true}).count(),0)
  assert.ok(!(await account.innerText()).includes(email));assert.ok(!(await account.innerText()).includes(reasons.gift))
  assert.deepEqual((await h.api(own,undefined,{as:other})).ledger,[])
  await screenshot('CUSTOMER-001-balance-other-account',account)

  await h.command('customer.erase',{email,confirm:'ERASE'})
  await h.api(base,issue,{status:409})
  as=member;await page.goto(ready.url+'/order')
  await amount(account,'Gift balance').getByText('$0.00',{exact:true}).waitFor()
  await amount(account,'Goodwill credit').getByText('$0.00',{exact:true}).waitFor()
  await account.getByText('No gift balance or goodwill credit has been recorded for this mailbox.',{exact:true}).waitFor()
  assert.ok(!(await account.innerText()).includes(reasons.gift));assert.ok(!(await account.innerText()).includes(reasons.adjust))
  assert.deepEqual((await h.api(own,undefined,{as:member})).ledger,[])
  assert.deepEqual((await h.api(own,undefined,{as:other})).ledger,[])
  await screenshot('CUSTOMER-001-balance-erased-account',account)
 }
 assert.deepEqual(journey.errors,[])
 await journey.dev.assertRunning()
 console.log('PASS CUSTOMER-001 reviewed gift and goodwill balances, exact native reduction, mailbox isolation and erasure at 1440 and 390')
} catch(error) {
 journeyError=error
 if(journey?.page){await journey.page.screenshot({path:resolve(process.env.STALL_SCREENSHOTS??'test-results/customer-balances','failure.png'),fullPage:true});if(await journey.page.locator('main').count())console.log('Visible failure:',(await journey.page.locator('main').innerText()).slice(0,4000))}
 throw error
} finally {await journey?.finish(journeyError)}
