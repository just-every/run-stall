import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { installation } from '../api/harness.mjs'
import { stripeEdge, deliverWebhook, sendFile, png, solidPng } from '../api/network.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { startOwnedDev, finishCleanup } from '../owned-dev.mjs'

// CATALOG-001: the desk builds a variant product with a gallery and personalization; the shop sells it.
const exec = promisify(execFile), screenshots = resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/catalog')
const scratch = await mkdtemp(join(tmpdir(), 'stall-catalog-')), checkout = join(scratch, 'run-stall'), rerHome = join(scratch, 'rer-home')
let browser, dev, h, journeyError, cleaning
await mkdir(screenshots, { recursive: true }); await mkdir(rerHome)
function cleanup() {
 return cleaning ??= (async () => {
  const results = await Promise.allSettled([browser?.close(), h?.close(), dev?.stop()].filter(Boolean))
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures, 'Owned catalog journey cleanup failed')
  await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
 })()
}
const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
try {
 await exec('git', ['clone', '--no-hardlinks', process.cwd(), checkout])
 dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
 const ready = await dev.ready
 const stock = volumeStock(['TEE-S-RED', 'TEE-S-BLUE', 'TEE-M-RED', 'TEE-M-BLUE']), edge = stripeEdge({ forward: stock.forward }), secret = randomBytes(32).toString('hex')
 h = await installation({ bindings: { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'test-stock-network-edge', PIER_CUSTOMER_ID: 'shop', STRIPE_SECRET_KEY: 'test-network-edge', STRIPE_WEBHOOK_SECRET: secret }, outboundService: edge.handle })
 browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = []
 page.on('pageerror', error => errors.push(error.message))
 // Test transport to the real migrated commerce Worker; no application fixtures. File bodies pass through as bytes.
 await context.route('**/api/stall/**', async route => {
  const req = route.request(), url = new URL(req.url()), type = req.headers()['content-type'] ?? '', raw = req.postDataBuffer()
  const response = raw && !type.startsWith('application/json')
   ? await sendFile(h, url.pathname + url.search, raw, type, { as: url.pathname === '/api/stall/personalization/upload' ? '' : h.cookie })
   : await h.request(url.pathname + url.search, { method: req.method(), ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
  await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', ...(response.headers.get('content-disposition') ? { 'content-disposition': response.headers.get('content-disposition') } : {}) }, body: Buffer.from(await response.arrayBuffer()) })
 })
 await page.goto(ready.openUrl)
 await page.waitForURL(url => ['/setup', '/app'].includes(url.pathname))
 if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click() }
 async function capture(name, target = page.locator('main'), shown = page) {
  for (const width of [1440, 390]) {
   await shown.setViewportSize({ width, height: 1000 })
   await target.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20))
   assert.ok(await shown.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`)
   await shown.screenshot({ path: join(screenshots, `CATALOG-001-${name}-${width}.png`), fullPage: true })
  }
  await shown.setViewportSize({ width: 1440, height: 1000 })
 }
 // The desk: a product with options, variants, a gallery, a size chart and personalization.
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('button', { name: 'Prepare a product', exact: true }).click()
 await page.getByLabel('SKU', { exact: true }).fill('TEE')
 await page.getByLabel(/^Unit price/).fill('25.00')
 await page.getByLabel('Product name', { exact: true }).fill('Linen tee')
 await page.locator('#product-editor > label textarea').fill('Soft, light and cut for summer.')
 await page.getByText('Optional product details', { exact: true }).click()
 await page.getByLabel('Weight · g', { exact: true }).fill('200')
 await page.getByLabel('HS code', { exact: true }).fill('610910')
 await page.getByLabel('Country of origin', { exact: true }).fill('PT')
 await page.getByRole('button', { name: 'Add custom field', exact: true }).click()
 await page.getByLabel('Field key 1', { exact: true }).fill('size_chart')
 await page.getByLabel('Field label 1', { exact: true }).fill('Size chart')
 await page.getByLabel('Field value 1', { exact: true }).fill('S chest 92 cm · M chest 98 cm')
 await page.locator('summary', { hasText: 'Shop listing' }).click()
 await page.getByLabel('Handle (page address)', { exact: true }).fill('linen-tee')
 await page.getByLabel('Compare-at price · USD', { exact: true }).fill('35.00')
 await page.getByLabel('Categories (comma separated)', { exact: true }).fill('Tops')
 await page.getByRole('button', { name: 'Add an attribute', exact: true }).click()
 await page.getByLabel('Attribute 1 name', { exact: true }).fill('Material')
 await page.getByLabel('Attribute 1 value', { exact: true }).fill('Organic cotton')
 await page.locator('summary', { hasText: 'Images and videos' }).click()
 await page.getByLabel('Add an image or video', { exact: true }).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: solidPng(400, 400, [214, 140, 92]) })
 await page.getByLabel('Alt text for image 1', { exact: true }).fill('Front of the tee')
 await page.getByLabel('Add an image or video', { exact: true }).setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: solidPng(400, 400, [84, 126, 168]) })
 await page.getByLabel('Alt text for image 2', { exact: true }).fill('Back of the tee')
 await page.getByLabel('Add an image or video', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not media') })
 await page.getByText('Upload a PNG, JPEG, GIF or WebP image', { exact: false }).waitFor()
 await page.locator('summary', { hasText: 'Options and variants' }).click()
 for (const [index, name, values] of [[1, 'Size', 'S, M'], [2, 'Color', 'Red, Blue']]) {
  await page.getByRole('button', { name: 'Add an option', exact: true }).click()
  await page.getByLabel(`Option ${index} name`, { exact: true }).fill(name)
  await page.getByLabel(`Option ${index} values (comma separated)`, { exact: true }).fill(values)
 }
 await page.getByRole('button', { name: 'Generate variants from options', exact: true }).click()
 assert.equal(await page.getByLabel('Variant 3 SKU', { exact: true }).inputValue(), 'TEE-M-RED')
 await page.getByLabel('Variant 3 price · USD', { exact: true }).fill('26.00')
 await page.getByLabel(/^Variant 3 image/).selectOption({ label: 'Image 2: Back of the tee' })
 await page.getByLabel(/^Archive variant 2/).check()
 await page.locator('summary', { hasText: 'Personalization' }).click()
 await page.getByRole('button', { name: 'Add a personalization field', exact: true }).click()
 await page.getByLabel('Field 1 key', { exact: true }).fill('engraving')
 await page.getByLabel('Field 1 label', { exact: true }).fill('Engraving')
 await page.getByLabel('Field 1 add-on price · USD', { exact: true }).fill('5.00')
 await page.getByLabel('Field 1 character limit', { exact: true }).fill('20')
 await page.getByRole('button', { name: 'Add a personalization field', exact: true }).click()
 await page.getByLabel('Field 2 key', { exact: true }).fill('artwork')
 await page.getByLabel('Field 2 label', { exact: true }).fill('Artwork')
 await page.getByLabel(/^Field 2 type/).selectOption('file')
 await capture('editor', page.locator('#product-editor'))
 await page.getByRole('button', { name: 'Prepare revision', exact: true }).click()
 await page.getByRole('button', { name: /Approve & publish revision/ }).waitFor()
 await capture('approval', page.locator('.st-order-panel'))
 await page.getByRole('button', { name: /Approve & publish revision/ }).click()
 await page.locator('#products tbody tr', { hasText: 'Linen tee' }).getByText('Published', { exact: true }).waitFor()
 const saved = (await h.api('/api/stall/state')).products.find(product => product.id === 'TEE').value.details
 assert.deepEqual([saved.variants.length, saved.media.length, saved.personalization.length, saved.variants[2].unitCents, saved.variants[1].archived], [4, 2, 2, 2600, true])
 // The shop: a gallery, option choice, price, size chart and validated personalization.
 await page.goto(ready.url + '/shop')
 await page.getByRole('link', { name: 'Choose options for Linen tee' }).click()
 await page.getByRole('heading', { name: 'Linen tee', level: 1 }).waitFor()
 const hero = page.locator('.st-gallery > img')
 assert.equal(await hero.getAttribute('alt'), 'Front of the tee')
 await page.getByRole('button', { name: 'Show image 2: Back of the tee' }).click()
 assert.equal(await hero.getAttribute('alt'), 'Back of the tee')
 await page.getByRole('button', { name: 'Show image 1: Front of the tee' }).click()
 await page.getByText('Choose size and color to see the price.').waitFor()
 await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'S', exact: true }).click()
 assert.equal(await page.getByRole('group', { name: 'Color' }).getByRole('button', { name: /^Blue/ }).isDisabled(), true, 'the archived variant cannot be chosen')
 await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'M', exact: true }).click()
 await page.getByRole('group', { name: 'Color' }).getByRole('button', { name: 'Red', exact: true }).click()
 await page.locator('.st-pdp-price', { hasText: '$26.00' }).waitFor()
 assert.ok((await page.locator('.st-pdp-price').innerText()).includes('$35.00'))
 assert.equal(await hero.getAttribute('alt'), 'Back of the tee', 'the variant shows its own image')
 await page.getByText('S chest 92 cm · M chest 98 cm', { exact: true }).waitFor()
 await page.getByLabel(/^Engraving/).fill('x'.repeat(21))
 await page.getByText('21/20 characters — too long').waitFor()
 assert.equal(await page.getByRole('button', { name: /^Add to basket/ }).isDisabled(), true)
 await page.getByLabel(/^Engraving/).fill('Sam')
 await page.getByLabel(/^Artwork/).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') })
 await page.getByText('Choose a png file.').waitFor()
 await page.getByLabel(/^Artwork/).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png(300, 3) })
 await page.getByText('Attached: logo.png').waitFor()
 await capture('product-page', page.locator('.st-pdp'))
 await page.getByRole('button', { name: /^Add to basket/ }).click()
 await page.getByText('is in your basket with $5.00 of personalization per item.', { exact: false }).waitFor()
 await page.getByRole('link', { name: 'Review your basket and check out' }).click()
 await page.getByText('Engraving: Sam (+$5.00 each)').waitFor()
 await page.getByLabel('Email for your order').fill('sam@example.test')
 await page.getByRole('button', { name: 'Review order', exact: true }).click()
 await page.getByRole('button', { name: 'Pay $31.00 with Stripe', exact: true }).waitFor()
 await capture('basket', page.locator('.st-checkout'))
 const payment = page.waitForResponse(response => response.url().startsWith('https://checkout.stripe.com/'))
 await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 204, body: '' }))
 await page.getByRole('button', { name: 'Pay $31.00 with Stripe', exact: true }).click()
 await payment
 const session = [...edge.sessions.values()][0]
 assert.equal(session.amount_total, 3100)
 assert.equal((await deliverWebhook(h, secret, edge.pay(session.id))).response.status, 200)
 await page.goto(`${ready.url}/order?checkout=success&orderId=${session.client_reference_id}`)
 await page.getByText('Thank you, your payment is confirmed').waitFor()
 await page.getByText('Engraving: Sam (+$5.00 each)').waitFor()
 await capture('order-confirmation')
 const mail = h.messages.findLast(message => JSON.stringify(message.to).includes('sam@example.test'))
 assert.ok(mail.text.includes('Linen tee — M / Red') && mail.text.includes('Engraving: Sam (+$5.00 each)'))
 // The desk order shows the selection; the packing slip prints it with the private file link.
 await page.goto(ready.url + '/app')
 await page.locator('#orders .st-order-id').first().click()
 await page.getByText('Engraving: Sam', { exact: false }).first().waitFor()
 await page.getByText('Size: M, Color: Red', { exact: false }).first().waitFor()
 const [slip] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /^Open packing slip/ }).click()])
 await slip.waitForLoadState()
 await slip.getByText('Engraving: Sam', { exact: false }).waitFor()
 await slip.getByText('+$5.00 each', { exact: false }).waitFor()
 await capture('packing-slip', slip.locator('h1'), slip)
 await slip.close()
 const missing = await page.goto(ready.url + '/shop/no-such-handle')
 assert.equal(missing.status(), 404)
 await page.getByText('This product is not available').waitFor()
 const sitePage = await context.newPage()
 for (const [path, name] of [['/docs/products', 'guide'], ['/contract', 'contract']]) {
  assert.equal((await sitePage.goto(ready.siteUrl + path)).status(), 200)
  await capture(name, sitePage.locator('body'), sitePage)
 }
 await sitePage.close()
 assert.deepEqual(errors, [])
 await dev.assertRunning()
 console.log('CATALOG-001 catalog journey passed: desk editor, gallery and variant choice, size chart, validated personalization, checkout, order summary, packing slip, unknown handle 404')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
