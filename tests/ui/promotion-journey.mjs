import assert from 'node:assert/strict'
import { pierInstallation } from '../api/pier.mjs'
import { startJourney } from './journey-kit.mjs'
import { resolve } from 'node:path'
import { publish, deliverWebhook } from '../api/network.mjs'

// PROMO-001's existing free-shipping slice through the actual desk and checkout.
let journey, journeyError
try {
  journey = await startJourney({ name: 'promotions', skus: ['MUG-BLUE'], stock: await pierInstallation() })
  const { h, page, ready, edge, secret, capture } = journey
  await publish(h, 'MUG-BLUE', 'Blue ceramic mug', 2450)
  await h.command('shipping.configure', { shippingCents: 625 })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(ready.url + '/app#promotions')
    await page.getByRole('heading', { name: 'Promotions', level: 1 }).waitFor()
    if (width === 1440) await capture('PROMO-001-empty')
    const account = page.getByRole('button', { name: /^Account menu for/ }), tooltip = page.getByRole('tooltip', { includeHidden: true })
    await account.focus(); await tooltip.waitFor({ state: 'visible' }); assert.equal(await tooltip.textContent(), 'Account menu')
    await page.screenshot({ path: resolve(process.env.STALL_SCREENSHOTS ?? './test-results/promotions', `PROMO-001-tooltip-focus-${width}.png`) })
    await account.evaluate(element => element.blur()); await page.mouse.move(0, 0); await tooltip.waitFor({ state: 'hidden' })
    await account.hover(); assert.equal(await tooltip.isVisible(), false, 'hover tooltip waits before appearing')
    await tooltip.waitFor({ state: 'visible' });
    await page.screenshot({ path: resolve(process.env.STALL_SCREENSHOTS ?? './test-results/promotions', `PROMO-001-tooltip-hover-${width}.png`) })
    await page.mouse.move(0, 0)

    await page.getByRole('button', { name: 'New promotion', exact: true }).click()
    const form = page.getByRole('form', { name: 'New promotion', exact: true }), code = `SYNTHETIC-STALL-${width}`
    await form.getByLabel('Code', { exact: true }).fill(code)
    await form.getByLabel('Starts at · UTC', { exact: true }).fill(new Date(Date.now() - 3600000).toISOString().slice(0, 16))
    await form.getByLabel('Ends at · UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16))
    await form.getByLabel('Minimum merchandise subtotal · USD', { exact: true }).fill('50.00')
    await form.getByLabel('Total shipping discount budget · USD', { exact: true }).fill('12.50')
    await capture(`PROMO-001-editor-${width}`, form)
    const save = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stall/promotions' && r.request().method() === 'POST')
    await form.getByRole('button', { name: 'Save promotion', exact: true }).click()
    const saved = await save; assert.ok(saved.ok(), await saved.text()); const { id } = await saved.json()
    await page.getByText('Promotion saved. The current limits and usage are shown.', { exact: true }).waitFor()
    const card = page.getByRole('article', { name: `Promotion ${id}`, exact: true })
    await card.getByText('Minimum basket: $50.00', { exact: false }).waitFor()
    await card.getByRole('button', { name: 'Edit promotion', exact: true }).click()
    await page.getByRole('form', { name: 'Edit promotion', exact: true }).getByLabel('Minimum merchandise subtotal · USD', { exact: true }).fill('20.00')
    const updated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stall/promotions' && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Save promotion', exact: true }).click(); assert.ok((await updated).ok())
    await card.getByText('Minimum basket: $20.00', { exact: false }).waitFor()
    await page.goto(ready.url + '/shop')
    await page.getByLabel('Quantity for Blue ceramic mug', { exact: true }).fill('1')
    await page.getByLabel('Email for your order', { exact: true }).fill(`synthetic-stall-${width}@example.test`)
    const codeInput = page.getByRole('textbox', { name: 'Promotion code', exact: true })
    await codeInput.fill('SYNTHETIC-STALL-UNKNOWN')
    await page.getByRole('button', { name: 'Apply code', exact: true }).click()
    await page.getByText('This promotion code is not available.', { exact: true }).waitFor()
    assert.ok(await page.getByRole('button', { name: 'Review order', exact: true }).isDisabled())
    await capture(`PROMO-001-refused-${width}`, page.locator('.st-checkout'))
    await page.setViewportSize({ width, height: 1000 })
    await codeInput.fill(code); await page.getByRole('button', { name: 'Apply code', exact: true }).click()
    await page.getByText('Free shipping applies. Availability is reserved when you create checkout.', { exact: true }).waitFor()
    assert.equal((await h.api('/api/stall/promotions')).promotions.find(p => p.id === id).reservedUses, 0)
    // A changed quantity invalidates the old quote and prevents paying its total.
    await page.getByLabel('Quantity for Blue ceramic mug', { exact: true }).fill('2')
    assert.ok(await page.getByRole('button', { name: 'Review order', exact: true }).isDisabled())
    assert.equal(await page.getByText('Promotion · free shipping', { exact: true }).count(), 0)
    await page.getByLabel('Quantity for Blue ceramic mug', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Apply code', exact: true }).click()
    await page.getByText('Promotion · free shipping', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Review order', exact: true }).click()
    await page.getByRole('button', { name: 'Pay $24.50 with Stripe', exact: true }).waitFor()
    await capture(`PROMO-001-review-${width}`, page.locator('.st-checkout'))
    await page.setViewportSize({ width, height: 1000 })
    // Lose the provider response after its commit; the UI retains its original checkout identity.
    edge.loseNextCheckoutResponse()
    await page.getByRole('button', { name: 'Pay $24.50 with Stripe', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: /Stripe/ }).waitFor()
    const before = edge.sessions.size
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, body: 'Synthetic provider checkout' }))
    await page.getByRole('button', { name: 'Pay $24.50 with Stripe', exact: true }).click()
    await page.waitForURL('https://checkout.stripe.com/**')
    assert.equal(edge.sessions.size, before, 'UI retry reuses one provider checkout')
    const session = [...edge.sessions.values()].at(-1)
    assert.equal(session.amount_total, 2450); assert.equal(session.total_details.amount_shipping, 0)
    assert.equal((await deliverWebhook(h, secret, edge.pay(session.id))).response.status, 200)
    await page.goto(ready.url + '/app#promotions')
    const paidCard = page.getByRole('article', { name: `Promotion ${id}`, exact: true })
    await paidCard.getByText('Reserved: 0 ($0.00) · Paid: 1 ($6.25)', { exact: true }).waitFor()
    await capture(`PROMO-001-paid-${width}`, paidCard)
    await paidCard.getByRole('button', { name: 'View usage report', exact: true }).click()
    const report = paidCard.getByRole('region', { name: 'Promotion usage report', exact: true })
    await report.getByText('1 total · 0 reserved · 1 paid', { exact: true }).waitFor()
    await report.locator('summary').click()
    await report.getByText('promotion.redeemed.' + session.client_reference_id, { exact: true }).waitFor()
    await report.getByText('No tax was calculated for these orders.', { exact: false }).waitFor()
    assert.equal(await report.locator('dt').filter({ hasText: /^Gross paid$/ }).locator('..').locator('dd').textContent(), '$24.50')
    await capture(`PROMO-001-report-${width}`, report)
    let current = (await h.api('/api/stall/state')).orders.find(order => order.id === session.client_reference_id)
    current = await h.command('shipment.prepare', { orderId: current.id, revision: current.revision, reference: `synthetic-stall-${width}-report` })
    current = await h.command('shipment.approve', { orderId: current.id, revision: current.revision })
    let refunded = await h.command('refund.prepare', { orderId: current.id, revision: current.revision, kind: 'goodwill', amountCents: 500, reason: 'Partial refund in the promotion report' })
    refunded = await h.command('refund.approve', { orderId: refunded.id, revision: refunded.revision })
    await report.getByRole('button', { name: 'Refresh usage report', exact: true }).click()
    await report.locator('dt').filter({ hasText: /^Net paid$/ }).locator('..').getByText('$19.50', { exact: true }).waitFor()
    assert.equal(await report.locator('dt').filter({ hasText: /^Consumed budget$/ }).locator('..').locator('dd').textContent(), '$6.25')
    await capture(`PROMO-001-refund-report-${width}`, report)

    await page.setViewportSize({ width, height: 1000 })
    page.once('dialog', dialog => dialog.accept())
    await paidCard.getByRole('button', { name: 'Revoke promotion', exact: true }).click()
    await paidCard.getByText('Revoked', { exact: false }).waitFor()
    await capture(`PROMO-001-revoked-${width}`, paidCard)
  }
  // Additional campaign behavior asserts at the desktop width; capture records both release widths.
  await page.setViewportSize({width:1440,height:1000})
  await h.command('collection.save',{handle:'synthetic-stall-ui-mugs',title:'Mugs',description:'Selected mugs',kind:'manual',skus:['MUG-BLUE']})
  const scenarios=[
    {type:'product',benefit:'amount',value:'3.33',target:'product SKUs',targetValue:'MUG-BLUE',quantity:1,total:'27.42'},
    {type:'product',benefit:'percentage',value:'10',target:'collection handles',targetValue:'synthetic-stall-ui-mugs',quantity:1,total:'28.30'},
    {type:'order',benefit:'amount',value:'1.01',quantity:1,total:'29.74'},
    {type:'buy_get',benefit:'percentage',value:'100',quantity:2,total:'30.75'},
    {type:'buy_get',benefit:'amount',value:'5.00',spend:'24.50',quantity:2,total:'50.25'},
    {type:'shipping',quantity:3,minimum:'50.00',total:'73.50'},
  ]
  let campaignNumber=0
  for(const mode of ['code','automatic'])for(const scenario of scenarios){
    const code='SYNTHETIC-STALL-UI-'+(++campaignNumber)
    await page.goto(ready.url+'/app#promotions');await page.getByRole('button',{name:'New promotion',exact:true}).click()
    const form=page.getByRole('form',{name:'New promotion',exact:true})
    await form.getByLabel('Application',{exact:true}).selectOption(mode);await form.getByLabel('Discount type',{exact:true}).selectOption(scenario.type)
    if(mode==='code')await form.getByLabel('Code',{exact:true}).fill(code)
    await form.getByLabel('Starts at · UTC',{exact:true}).fill('2000-01-01T00:00');await form.getByLabel('Ends at · UTC',{exact:true}).fill('2100-01-01T00:00')
    await form.getByLabel('Minimum merchandise subtotal · USD',{exact:true}).fill(scenario.minimum??'0')
    if(scenario.benefit){await form.getByLabel('Benefit type',{exact:true}).selectOption(scenario.benefit);await form.getByLabel(scenario.benefit==='amount'?'Amount off · USD':'Percentage off',{exact:true}).fill(scenario.value)}
    if(scenario.target)await form.getByLabel('Eligible items · '+scenario.target,{exact:true}).fill(scenario.targetValue)
    if(scenario.type==='buy_get'){
      await form.getByLabel('Reward items · product SKUs',{exact:true}).fill('MUG-BLUE');await form.getByLabel('Qualifying items · product SKUs',{exact:true}).fill('MUG-BLUE')
      if(scenario.spend){await form.getByLabel('Buy quantity',{exact:true}).fill('0');await form.getByLabel('Buy spend · USD',{exact:true}).fill(scenario.spend)}
      if(campaignNumber===4){await form.locator('summary').filter({hasText:'Eligibility and combinations'}).click();await capture('PROMO-001-campaign-editor',form)}
    }
    const savedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/stall/promotions'&&r.request().method()==='POST')
    await form.getByRole('button',{name:'Save promotion',exact:true}).click();const response=await savedResponse;assert.ok(response.ok(),await response.text());const saved=await response.json()
    const savedRule=(await h.api('/api/stall/promotions')).promotions.find(p=>p.id===saved.id);assert.equal(savedRule.rule.type,scenario.type);assert.equal(savedRule.rule.mode,mode)
    if(campaignNumber===1){
      const card=page.getByRole('article',{name:'Promotion '+saved.id,exact:true});await card.locator('summary').filter({hasText:'Single-use code batch'}).click();await card.getByLabel('Number of unique codes',{exact:true}).fill('2');await card.getByRole('button',{name:'Generate single-use codes',exact:true}).click()
      const downloadEvent=page.waitForEvent('download');await card.getByRole('link',{name:'Download code CSV',exact:true}).click();const download=await downloadEvent
      const {readFile}=await import('node:fs/promises'),{readCsv}=await import('../api/csv-reader.mjs'),rows=readCsv(await readFile(await download.path(),'utf8'));assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.code)).size,2)
    }
    await page.goto(ready.url+'/shop');await page.getByLabel('Quantity for Blue ceramic mug',{exact:true}).fill(String(scenario.quantity));await page.getByLabel('Email for your order',{exact:true}).fill('synthetic-stall-ui-'+campaignNumber+String.fromCharCode(64)+'example.test')
    if(mode==='code'){await page.getByRole('textbox',{name:'Promotion code',exact:true}).fill(code);await page.getByRole('button',{name:'Apply code',exact:true}).click()}
    await page.getByText(scenario.type==='shipping'?'Promotion · free shipping':'Promotion · merchandise',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Review order',exact:true}).click();await page.getByRole('button',{name:'Pay $'+scenario.total+' with Stripe',exact:true}).waitFor()
    if(campaignNumber===9)await capture('PROMO-001-automatic-checkout',page.locator('.st-checkout'))
    await h.api('/api/stall/promotions/revoke',saved)
  }
  await page.goto(ready.url+'/app#promotions');await page.locator('summary').filter({hasText:'Combined campaign report'}).click()
  const combined=page.getByLabel('Combined campaign report',{exact:true});await combined.getByRole('button',{name:'Refresh campaign report',exact:true}).click()
  await combined.getByText('2 unique orders · 2 paid · 0 fulfillment canceled',{exact:true}).waitFor();assert.equal(await combined.locator('dt').filter({hasText:/^Consumed discounts$/}).locator('..').locator('dd').textContent(),'$12.50');assert.equal(await combined.locator('dt').filter({hasText:/^Net paid$/}).locator('..').locator('dd').textContent(),'$39.00');await capture('PROMO-001-combined-report',combined)

  const site = await journey.context.newPage()
  for (const [path, label] of [['/docs/headless-api', 'guide'], ['/contract', 'contract']]) {
    assert.equal((await site.goto(ready.siteUrl + path)).status(), 200)
    for (const width of [1440, 390]) {
      await site.setViewportSize({ width, height: 1000 })
      const target = path === '/contract' ? site.getByRole('row').filter({ hasText: 'Discounts, automatic promotions and controlled budgets' }) : site.locator('main')
      await target.scrollIntoViewIfNeeded()
      assert.ok(await site.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await site.screenshot({ path: resolve(process.env.STALL_SCREENSHOTS ?? './test-results/promotions', `PROMO-001-${label}-${width}.png`) })
    }
  }
  await site.close()
  assert.deepEqual(journey.errors, [])
  await journey.dev.assertRunning()
  console.log('PASS PROMO-001 campaign types, automatic checkout, unique-code CSV and combined reports; free-shipping desk and checkout at 1440 and 390')
} catch (error) { journeyError = error; if (journey?.page) { await journey.page.screenshot({ path: (process.env.STALL_SCREENSHOTS ?? './test-results/promotions') + '/failure.png', fullPage: true }); console.log('Visible failure:', (await journey.page.locator('main').innerText()).slice(0, 4000)) } throw error }
finally { await journey?.finish(journeyError) }
