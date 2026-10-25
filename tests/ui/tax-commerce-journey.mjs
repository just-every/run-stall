import assert from 'node:assert/strict'
import { taxCommerceInstallation,taxAddress } from '../api/tax-commerce.mjs'
import { deliverWebhook } from '../api/network.mjs'
import { startJourney } from './journey-kit.mjs'

let commerce
const kit=await startJourney({name:'tax-commerce',skus:['MUG-BLUE','TOWEL-NAT'],captureFullPage:false,installationFactory:async()=>{
 commerce=await taxCommerceInstallation()
 return {...commerce.h,close:()=>commerce.close()}
}})
let journeyError
try {
 const {page}=kit,{h,tax,stripe}=commerce
 let mode=await h.api('/api/stall/tax/commerce')
 await h.api('/api/stall/tax/commerce',{enabled:false,revision:mode.revision,consent:mode.consent})
 await page.goto(kit.ready.url+'/app#settings')
 await page.getByText('Taxed sales · Off',{exact:true}).click()
 await page.getByRole('button',{name:'Review connected account',exact:true}).click()
 await page.getByLabel('I reviewed this separate taxed-sales authority.').check()
 await page.getByRole('button',{name:'Enable taxed sales',exact:true}).click()
 await page.getByText('Taxed sales · Enabled',{exact:true}).waitFor()
 await kit.capture('tax-sale-authority',page.getByText('Taxed sales · Enabled',{exact:true}).locator('..'))
 await page.goto(kit.ready.url+'/shop')
 await page.getByRole('spinbutton',{name:'Quantity for Blue ceramic mug',exact:true}).fill('2')
 await page.getByRole('spinbutton',{name:'Quantity for Natural linen towel',exact:true}).fill('1')
 await page.getByLabel('Email for your order',{exact:true}).fill('buyer@cedar.example.test')
 const quote=page.getByLabel('Sales tax quote'),disclosure=quote.getByRole('checkbox')
 for(const [label,value] of [['Street address',taxAddress.line1],['City','Austin'],['State','TX'],['ZIP code','78702']])await quote.getByLabel(label,{exact:true}).fill(value)
 await disclosure.check()
 await quote.getByRole('button',{name:'Calculate sales tax',exact:true}).click()
 await quote.getByText('Tax by jurisdiction',{exact:true}).waitFor()
 await quote.getByText(/Travis County/).waitFor()
 await page.getByRole('button',{name:'Review order',exact:true}).click()
 await page.getByRole('heading',{name:'Review your order',exact:true}).waitFor()
 await kit.capture('taxed-checkout-review',page.locator('.st-checkout'))
 await kit.capture('tax-jurisdictions-before-payment',quote.getByText('Tax by jurisdiction',{exact:true}).locator('..'))
 await quote.getByLabel('Street address',{exact:true}).fill('2 synthetic-stall-street')
 assert.equal(await disclosure.isChecked(),false)
 assert.equal(await page.getByRole('button',{name:'Review order',exact:true}).isDisabled(),true)
 await disclosure.check();await quote.getByRole('button',{name:'Calculate sales tax',exact:true}).click()
 await quote.getByText('Tax by jurisdiction',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Review order',exact:true}).click()
 await page.route('https://checkout.stripe.com/**',route=>route.abort())
 const hosted=page.waitForRequest(request=>request.url().startsWith('https://checkout.stripe.com/'))
 await page.getByRole('button',{name:/^Pay .* with Stripe$/}).click();await hosted
 const pending=(await h.api('/api/stall/state')).orders[0],session=[...stripe.sessions.values()].find(s=>s.client_reference_id===pending.id)
 assert.ok(session);assert.equal(session.amount_total,pending.totalCents)
 tax.transactionTime=Date.parse('2026-02-01T05:59:00Z')/1000
 stripe.pay(session.id,{...taxAddress,line1:'2 synthetic-stall-street'})
 assert.equal((await deliverWebhook(h,commerce.secret,session)).response.status,200)
 await commerce.buy(await commerce.quote({destination:{...taxAddress,state:'CA',city:'Los Angeles',postal_code:'90013'}}))
 await commerce.ship(pending.id)
 await page.goto(kit.ready.url+'/app#orders/'+pending.id)
 let panel=page.getByRole('complementary',{name:'Order '+pending.id.slice(0,8)})
 await page.getByText('Sales tax',{exact:true}).waitFor()
 panel=page.locator('.st-order-panel')
 await kit.capture('paid-tax-order',panel)
 await panel.getByText('Tax calculation and transaction',{exact:true}).click()
 await kit.capture('paid-order-tax-references',panel.getByText('Tax calculation and transaction',{exact:true}).locator('..'))
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000})
  const next=panel.getByRole('button',{name:'Next order',exact:true}),control=await next.isEnabled()?next:panel.getByRole('button',{name:'Previous order',exact:true}),label=await control.getAttribute('aria-label')
  await control.focus();assert.equal(await page.getByRole('tooltip',{name:label,exact:true}).isVisible(),true)
  await control.blur();await control.hover();await page.waitForTimeout(350);assert.equal(await page.getByRole('tooltip',{name:label,exact:true}).isVisible(),true)
  await page.screenshot({path:`${process.env.STALL_SCREENSHOTS??'test-results/tax-commerce'}/order-tooltip-${width}.png`,fullPage:true})
 }
 await page.setViewportSize({width:1440,height:1000})
 await panel.getByText('Prepare a refund',{exact:true}).click()
 await panel.getByLabel('Order line',{exact:true}).selectOption('MUG-BLUE')
 await panel.getByLabel('Refund quantity',{exact:true}).fill('1')
 await panel.getByLabel('Reason',{exact:true}).fill('One returned ceramic mug')
 await panel.getByText(/Includes .* sales tax from the original purchase/).waitFor()
 await kit.capture('partial-tax-refund-review',panel)
 await panel.getByRole('button',{name:'Prepare refund',exact:true}).click()
 tax.transactionTime=Date.parse('2026-02-01T06:01:00Z')/1000
 await panel.getByRole('button',{name:/^Approve .* refund · revision/}).click()
 await panel.getByText(/Tax refunded:/).waitFor()
 await kit.capture('tax-refund-recorded',panel)
 await page.goto(kit.ready.url+'/app#settings')
 const reports=page.locator('#tax-reports')
 await reports.getByLabel('From',{exact:true}).fill('2026-01-01')
 await reports.getByLabel('To, exclusive',{exact:true}).fill('2026-03-01')
 await reports.getByRole('button',{name:'Show reports',exact:true}).click()
 await reports.getByRole('table',{name:'States, split by sales channel'}).waitFor()
 await reports.getByRole('button',{name:'TX',exact:true}).click()
 await reports.getByRole('table',{name:'Contributing transactions'}).waitFor()
 await kit.capture('tax-liability-and-nexus',reports)
 const row=reports.getByRole('table',{name:'Contributing transactions'}).getByRole('link').first()
 await row.click();await page.locator('.st-order-panel').waitFor()
 assert.deepEqual(kit.errors,[])
 console.log('TAX-001 owner enablement, jurisdictional checkout, paid order, partial tax refund, filing reports, drilldown and tooltips at 1440 and 390 passed')
}catch(error){journeyError=error;await kit.page.screenshot({path:`${process.env.STALL_SCREENSHOTS??'test-results/tax-commerce'}/failure.png`,fullPage:false});throw error}
finally{await kit.finish(journeyError)}
