import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium, expect } from '@playwright/test'
import axe from 'axe-core'
import { installation } from '../api/harness.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { stripeEdge, deliverWebhook } from '../api/network.mjs'

// One continuous public-door purchase and return through the emitted Worker.
// Only stock, payment and mail provider boundaries are simulated.
const screenshots = resolve(process.env.STALL_SCREENSHOTS ?? './test-results/mobile')
const small = 'synthetic-stall-2701', large = 'synthetic-stall-2702', productId = 'synthetic-stall-2703'
const email = ['synthetic-stall-2704', 'example.test'].join('@')
let h, browser, page, server, as, checkoutGate
let stockUnavailable = false, guestCookie = ''
const scans = [], failures = []
await mkdir(screenshots, { recursive: true })
try {
  const stock = volumeStock([small, large]), shipments = [], forward = stock.forward
  stock.forward = async request => {
    const url = new URL(request.url)
    if (stockUnavailable) return Response.json({ error: 'Stock provider unavailable' }, { status: 503 })
    if (request.method === 'POST') {
      const { type, payload, commandId } = await request.clone().json()
      if (type === 'dispatch.create') {
        if (!shipments.some(row => row.id === commandId)) shipments.push({ id: commandId, orderId: payload.orderId, reference: payload.shipmentReference, createdAt: new Date().toISOString(), lines: payload.lines.map(line => ({ ...line, itemId: stock.orders.get(payload.orderId).lines.find(original => original.id === line.orderLineId).itemId })), tracking: [] })
        return Response.json({ result: shipments.find(row => row.id === commandId) })
      }
    }
    const response = await forward(request)
    if (request.method === 'GET' && url.pathname === '/api/pier/state') return Response.json({ ...await response.json(), shipments })
    return response
  }
  const edge = stripeEdge({ forward: stock.forward }), secret = randomBytes(32).toString('hex')
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const headers = { ...incoming.headers, cookie: as || guestCookie, origin: h.origin }; delete headers['content-length']
      const response = await h.mf.dispatchFetch(h.origin + incoming.url, { method: incoming.method, headers, redirect: 'manual', ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) guestCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ')
      const reply = Object.fromEntries(response.headers); delete reply['content-encoding']; delete reply['content-length']; delete reply['transfer-encoding']
      outgoing.writeHead(response.status, reply); outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(502); outgoing.end('Owned Worker transport failed') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  h = await installation({ built: true,  bindings: { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'synthetic-stall-2705', PIER_CUSTOMER_ID: 'shop', STRIPE_SECRET_KEY: 'synthetic-stall-2706', STRIPE_WEBHOOK_SECRET: secret }, outboundService: async request => {
    if (checkoutGate && new URL(request.url).pathname === '/v1/checkout/sessions' && request.method === 'POST') await checkoutGate
    return edge.handle(request)
  }, onProgress: stage => console.log('[mobile]', stage) })
  let product = await h.command('product.prepare', { sku: productId, name: 'Studio shirt', description: 'Cotton shirt in two sizes', unitCents: 2500, active: true, details: { handle: 'studio-shirt', options: [{ name: 'Size', values: ['Small', 'Large'] }], variants: [{ sku: small, options: { Size: 'Small' } }, { sku: large, unitCents: 2800, options: { Size: 'Large' } }] } })
  await h.command('product.approve', { sku: productId, revision: product.revision })
  await h.command('return.policy.save', { revision: null, windowDays: 30, condition: 'Unused', feeCents: 0, returnShipping: 'Return postage paid by shopper', finalSaleSkus: [], exchanges: false })
  await h.command('shipping.configure', { shippingCents: 600 })
  const customer = await h.signIn(email)
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' })
  as = h.cookie
  page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  const site = `http://127.0.0.1:${server.address().port}`
  async function visit(path, locator) { await page.goto(site + path); if (locator) await locator.waitFor() }
  async function reach(control) {
    await expect(control).toHaveAccessibleName(/\S/)
    for (let step = 0; step < 250; step++) {
      if (await control.evaluate(element => element === document.activeElement)) {
        assert.ok(await control.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' || style.boxShadow !== 'none' }), 'Keyboard focus must be visible')
        return
      }
      await page.keyboard.press('Tab')
    }
    assert.fail('Essential control is unreachable by keyboard: ' + await control.getAttribute('aria-label'))
  }
  async function enter(control, value) { await reach(control); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(value) }
  async function activate(control) { await reach(control); await page.keyboard.press('Enter') }
  async function audit(label) {
    const viewport = page.viewportSize()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(axe.source)
      const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: true } } }))
      const violations = result.violations.map(row => ({ id: row.id, nodes: row.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))
      scans.push({ page: label, width, violations })
      if (violations.length) failures.push({ page: label, width, violations })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} has horizontal overflow at ${width}`)
      await page.screenshot({ path: resolve(screenshots, `${label}-${width}.png`), fullPage: true })
    }
    await page.setViewportSize(viewport)
    console.log('[mobile] scanned', label)
  }
  await visit('/app')
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await activate(page.getByRole('button', { name: 'Finish setup', exact: true })) }
  await page.getByRole('heading', { name: 'Orders', level: 1, exact: true }).waitFor()
  await audit('desk-empty')
  as = ''
  await visit('/shop', page.getByRole('link', { name: 'Studio shirt', exact: true }))
  const observed = page.locator('time[datetime]').first()
  await expect(observed).toBeVisible()
  assert.ok(Number.isFinite(Date.parse(await observed.getAttribute('datetime'))))
  await audit('storefront')
  stockUnavailable = true
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await expect(page.getByRole('heading', { name: 'The shop is not ready for orders', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/stock|Pier|unavailable/i)
  await expect(page.getByText('Sold out', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review order', exact: true })).toHaveCount(0)
  await audit('store-unavailable')
  stockUnavailable = false
  stock.setAvailable(large, '0')
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await activate(page.getByRole('link', { name: 'Studio shirt', exact: true }))
  await activate(page.getByRole('button', { name: 'Large', exact: true }))
  await expect(page.getByText('Sold out · ' + large, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to basket · $28.00', exact: true })).toBeDisabled()
  await audit('variant-sold-out')
  stock.setAvailable(large, '10')
  await visit('/shop', page.getByRole('link', { name: 'Studio shirt', exact: true }))
  await activate(page.getByRole('link', { name: 'Studio shirt', exact: true }))
  await page.getByRole('heading', { name: 'Studio shirt', exact: true }).waitFor()
  await activate(page.getByRole('button', { name: 'Large', exact: true }))
  await expect(page.getByRole('button', { name: 'Large', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await audit('variant')
  await activate(page.getByRole('button', { name: 'Add to basket · $28.00', exact: true }))
  await page.getByRole('link', { name: 'Review your basket and check out', exact: true }).waitFor()
  await activate(page.getByRole('link', { name: 'Review your basket and check out', exact: true }))
  await enter(page.getByLabel('Email for your order', { exact: true }), email)
  await activate(page.getByRole('button', { name: 'Review order', exact: true }))
  await page.getByRole('button', { name: 'Pay $34.00 with Stripe', exact: true }).waitFor()
  await audit('checkout-review')
  product = (await h.api('/api/stall/state')).products.find(row => row.id === productId)
  product = await h.command('product.prepare', { ...product.value, sku: productId, revision: product.revision, details: { ...product.value.details, variants: product.value.details.variants.map(row => row.sku === large ? { ...row, unitCents: 3000 } : row) } })
  await h.command('product.approve', { sku: productId, revision: product.revision })
  await activate(page.getByRole('button', { name: 'Pay $34.00 with Stripe', exact: true }))
  const alert = page.getByRole('alert').first()
  await expect(alert).toContainText(/changed|review|total|price/i)
  await expect(alert).toBeFocused()
  assert.equal(await page.getByLabel('Email for your order', { exact: true }).inputValue(), email)
  await expect(page.getByText('Studio shirt — Large × 1', { exact: true })).toBeVisible()
  await audit('checkout-validation')
  await activate(page.getByRole('button', { name: 'Refresh availability', exact: true }))
  await page.getByText('$30.00', { exact: true }).first().waitFor()
  await activate(page.getByRole('button', { name: 'Review order', exact: true }))
  const pay = page.getByRole('button', { name: 'Pay $36.00 with Stripe', exact: true })
  await pay.waitFor()
  edge.loseNextCheckoutResponse()
  let releaseCheckout
  checkoutGate = new Promise(resolve => { releaseCheckout = resolve })
  await activate(pay)
  await expect(page.getByRole('button', { name: 'Opening Stripe…', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Email for your order', { exact: true })).toBeDisabled()
  await page.keyboard.press('Enter')
  releaseCheckout(); checkoutGate = undefined
  await expect(alert).toContainText(/Stripe|saved|retry/i)
  assert.equal(edge.sessions.size, 1)
  assert.equal((await h.api('/api/stall/state')).orders.length, 1)
  await context.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Payment edge</title><main>Hosted payment provider</main>' }))
  await activate(pay)
  await page.waitForURL(url => url.hostname === 'checkout.stripe.com')
  assert.equal(edge.sessions.size, 1, 'Retry must reuse the original checkout')
  const session = [...edge.sessions.values()][0], orderId = session.client_reference_id
  assert.equal(session.amount_total, 3600)
  const paid = edge.pay(session.id)
  assert.equal((await deliverWebhook(h, secret, paid)).response.status, 200)
  assert.equal((await deliverWebhook(h, secret, paid)).response.status, 200)
  assert.equal(stock.orders.size, 1, 'Replayed payment must reserve once')
  await visit('/order?checkout=success&orderId=' + orderId, page.getByText('Thank you, your payment is confirmed', { exact: true }))
  const receipt = page.getByRole('region', { name: 'Your order', exact: true })
  await expect(receipt.getByRole('listitem')).toHaveCount(1)
  await expect(receipt.getByRole('listitem')).toContainText('Studio shirt — Large × 1')
  await expect(receipt.getByRole('listitem')).toContainText('Size: Large')
  await expect(receipt.getByRole('listitem')).toContainText('$30.00')
  await audit('receipt')
  as = h.cookie
  await visit('/app#orders/' + orderId, page.getByLabel('Shipping reference', { exact: true }))
  await enter(page.getByLabel('Shipping reference', { exact: true }), 'synthetic-stall-2707')
  await activate(page.getByRole('button', { name: 'Prepare shipping for approval', exact: true }))
  await activate(page.getByRole('button', { name: /^Approve shipping/ }))
  await page.getByText('Dispatched in Pier', { exact: false }).waitFor()
  await audit('merchant-order')
  as = customer
  await visit('/order', page.getByRole('article', { name: 'Order ' + orderId, exact: true }))
  const card = page.getByRole('article', { name: 'Order ' + orderId, exact: true })
  await activate(card.locator('summary').filter({ hasText: 'Delivery, refunds and requests' }))
  await expect(card.getByText('Shipment: shipped', { exact: true })).toBeVisible()
  await activate(card.locator('summary').filter({ hasText: 'Returns, exchanges and cancellation' }))
  await card.getByRole('form', { name: 'Request help with this order', exact: true }).waitFor()
  await reach(card.getByRole('checkbox', { name: /Studio shirt — Large/ })); await page.keyboard.press('Space')
  await enter(card.getByLabel('Note for the shop (optional)', { exact: true }), 'The size does not fit')
  await activate(card.getByRole('button', { name: 'Send request for review', exact: true }))
  await card.getByText('Request received.', { exact: false }).first().waitFor()
  await audit('account-return')
  const cases = (await h.api('/api/stall/returns')).cases
  assert.equal(cases.length, 1)
  assert.equal(cases[0].lines[0].sku, large)
  as = h.cookie
  await visit('/app#requests', page.getByLabel('Explanation the shopper will read', { exact: true }))
  await enter(page.getByLabel('Explanation the shopper will read', { exact: true }), 'Return accepted. We will refund the shirt after inspection.')
  await activate(page.getByRole('button', { name: /^Accept request/ }))
  await page.getByText('Return accepted. We will refund the shirt after inspection.', { exact: false }).first().waitFor()
  assert.equal((await h.api('/api/stall/returns')).cases[0].state, 'accepted')
  await audit('merchant-return')
  await visit('/app#orders/' + orderId, page.locator('.st-order-panel'))
  await activate(page.locator('.st-order-panel summary').filter({ hasText: /^More actions$/ }))
  await activate(page.locator('.st-order-panel summary').filter({ hasText: /^Prepare a refund$/ }))
  await enter(page.getByLabel('Reason', { exact: true }), 'Returned shirt inspected')
  await activate(page.getByRole('button', { name: 'Prepare refund', exact: true }))
  await activate(page.getByRole('button', { name: /^Approve \$30.00 refund/ }))
  await page.getByRole('heading', { name: 'Refund · $30.00', exact: true }).waitFor()
  assert.equal(edge.refunds.size, 1)
  assert.equal((await h.api('/api/stall/state')).orders.find(row => row.id === orderId).refunds[0].status, 'succeeded')
  await audit('merchant-refund')
  as = customer
  await visit('/order', page.getByRole('article', { name: 'Order ' + orderId, exact: true }))
  await activate(card.locator('summary').filter({ hasText: 'Delivery, refunds and requests' }))
  await expect(card.getByText('$30.00 · succeeded', { exact: true })).toBeVisible()
  await expect(card.getByText('Return accepted. We will refund the shirt after inspection.', { exact: false })).toBeVisible()
  await audit('account-processed')
  await activate(card.getByRole('button', { name: /^Reorder order/ }))
  await page.getByRole('heading', { name: 'Review your reorder', exact: true }).waitFor()
  await expect(page.getByRole('button', { name: 'Review current total', exact: true })).toBeEnabled()
  await audit('account-reorder')
  const link = await h.api('/api/stall/account/guest-order-link', { orderId }, { as: customer })
  as = ''
  await visit('/order#orderLink=' + link.token, page.getByRole('heading', { name: 'Your guest order', exact: true }))
  await audit('guest-order')
  await h.api('/api/stall/account/guest-order-link', { orderId }, { as: customer, method: 'DELETE' })
  await visit('/order#orderLink=' + link.token, page.getByRole('alert'))
  await expect(page.getByRole('alert')).toContainText(/expired|revoked|unavailable/i)
  await expect(page.getByRole('article', { name: 'Order ' + orderId, exact: true })).toHaveCount(0)
  await audit('guest-order-revoked')
  await visit('/order', page.getByRole('form', { name: 'Customer account request', exact: true }))
  await audit('account-request')
  await visit('/signin?returnTo=%2Forder', page.locator('main'))
  await audit('account-signin')
  as = h.cookie
  await visit('/auth/settings/identity', page.locator('main'))
  await audit('desk-identity')
  as = customer
  const buy = await h.api('/api/stall/buy-links', { label: 'Studio shirt link', lines: [{ sku: large, quantity: 1 }] })
  await visit('/shop?buy=' + buy.id, page.getByRole('heading', { name: 'Studio shirt link', exact: true }))
  await audit('checkout-link')
  await activate(page.getByRole('button', { name: 'Continue to native cart', exact: true }))
  await page.getByRole('heading', { name: 'Review checkout link', exact: true }).waitFor()
  await audit('checkout-link-review')
  as = h.cookie
  await visit('/api/stall/packing-slip?orderId=' + orderId, page.getByRole('heading', { name: 'Packing slip', exact: true }))
  await audit('packing-slip')
  // Derive current desk destinations from its public navigation so new pages
  // cannot silently escape the accessibility scan.
  await visit('/app#settings', page.getByRole('heading', { name: 'Settings', level: 1, exact: true }))
  const destinations = await page.getByRole('navigation', { name: 'Shop desk', exact: true }).getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))
  assert.ok(destinations.length > 0)
  for (const hash of destinations) {
    await visit('/app' + hash)
    await expect(page.getByRole('navigation', { name: 'Shop desk', exact: true }).locator(`a[href="${hash}"]`)).toHaveAttribute('aria-current', 'page')
    await page.locator('main').getByRole('heading').first().waitFor()
    await page.waitForFunction(() => ![...document.querySelectorAll('main [role="status"]')].some(element => /Loading|Checking/.test(element.textContent) && element.getClientRects().length))
    await audit('desk-' + hash.slice(1))
    if (hash === '#reports') {
      for (const name of ['Traffic & funnel', 'Best sellers', 'Orders']) {
        await activate(page.getByRole('navigation', { name: 'Report sections', exact: true }).getByRole('button', { name, exact: true }))
        await audit('desk-reports-' + name.toLowerCase().replace(/[^a-z]+/g, '-'))
      }
    }
  }
  await visit('/app#settings', page.getByRole('button', { name: 'Review customer erasure', exact: true }))
  const trigger = page.getByRole('button', { name: 'Review customer erasure', exact: true })
  const erasure = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Erase customer details', exact: true }) })
  await enter(erasure.getByLabel('Customer email', { exact: true }), email)
  await activate(trigger)
  await expect(page.getByLabel('Type ERASE to confirm', { exact: true })).toBeFocused()
  await audit('erasure-dialog')
  await reach(page.getByRole('button', { name: 'Cancel', exact: true }))
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Type ERASE to confirm', { exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  const account = page.getByRole('button', { name: /^Account menu for/ })
  await reach(account)
  await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
  await audit('account-tooltip')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeHidden()
  await account.evaluate(element => element.blur())
  await page.mouse.move(0, 0)
  await account.hover()
  assert.equal(await page.getByRole('tooltip', { name: 'Account menu', exact: true }).isVisible(), false)
  await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  await writeFile(resolve(screenshots, 'accessibility.json'), JSON.stringify(scans, null, 2))
  assert.deepEqual(failures, [], 'WCAG 2.2 AA violations, including contrast: ' + JSON.stringify(failures))
  console.log(`PASS MOBILE-001: variant purchase, retained-input recovery, replay-safe checkout, receipt, shipment, verified account return, staff decision/refund and keyboard focus; ${scans.length} page-width scans with zero violations`)
} catch (error) {
  await writeFile(resolve(screenshots, 'accessibility.json'), JSON.stringify(scans, null, 2))
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(screenshots, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('Accessibility failures:', JSON.stringify(failures))
  throw error
} finally {
  await browser?.close()
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await h?.close()
}
