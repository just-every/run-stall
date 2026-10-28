import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { startJourney } from './journey-kit.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { deliverWebhook } from '../api/network.mjs'

// MOBILE-001: one essential keyboard journey, plus every current commerce view at both release widths.
const require = createRequire(import.meta.url)
let journey, journeyError
try {
  const stock = volumeStock(['synthetic-stall-1801', 'synthetic-stall-1802'])
  // Simulate only stock-provider dispatches, preserving the provider's original order-line identities.
  const shipments = [], forward = stock.forward
  stock.forward = async request => {
    if (request.method === 'POST') {
      const { type, payload, commandId } = await request.clone().json()
      if (type === 'dispatch.create') {
        const order = stock.orders.get(payload.orderId)
        let shipment = shipments.find(item => item.id === commandId)
        if (!shipment) { shipment = { id: commandId, orderId: order.id, reference: payload.shipmentReference, createdAt: new Date().toISOString(), lines: payload.lines.map(line => ({ ...line, itemId: order.lines.find(original => original.id === line.orderLineId).itemId })) }; shipments.push(shipment) }
        return Response.json({ result: shipment })
      }
    }
    const response = await forward(request)
    if (request.method === 'GET') { const state = await response.json(); return Response.json({ ...state, shipments }) }
    return response
  }
  journey = await startJourney({ name: 'mobile', stock })
  const { h, page, context, ready, edge, secret, capture } = journey
  const email = ['synthetic-stall-1803', 'example.test'].join('@'), member = await h.signIn(email)
  const product = await h.command('product.prepare', { sku: 'synthetic-stall-1800', name: 'Studio tee', description: 'Soft cotton tee', unitCents: 2400, active: true,
    details: { handle: 'studio-tee', options: [{ name: 'Size', values: ['Small', 'Large'] }], variants: [
      { sku: 'synthetic-stall-1801', options: { Size: 'Small' }, unitCents: 2400 },
      { sku: 'synthetic-stall-1802', options: { Size: 'Large' }, unitCents: 2800 }
    ] } })
  await h.command('product.approve', { sku: product.id, revision: product.revision })
  let as = h.cookie
  await context.unroute('**/api/stall/**')
  await context.route('**/api/stall/**', async route => {
    const req = route.request(), url = new URL(req.url())
    const response = await h.request(url.pathname + url.search, { method: req.method(), as, ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await response.arrayBuffer()) })
  })
  async function keyboardTo(target) {
    await target.waitFor()
    for (let step = 0; step < 300; step++) {
      if (await target.evaluate(element => element === document.activeElement)) {
        assert.ok(await target.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 }), 'Keyboard focus must be visible')
        return
      }
      await page.keyboard.press('Tab')
    }
    assert.fail('An essential named control cannot be reached with Tab: ' + await target.getAttribute('aria-label'))
  }
  async function activate(target, key = 'Enter') { await keyboardTo(target); await page.keyboard.press(key) }
  async function type(target, value) { await keyboardTo(target); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(value) }
  const scans = []
  async function scan(name) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(() => document.fonts.ready)
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
      const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
      assert.ok(result.passes.some(rule => rule.id === 'color-contrast'), name + ' must execute contrast checks')
      const failures = result.violations.map(rule => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))
      console.log('WCAG', name, width, JSON.stringify(failures))
      assert.deepEqual(failures, [], `${name} WCAG 2.2 AA at ${width}`)
      scans.push({ name, width, violations: 0 })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await capture(name)
  }
  // Visit every current desk view, including newer reports and customer request pages.
  for (const view of ['orders', 'products', 'shopfront', 'shipping', 'customers', 'requests', 'promotions', 'move-in', 'reports', 'history', 'settings']) {
    await page.goto(ready.url + '/app#' + view)
    await page.locator(`.st-nav a[href="#${view}"][aria-current="page"]`).waitFor()
    await expect(page.getByText('Loading your shop…', { exact: true })).toHaveCount(0)
    await scan('desk-' + view)
  }
  // Modal entry, trapping, Escape and return to the invoking control are keyboard operations.
  await type(page.getByLabel('Customer email', { exact: true }), email)
  const opener = page.getByRole('button', { name: 'Review customer erasure', exact: true })
  await activate(opener)
  const dialog = page.getByRole('dialog', { name: 'Permanently erase customer details?', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Type ERASE to confirm', { exact: true })).toBeFocused()
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog keeps keyboard focus inside') }
  await scan('erasure-dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await page.goto(ready.url + '/shop')
  await page.getByRole('link', { name: 'Choose options for Studio tee', exact: true }).waitFor()
  await scan('storefront')
  await activate(page.getByRole('link', { name: 'Choose options for Studio tee', exact: true }))
  await page.getByRole('heading', { name: 'Studio tee', exact: true }).waitFor()
  await activate(page.getByRole('group', { name: 'Size', exact: true }).getByRole('button', { name: 'Large', exact: true }))
  await expect(page.locator('.st-pdp-price')).toContainText('$28.00')
  await scan('variant')
  await activate(page.getByRole('button', { name: /^Add to basket/ }))
  await activate(page.getByRole('link', { name: 'Review your basket and check out', exact: true }))
  await type(page.getByLabel('Email for your order', { exact: true }), email)
  await activate(page.getByRole('button', { name: 'Review order', exact: true }))
  await expect(page.getByRole('button', { name: 'Pay $28.00 with Stripe', exact: true })).toBeVisible()
  await scan('checkout-review')
  // Real server validation after the reviewed price changes preserves input and creates no payment.
  stock.setAvailable('synthetic-stall-1802', '0')
  await activate(page.getByRole('button', { name: 'Pay $28.00 with Stripe', exact: true }))
  await expect(page.getByRole('alert')).toContainText(/stock|available/i)
  await expect(page.getByRole('alert')).toBeFocused()
  assert.equal(await page.getByLabel('Email for your order', { exact: true }).inputValue(), email)
  assert.equal(edge.sessions.size, 0)
  await scan('checkout-error')
  stock.setAvailable('synthetic-stall-1802', '10')
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await activate(page.getByRole('button', { name: 'Review order', exact: true }))
  await context.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, body: 'Payment provider network edge' }))
  await activate(page.getByRole('button', { name: 'Pay $28.00 with Stripe', exact: true }))
  await page.waitForURL(url => url.hostname === 'checkout.stripe.com')
  assert.equal(edge.sessions.size, 1)
  const session = [...edge.sessions.values()][0]
  assert.equal(session.amount_total, 2800)
  assert.equal((await deliverWebhook(h, secret, edge.pay(session.id))).response.status, 200)
  await page.goto(`${ready.url}/order?checkout=success&orderId=${session.client_reference_id}`)
  await page.getByText('Thank you, your payment is confirmed', { exact: true }).waitFor()
  await expect(page.locator('main')).toContainText('Studio tee — Large')
  await scan('receipt')
  await page.goto(ready.url + '/app')
  await activate(page.locator('#orders .st-order-id').first())
  await type(page.getByLabel('Shipping reference', { exact: true }), 'synthetic-stall-1804')
  await activate(page.getByRole('button', { name: 'Prepare shipping for approval', exact: true }))
  await activate(page.getByRole('button', { name: /Approve shipping · revision/ }))
  await page.getByText('Shipping has been confirmed by Pier.', { exact: true }).waitFor()
  assert.equal(shipments.length, 1)
  await scan('merchant-order')
  as = member
  await page.goto(ready.url + '/order')
  const card = page.getByRole('article', { name: 'Order ' + session.client_reference_id, exact: true })
  await expect(card).toContainText('shipped')
  await expect(card).toContainText('$28.00')
  await scan('account')
  // Current return policy and independently verified customer custody, never a bearer-only write.
  as = h.cookie
  await h.command('return.policy.save', { revision: null, windowDays: 30, condition: 'Unworn', feeCents: 0, returnShipping: 'Contact the shop', finalSaleSkus: [], exchanges: true })
  as = member
  await activate(card.locator('summary', { hasText: 'Returns, exchanges and cancellation' }))
  const form = card.getByRole('form', { name: 'Request help with this order', exact: true })
  await form.getByRole('checkbox', { name: /Studio tee/ }).waitFor()
  await scan('return-request')
  await activate(form.getByRole('checkbox', { name: /Studio tee/ }), 'Space')
  await type(form.getByLabel('Note for the shop (optional)', { exact: true }), 'The large size does not fit.')
  await activate(form.getByRole('button', { name: 'Send request for review', exact: true }))
  await card.getByText('awaiting a person’s review', { exact: false }).waitFor()
  const cases = (await h.api('/api/stall/returns')).cases
  assert.equal(cases.length, 1)
  assert.equal(cases[0].lines[0].sku, 'synthetic-stall-1802')
  as = h.cookie
  await page.goto(ready.url + '/app#requests')
  const request = page.getByRole('article', { name: 'Case ' + cases[0].id, exact: true })
  await type(request.getByLabel('Explanation the shopper will read', { exact: true }), 'Please return the unworn tee for inspection.')
  await activate(request.getByRole('button', { name: /^Accept request/ }))
  await request.getByText('Please return the unworn tee for inspection.', { exact: false }).waitFor()
  await activate(request.getByRole('button', { name: 'Review goods received', exact: true }))
  const receipt = request.getByRole('form', { name: 'Received goods for request ' + cases[0].id, exact: true })
  await expect(receipt.getByRole('button', { name: 'Confirm goods received', exact: true })).toBeDisabled()
  await activate(receipt.getByRole('checkbox'), 'Space')
  await scan('return-receipt-review')
  await activate(receipt.getByRole('button', { name: 'Confirm goods received', exact: true }))
  await request.getByText('Goods received', { exact: false }).waitFor()
  assert.equal((await h.api('/api/stall/returns')).receipts.length, 1)
  assert.equal(edge.refunds.size, 0, 'Receiving goods does not issue a refund')
  await scan('return-processed')
  as = member
  await page.goto(ready.url + '/order')
  await card.getByText('Goods received', { exact: false }).waitFor()
  await scan('customer-return-progress')
  assert.deepEqual(journey.errors, [])
  console.log('PASS MOBILE-001 keyboard purchase, validation recovery, receipt, account, dialog and WCAG scans:', JSON.stringify(scans))
} catch (error) {
  journeyError = error
  if (journey?.page) { await journey.page.screenshot({ path: (process.env.STALL_SCREENSHOTS ?? 'test-results/mobile') + '/failure.png', fullPage: true }); console.error('Failure state:', (await journey.page.locator('main').innerText()).slice(0, 3000)) }
  throw error
} finally { await journey?.finish(journeyError) }
