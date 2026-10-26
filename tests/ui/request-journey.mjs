import assert from 'node:assert/strict'
import { startJourney } from './journey-kit.mjs'
import { pierInstallation } from '../api/pier.mjs'
import { purchase, deliverWebhook, sendFile, solidPng } from '../api/network.mjs'

// RETURN-001 through the real policy form, account and private-link order pages and the staff request list.
let journey, journeyError
try {
  journey = await startJourney({ name: 'requests', skus: ['MUG-BLUE', 'TOWEL-NAT'], stock: await pierInstallation() })
  const { h, page, ready, edge, secret, capture } = journey
  await h.command('product.prepare', { sku: 'WARE', name: 'Stoneware', description: 'Hand thrown', unitCents: 2450, active: true, details: { options: [{ name: 'Size', values: ['Small', 'Large'] }], variants: [{ sku: 'MUG-BLUE', options: { Size: 'Small' } }, { sku: 'TOWEL-NAT', options: { Size: 'Large' } }] } })
  await h.command('product.approve', { sku: 'WARE', revision: (await h.api('/api/stall/state')).products.find(p => p.id === 'WARE').revision })
  const email = 'synthetic-stall-901@example.test', ana = await h.signIn(email), other = await h.signIn('synthetic-stall-902@example.test')
  const paid = async (skus, quantities) => { const bought = await purchase(h, edge, { skus, quantities, email }); await deliverWebhook(h, secret, edge.pay(bought.session.id)); return bought.orderId }
  const shipped = await paid(['MUG-BLUE'], [3]), unsent = await paid(['MUG-BLUE'], [1]), towels = await paid(['TOWEL-NAT'], [1])
  for (const id of [shipped, towels]) {
    let o = (await h.api('/api/stall/state')).orders.find(x => x.id === id)
    o = await h.command('shipment.prepare', { orderId: id, revision: o.revision, reference: 'synthetic-stall-910' }); await h.command('shipment.approve', { orderId: id, revision: o.revision })
    await h.api('/api/stall/state')
  }
  const before = (await h.api('/api/stall/state')).orders.find(o => o.id === shipped)
  let as = h.cookie
  await journey.context.unroute('**/api/stall/**')
  await journey.context.route('**/api/stall/**', async route => {
    const req = route.request(), url = new URL(req.url())
    const headers = Object.fromEntries(Object.entries(req.headers()).filter(([name]) => name === 'x-stall-order-token')), raw = req.postDataBuffer(), type = req.headers()['content-type'] ?? ''
    const response = raw && !type.startsWith('application/json') ? await sendFile(h, url.pathname + url.search, raw, type, { as, headers }) : await h.request(url.pathname + url.search, { method: req.method(), as, headers, ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await response.arrayBuffer()) })
  })
  // The owner publishes the policy in Settings.
  await page.goto(ready.url + '/app#settings'); await page.reload()
  const policy = page.getByRole('form', { name: 'Return policy', exact: true })
  await policy.getByLabel('Return window in days after dispatch', { exact: true }).fill('30')
  await policy.getByLabel('Return fee in USD (shown to shoppers)', { exact: true }).fill('5')
  await policy.getByLabel('Final-sale SKUs, separated by commas', { exact: true }).fill('TOWEL-NAT')
  const saved = page.waitForResponse(r => r.url().endsWith('/api/stall/commands')); await policy.getByRole('button', { name: 'Save return policy', exact: true }).click(); assert.ok((await saved).ok())
  await capture('RETURN-001-policy-settings', policy)
  // The account customer asks for an exchange, a cancellation and is refused a final-sale return.
  as = ana; await page.goto(ready.url + '/order'); await page.reload()
  const card = id => page.getByRole('article', { name: `Order ${id}`, exact: true })
  await card(shipped).getByText('Returns, exchanges and cancellation', { exact: true }).click()
  const panel = page.getByLabel(`Returns and exchanges for order ${shipped}`, { exact: true })
  await panel.getByText('Return window: 30 days from dispatch', { exact: false }).waitFor()
  assert.ok((await panel.innerText()).includes('TOWEL-NAT cannot be returned or exchanged'))
  await capture('RETURN-001-policy-explained', panel)
  const form = panel.getByRole('form', { name: 'Request help with this order', exact: true })
  await form.getByLabel('Request kind', { exact: true }).selectOption('exchange')
  await form.getByRole('checkbox', { name: /Stoneware — Small/ }).check()
  await form.getByLabel('Reason', { exact: true }).selectOption('wrong_size')
  await form.getByLabel('Replacement', { exact: true }).selectOption('TOWEL-NAT')
  await form.getByLabel('Note for the shop (optional)', { exact: true }).fill('Small is too small for my shelf')
  await form.getByLabel('Photos (optional)', { exact: true }).setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: solidPng(40, 30, [120, 90, 60]) })
  await form.getByText('Attached: shelf.png.', { exact: false }).waitFor()
  const send = async () => { const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stall/returns/requests'); await form.getByRole('button', { name: 'Send request for review', exact: true }).click(); const done = await response; assert.ok(done.ok(), await done.text()); return done.json() }
  const first = await send(); assert.equal(first.duplicate, false)
  await panel.getByText('awaiting a person’s review', { exact: false }).waitFor()
  await panel.getByRole('button', { name: 'View photo shelf.png' }).waitFor()
  await capture('RETURN-001-exchange-requested', panel)
  await card(unsent).getByText('Returns, exchanges and cancellation', { exact: true }).click()
  const cancelPanel = page.getByLabel(`Returns and exchanges for order ${unsent}`, { exact: true }), cancelForm = cancelPanel.getByRole('form', { name: 'Request help with this order', exact: true })
  await cancelForm.getByLabel('Request kind', { exact: true }).selectOption('cancellation')
  await cancelForm.getByRole('button', { name: 'Send request for review', exact: true }).click()
  await cancelPanel.getByText('Request received.', { exact: false }).first().waitFor()
  await card(towels).getByText('Returns, exchanges and cancellation', { exact: true }).click()
  const towelPanel = page.getByLabel(`Returns and exchanges for order ${towels}`, { exact: true })
  await towelPanel.getByText('Final sale: this item cannot be returned or exchanged.', { exact: true }).waitFor()
  assert.equal(await towelPanel.getByRole('checkbox').first().isDisabled(), true)
  await capture('RETURN-001-final-sale', towelPanel)
  // A private order link reaches one order; another signed-in customer sees nothing of it.
  const link = await h.api('/api/stall/account/guest-order-link', { orderId: shipped }, { as: ana })
  as = ''; await page.goto(ready.url + '/order#orderLink=' + link.token)
  await page.getByRole('heading', { name: 'Your guest order', exact: true }).waitFor()
  // The order already has a request, so its help opens by itself.
  const guestPanel = page.getByLabel(`Returns and exchanges for order ${shipped}`, { exact: true }), guestForm = guestPanel.getByRole('form', { name: 'Request help with this order', exact: true })
  await guestPanel.getByText('awaiting a person’s review', { exact: false }).waitFor()
  await guestForm.getByRole('checkbox', { name: /Stoneware — Small/ }).check()
  await guestForm.getByLabel('Quantity', { exact: true }).fill('2'); await guestForm.getByLabel('Reason', { exact: true }).selectOption('defective')
  const guestSend = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stall/returns/requests'); await guestForm.getByRole('button', { name: 'Send request for review', exact: true }).click(); assert.ok((await guestSend).ok())
  await guestPanel.getByText('Return request', { exact: false }).first().waitFor()
  await capture('RETURN-001-guest-requested', guestPanel)
  as = other; await page.goto(ready.url + '/order'); await page.reload()
  await page.getByText('No orders are recorded for this verified email.', { exact: true }).waitFor()
  assert.ok(!(await page.locator('main').innerText()).includes('Stoneware'))
  // The owner decides each request with an explanation.
  as = h.cookie; await page.goto(ready.url + '/app#requests'); await page.reload()
  await page.getByRole('heading', { name: 'Customer requests', exact: true, level: 1 }).waitFor()
  const cases = (await h.api('/api/stall/returns')).cases; assert.equal(cases.length, 3)
  const exchange = cases.find(c => c.kind === 'exchange'), refund = cases.find(c => c.kind === 'return')
  await capture('RETURN-001-staff-queue', page.getByRole('region', { name: 'Return, exchange and cancellation requests', exact: true }))
  const decide = async (item, button, text) => {
    const article = page.getByRole('article', { name: `Case ${item.id}`, exact: true })
    await article.getByLabel('Explanation the shopper will read', { exact: true }).fill(text)
    const response = page.waitForResponse(r => r.url().endsWith('/api/stall/commands')); await article.getByRole('button', { name: new RegExp('^' + button) }).click(); assert.ok((await response).ok())
    await article.getByText(text, { exact: false }).waitFor()
  }
  await page.getByRole('article', { name: `Case ${exchange.id}`, exact: true }).getByRole('button', { name: 'View photo shelf.png' }).waitFor()
  await decide(exchange, 'Accept request', 'We have set the large size aside for you.')
  await decide(refund, 'Refuse request', 'The glaze matches the listing, so this is outside our policy.')
  await capture('RETURN-001-staff-decided', page.getByRole('region', { name: 'Return, exchange and cancellation requests', exact: true }))
  // Customers read the decision and progress; nothing about the order, money or stock moved.
  as = ana; await page.goto(ready.url + '/order'); await page.reload()
  await card(shipped).getByText('Returns, exchanges and cancellation', { exact: true }).waitFor()
  const mine = page.getByLabel(`Returns and exchanges for order ${shipped}`, { exact: true })
  await mine.getByText('We have set the large size aside for you.', { exact: false }).waitFor()
  await mine.getByText('Nothing is charged or refunded by this step.', { exact: false }).waitFor()
  await capture('RETURN-001-account-decided', mine)
  as = ''; await page.goto(ready.url + '/order#orderLink=' + link.token)
  await page.getByText('The glaze matches the listing, so this is outside our policy.', { exact: false }).waitFor()
  await capture('RETURN-001-guest-refused', page.getByLabel(`Returns and exchanges for order ${shipped}`, { exact: true }))
  assert.deepEqual((await h.api('/api/stall/state')).orders.find(o => o.id === shipped), before)
  assert.deepEqual(journey.errors, [])
  await journey.dev.assertRunning()
  console.log('PASS RETURN-001 policy, account and private-link requests, explained decisions and progress at 1440 and 390')
} catch (error) { journeyError = error; if (journey?.page) { await journey.page.screenshot({ path: (process.env.STALL_SCREENSHOTS ?? 'test-results/requests') + '/failure.png', fullPage: true }); console.log('Visible failure:', (await journey.page.locator('main').innerText()).slice(0, 4000)) } throw error }
finally { await journey?.finish(journeyError) }
