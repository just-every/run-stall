import assert from 'node:assert/strict'
import { installation } from '../api/harness.mjs'
import { taxEdge } from '../api/tax-edge.mjs'
import { stripeEdge } from '../api/network.mjs'
import { startJourney } from './journey-kit.mjs'

let tax
const kit=await startJourney({name:'tax-settings',skus:['LINEN-TEE','GIFT-PAPER'],installationFactory:async kit=>{
 tax=taxEdge();const stripe=stripeEdge({forward:kit.stock.forward})
 return installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-stock',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-806',STRIPE_WEBHOOK_SECRET:'synthetic-stall-webhook'},outboundService:request=>new URL(request.url).hostname==='api.stripe.com'&&(/^\/v1\/tax\//.test(new URL(request.url).pathname)||new URL(request.url).pathname==='/v1/account')?tax.handle(request):stripe.handle(request)})
}})
let journeyError
try {
 const {page}=kit
 await page.goto(kit.ready.url+'/app#settings')
 await page.getByRole('heading',{name:'Tax settings',exact:true}).waitFor()
 const settings=page.locator('#tax-settings'),form=settings.getByRole('form',{name:'Tax ship-from address'})
 await settings.getByText('Ship-from address',{exact:true}).click()
 await form.getByLabel('Street address',{exact:true}).fill('1200 Cedar Avenue')
 await form.getByLabel('City',{exact:true}).fill('Austin')
 await form.getByLabel('State',{exact:true}).fill('TX')
 await form.getByLabel('ZIP code',{exact:true}).fill('78702')
 await form.getByLabel('ZIP code',{exact:true}).press('Tab')
 await page.waitForFunction(()=>document.querySelector('#tax-settings [role="status"]')?.textContent==='Saved')
 assert.equal((await kit.h.api('/api/stall/tax/configuration')).shipFrom.line1,'1200 Cedar Avenue')
 await settings.getByText('Product tax codes · 0',{exact:true}).click()
 await settings.getByRole('button',{name:'Add SKU tax code',exact:true}).click()
 await settings.getByLabel('Tax code SKU 1',{exact:true}).fill('LINEN-TEE')
 await settings.getByLabel('Product tax code 1',{exact:true}).fill('txcd_99999999')
 await settings.getByLabel('Product tax code 1',{exact:true}).press('Tab')
 await page.waitForFunction(()=>document.querySelector('#tax-settings [role="status"]')?.textContent==='Saved')
 await settings.getByText('Economic nexus thresholds · 0',{exact:true}).click()
 await settings.getByRole('button',{name:'Add state threshold',exact:true}).click()
 await settings.getByLabel('Threshold state 1',{exact:true}).fill('TX')
 await settings.getByLabel('Sales threshold · USD cents 1',{exact:true}).fill('10000000')
 await settings.getByLabel('Transaction threshold 1',{exact:true}).fill('200')
 await settings.getByLabel('Transaction threshold 1',{exact:true}).press('Tab')
 await page.waitForFunction(()=>document.querySelector('#tax-settings [role="status"]')?.textContent==='Saved')
 const evidence=settings.locator('form[aria-label="New exemption evidence"]')
 await evidence.getByLabel('Customer email',{exact:true}).fill('buyer@cedar.example.test')
 await evidence.getByLabel('Jurisdiction state',{exact:true}).fill('TX')
 await evidence.getByLabel('Evidence reference or document name',{exact:true}).fill('Resale certificate Cedar 2026-18')
 await evidence.getByLabel('Evidence expires on',{exact:true}).fill('2035-12-31')
 await evidence.getByLabel('Evidence expires on',{exact:true}).press('Tab')
 await evidence.getByText('Saved',{exact:true}).waitFor()
 assert.equal((await kit.h.api('/api/stall/tax/exemptions')).total,1)
 await kit.capture('saved-tax-settings',settings)
 await settings.getByText('Connected Stripe Tax readiness',{exact:true}).click()
 await settings.getByRole('button',{name:'Check Stripe Tax readiness',exact:true}).click()
 await settings.getByText(/CA.*TX/).last().waitFor()
 await settings.getByText('Address-level tax preview',{exact:true}).click()
 await settings.getByRole('button',{name:'Read connected preview boundary',exact:true}).click()
 await settings.getByText(/Connected account: acct_syntheticstall806/).waitFor()
 for(const [label,value] of [['Destination street address','1 synthetic-stall-street'],['Destination city','Austin'],['Destination state','TX'],['Destination zip code','78702']])await settings.getByLabel(label,{exact:true}).fill(value)
 await settings.getByLabel('Preview line reference 1',{exact:true}).fill('LINEN-TEE')
 await settings.getByLabel('Preview unit cents 1',{exact:true}).fill('2500')
 await settings.getByLabel('Preview product tax code 1',{exact:true}).fill('txcd_99999999')
 await settings.locator('input[name="tax-preview-consent"]').check()
 await settings.getByRole('button',{name:'Request tax preview',exact:true}).click()
 await settings.getByLabel('Tax preview observation').waitFor()
 await kit.capture('tax-preview',settings)
 tax.ready=false
 await settings.getByRole('button',{name:'Check Stripe Tax readiness',exact:true}).click()
 await settings.getByText(/Finish Stripe Tax head office/).waitFor()
 await kit.capture('tax-configuration-refusal',settings)
 const account=page.getByRole('button',{name:/^Account menu for /})
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await account.focus()
  assert.equal(await page.getByRole('tooltip',{name:'Account menu',exact:true}).isVisible(),true)
  await account.blur();await account.hover();await page.waitForTimeout(350)
  assert.equal(await page.getByRole('tooltip',{name:'Account menu',exact:true}).isVisible(),true)
  await page.screenshot({path:`${process.env.STALL_SCREENSHOTS??'test-results/tax-settings'}/account-tooltip-${width}.png`,fullPage:true})
 }
 assert.deepEqual(kit.errors,[])
 console.log('TAX-001 saved configuration, exemption evidence, consented preview, refusal and tooltips at 1440 and 390 passed')
}catch(error){journeyError=error}
finally{await kit.finish(journeyError)}
