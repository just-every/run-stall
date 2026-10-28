import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { startJourney } from './journey-kit.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { deliverWebhook, sendFile, solidPng } from '../api/network.mjs'

// MOBILE-001: one essential keyboard journey, plus every current commerce view at both release widths.
const require = createRequire(import.meta.url)
let journey, journeyError
try {
  const stock = volumeStock(['synthetic-stall-1801', 'synthetic-stall-1802'])
  // Simulate only stock-provider dispatches, preserving the provider's original order-line identities.
  let stockUnavailable = false
  const shipments = [], forward = stock.forward
  stock.forward = async request => {
    if (stockUnavailable) return new Response('Stock unavailable', { status: 503 })
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
  const media = []
  for (const [index, color] of [[1, [214, 140, 92]], [2, [84, 126, 168]]]) {
    const response = await sendFile(h, '/api/stall/media', solidPng(400, 400, color), 'image/png')
    assert.equal(response.status, 200)
    media.push({ id: (await response.json()).id, kind: 'image', alt: 'Studio tee view ' + index })
  }
  const product = await h.command('product.prepare', { sku: 'synthetic-stall-1800', name: 'Studio tee', description: 'Soft cotton tee', unitCents: 2400, active: true,
    details: { handle: 'studio-tee', media, options: [{ name: 'Size', values: ['Small', 'Large'] }], variants: [
      { sku: 'synthetic-stall-1801', options: { Size: 'Small' }, unitCents: 2400 },
      { sku: 'synthetic-stall-1802', options: { Size: 'Large' }, unitCents: 2800 }
    ] } })
  await h.command('product.approve', { sku: product.id, revision: product.revision })
  await h.command('return.policy.save', { revision: null, windowDays: 30, condition: 'Unworn', feeCents: 0, returnShipping: 'Contact the shop', finalSaleSkus: [], exchanges: true })
  let as = h.cookie, releaseCheckout
  let checkoutCalls = 0, holdCheckout = false
  await context.unroute('**/api/stall/**')
  await context.route('**/api/stall/**', async route => {
    const req = route.request(), url = new URL(req.url())
    const response = await h.request(url.pathname + url.search, { method: req.method(), as, ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
    if (url.pathname === '/api/stall/checkout') { checkoutCalls++; if (holdCheckout && response.ok) await new Promise(resolve => { releaseCheckout = resolve }) }
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
    await page.waitForLoadState('networkidle')
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
  const accountMenu = page.getByRole('button', { name: /^Account menu for/ })
  await keyboardTo(accountMenu)
  await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  // Modal entry, trapping, Escape and return to the invoking control are keyboard operations.
  await type(page.locator('form').filter({ has: page.getByRole('button', { name: 'Review customer erasure', exact: true }) }).getByLabel('Customer email', { exact: true }), email)
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
  stockUnavailable = true
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await page.getByText('Stock is unavailable. These are the last observed quantities. Refresh availability before reviewing or paying.', { exact: true }).waitFor()
  await expect(page.getByRole('button', { name: 'Review order', exact: true })).toBeDisabled()
  await expect(page.locator('time[datetime]')).toHaveCount(1)
  await scan('stock-unavailable')
  stockUnavailable = false
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await expect(page.getByText('Stock is unavailable.', { exact: false })).toHaveCount(0)
  await activate(page.getByRole('link', { name: 'Choose options for Studio tee', exact: true }))
  await page.getByRole('heading', { name: 'Studio tee', exact: true }).waitFor()
  await activate(page.getByRole('group', { name: 'Size', exact: true }).getByRole('button', { name: 'Large', exact: true }))
  await expect(page.locator('.st-pdp-price')).toContainText('$28.00')
  const secondImage = page.getByRole('button', { name: 'Show image 2: Studio tee view 2', exact: true })
  await activate(secondImage)
  await expect(page.getByRole('tooltip', { name: 'Show image 2', exact: true })).toBeVisible()
  await expect(page.locator('.st-gallery > img')).toHaveAttribute('alt', 'Studio tee view 2')
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
  holdCheckout = true
  await activate(page.getByRole('button', { name: 'Pay $28.00 with Stripe', exact: true }))
  await expect(page.getByRole('button', { name: 'Opening Stripe…', exact: true })).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect.poll(() => typeof releaseCheckout).toBe('function')
  assert.equal(checkoutCalls, 2, 'One failed stock validation and one payment attempt; duplicate submission is disabled')
  releaseCheckout()
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
  // The same return's reviewed refund completes the merchant workflow without asserting restock.
  as = h.cookie
  await page.goto(ready.url + '/app#orders/' + session.client_reference_id)
  await activate(page.locator('.st-order-panel summary').filter({ hasText: /^More actions$/ }))
  await activate(page.locator('.st-order-panel summary').filter({ hasText: /^Prepare a refund$/ }))
  await type(page.getByLabel('Reason', { exact: true }), 'Returned tee received and inspected; no restock')
  await activate(page.getByRole('button', { name: 'Prepare refund', exact: true }))
  await scan('refund-review')
  await activate(page.getByRole('button', { name: /^Approve [$]28[.]00 refund/ }))
  await expect.poll(() => edge.refunds.size).toBe(1)
  assert.equal([...edge.refunds.values()][0].amount, 2800)
  await scan('refund-complete')
  as = member
  await page.goto(ready.url + '/order')
  await activate(card.locator('summary').filter({ hasText: /^Delivery, refunds and requests$/ }))
  await expect(card).toContainText('$28.00 · succeeded')
  await scan('account-refunded')
  await activate(card.getByRole('button', { name: /^Reorder/ }))
  await page.getByRole('heading', { name: 'Review your reorder', exact: true }).waitFor()
  await scan('reorder-checkout')
  as = h.cookie
  const buy = await h.api('/api/stall/buy-links', { label: 'Studio tee checkout', lines: [{ sku: 'synthetic-stall-1801', quantity: 1 }] })
  as = ''
  await page.goto(ready.url + '/shop?buy=' + buy.id)
  await page.getByRole('heading', { name: 'Studio tee checkout', exact: true }).waitFor()
  await scan('checkout-link')
  await activate(page.getByRole('button', { name: 'Continue to native cart', exact: true }))
  await page.getByRole('heading', { name: 'Review checkout link', exact: true }).waitFor()
  await scan('checkout-link-cart')
  await page.goto(ready.url + '/order')
  await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor()
  await scan('signed-out-account')
  // One phone smoke repeats essential variant and basket controls by keyboard at 390.
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto(ready.url + '/shop/studio-tee')
  await activate(page.getByRole('group', { name: 'Size', exact: true }).getByRole('button', { name: 'Small', exact: true }))
  await activate(page.getByRole('button', { name: /^Add to basket/ }))
  await activate(page.getByRole('link', { name: 'Review your basket and check out', exact: true }))
  await expect(page.locator('.st-checkout')).toContainText('Studio tee — Small × 1')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  // Receipt authority, original replay and erasure continue through the existing public doors.
  const received = (await h.api('/api/stall/returns')).receipts[0]
  const captured = { requestId: received.request_id, orderRevision: received.source_revision, lines: received.lines }
  const replay = await h.api('/api/stall/returns', captured)
  assert.equal(replay.id, received.id)
  await h.api('/api/stall/returns', captured, { as: member, status: 403 })
  await h.api('/api/stall/returns', undefined, { as: member, status: 403 })
  const credentials = await h.api('/api/stall/agent-token', {})
  await h.api('/api/stall/agent-token', {}, { method: 'DELETE' })
  const revoked = await h.request('/api/stall/returns', { as: '', headers: { authorization: 'Bearer ' + credentials.token } })
  assert.equal(revoked.status, 401)
  await h.command('customer.erase', { email, confirm: 'ERASE' })
  const erased = await h.api('/api/stall/returns')
  assert.deepEqual(erased.cases, []); assert.deepEqual(erased.receipts, [])
  await h.api('/api/stall/returns', captured, { status: 404 })
  assert.equal(edge.sessions.size, 1); assert.equal(edge.refunds.size, 1)
  assert.deepEqual(journey.errors, [])
  console.log('PASS MOBILE-001 keyboard purchase, validation recovery, receipt, account, dialog and WCAG scans:', JSON.stringify(scans))
} catch (error) {
  journeyError = error
  if (journey?.page) { await journey.page.screenshot({ path: (process.env.STALL_SCREENSHOTS ?? 'test-results/mobile') + '/failure.png', fullPage: true }); console.error('Failure state:', (await journey.page.locator('main').innerText()).slice(0, 3000)) }
  throw error
} finally { await journey?.finish(journeyError) }
