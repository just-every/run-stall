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

// SHIP-004: the desk builds shipping profiles, places and assignments; the shop quotes mixed baskets by ZIP code.
const exec = promisify(execFile), screenshots = resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/shipping')
const scratch = await mkdtemp(join(tmpdir(), 'stall-shipping-')), checkout = join(scratch, 'run-stall'), rerHome = join(scratch, 'rer-home')
let browser, dev, h, journeyError, cleaning
await mkdir(screenshots, { recursive: true }); await mkdir(rerHome)
function cleanup() {
 return cleaning ??= (async () => {
  const results = await Promise.allSettled([browser?.close(), h?.close(), dev?.stop()].filter(Boolean))
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures, 'Owned shipping journey cleanup failed')
  await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
 })()
}
const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
try {
 await exec('git', ['clone', '--no-hardlinks', process.cwd(), checkout])
 dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
 const ready = await dev.ready
 const stock = volumeStock(['TEE', 'DESK-A', 'DESK-B', 'STICKERS', 'CHAIR']), edge = stripeEdge({ forward: stock.forward }), secret = randomBytes(32).toString('hex')
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
   await shown.screenshot({ path: join(screenshots, `SHIP-004-${name}-${width}.png`), fullPage: true })
  }
  await shown.setViewportSize({ width: 1440, height: 1000 })
 }
 const put = async (sku, name, unitCents, weightGrams) => { const draft = await h.command('product.prepare', { sku, name, description: '', unitCents, active: true, details: { weightGrams } }); await h.command('product.approve', { sku, revision: draft.revision }) }
 await put('TEE', 'Linen tee', 2500, 200); await put('DESK-A', 'Oak desk', 30000, 20000); await put('DESK-B', 'Pine desk', 28000, 18000); await put('STICKERS', 'Sticker pack', 500, 20); await put('CHAIR', 'Armchair', 40000, 9000)
 const flat = cents => ({ type: 'flat', cents })
 await h.command('shipping.profile.save', { id: 'general', revision: 'unsaved', value: { name: 'General', services: [{ code: 'ups-ground', name: 'UPS Ground', rate: flat(600) }, { code: 'usps-priority', name: 'USPS Priority', rate: flat(600) }] } })
 await h.command('shipping.profile.save', { id: 'stickers', value: { name: 'Free-shipping stickers', services: [{ code: 'ups-ground', name: 'UPS Ground', rate: { type: 'free' } }, { code: 'usps-priority', name: 'USPS Priority', rate: { type: 'free' } }] } })
 await h.command('shipping.profile.save', { id: 'furniture', value: { name: 'Furniture', services: [] } })
 // The desk: an oversized profile, the pickup place and delivery area, then bulk assignment by grid and by CSV.
 await page.goto(ready.url + '/app#shipping')
 await page.getByRole('heading', { name: 'Shipping', level: 1 }).waitFor()
 await page.getByRole('button', { name: 'New profile', exact: true }).click()
 await page.getByLabel('Profile name', { exact: true }).fill('Oversized')
 await page.getByLabel('Profile ID', { exact: true }).fill('oversized')
 await page.getByLabel('Ships from', { exact: true }).fill('Warehouse')
 await page.getByLabel(/^Zones the shipped services serve/).fill('East coast: 0, 1, 2, 3')
 await page.getByLabel('Service 1 code', { exact: true }).fill('ups-ground')
 await page.getByLabel('Service 1 name', { exact: true }).fill('UPS Ground')
 await page.getByLabel('Service 1 flat charge · USD', { exact: true }).fill('25.00')
 await capture('profile-editor', page.locator('form[aria-label="New shipping profile"]'))
 await page.getByRole('button', { name: 'Save profile', exact: true }).click()
 await page.getByRole('row', { name: /Oversized/ }).waitFor()
 await capture('profiles', page.locator('#shipping'))
 await page.getByRole('button', { name: 'Pickup and delivery', exact: true }).click()
 await page.getByLabel('Pickup place name', { exact: true }).fill('Studio')
 await page.getByLabel('Pickup address', { exact: true }).fill('1 Main St, New York NY')
 await page.getByLabel('Opening hours', { exact: true }).fill('Sat 10-4')
 await page.getByRole('button', { name: 'Save pickup place', exact: true }).click()
 await page.getByLabel('Delivery area ZIP prefixes (comma separated)', { exact: true }).fill('100')
 await page.getByLabel('Delivery fee · USD', { exact: true }).fill('15.00')
 await page.getByLabel('Minimum order · USD', { exact: true }).fill('50.00')
 await page.getByRole('button', { name: 'Save delivery area', exact: true }).click()
 await page.getByRole('button', { name: 'Remove delivery', exact: true }).waitFor()
 await capture('places', page.locator('#shipping'))
 await page.getByRole('button', { name: 'Products', exact: true }).click()
 await page.getByLabel('Select DESK-A', { exact: true }).check()
 await page.getByLabel('Select DESK-B', { exact: true }).check()
 await page.getByLabel(/^Move the selected items to/).selectOption({ label: 'Oversized' })
 await page.getByRole('button', { name: 'Review assignment (2)', exact: true }).click()
 await page.getByText('Review exact changes').waitFor()
 await capture('assign-review', page.locator('[aria-label="Reviewed assignment changes"]'))
 await page.getByRole('button', { name: 'Apply reviewed assignment', exact: true }).click()
 await page.getByText('2 assignments saved').waitFor()
 await page.getByLabel(/^Catalog CSV/).fill('SKU,Shipping Profile\nSTICKERS,stickers\nCHAIR,furniture\n')
 await page.getByRole('button', { name: 'Review CSV', exact: true }).click()
 await page.getByRole('button', { name: 'Apply reviewed assignment', exact: true }).click()
 await page.getByText('2 assignments saved').waitFor()
 const assigned = (await h.api('/api/stall/state')).shipping.assignments
 assert.deepEqual([assigned['DESK-A'], assigned['DESK-B'], assigned.STICKERS, assigned.CHAIR], ['oversized', 'oversized', 'stickers', 'furniture'])
 await page.goto(ready.url + '/app#products/DESK-A')
 await page.getByRole('region', { name: 'Shipping profile' }).getByText('Now: Oversized.').waitFor()
 // The shop: mixed baskets are priced by profile for a ZIP code.
 await page.goto(ready.url + '/shop')
 const qty = async (name, value) => page.getByLabel(`Quantity for ${name}`, { exact: true }).fill(String(value))
 await qty('Linen tee', 1); await qty('Oak desk', 1)
 await page.getByLabel('ZIP code for shipping options', { exact: true }).fill('10001')
 await page.getByRole('radio', { name: /^UPS Ground · \$31\.00/ }).check()
 await page.getByRole('radio', { name: /^Local pickup/ }).waitFor()
 await page.getByRole('radio', { name: /^Local delivery · \$15\.00/ }).waitFor()
 assert.equal(await page.getByRole('radio', { name: /USPS Priority/ }).count(), 0, 'the oversized profile does not allow USPS Priority')
 await page.locator('.st-total', { hasText: '$356.00' }).waitFor()
 await qty('Sticker pack', 1)
 await page.locator('.st-total', { hasText: '$361.00' }).waitFor()
 assert.ok((await page.locator('.st-checkout').innerText()).includes('UPS Ground'), 'the free-shipping item leaves the UPS Ground charge unchanged')
 await capture('basket', page.locator('.st-checkout'))
 await qty('Armchair', 1)
 await page.getByText(/Armchair can only be picked up or delivered locally/).waitFor()
 assert.equal(await page.getByRole('radio', { name: /^UPS Ground/ }).count(), 0, 'shipped services disappear')
 await page.getByRole('radio', { name: /^Local pickup/ }).waitFor()
 await capture('furniture-basket', page.locator('.st-checkout'))
 await qty('Armchair', 0); await qty('Sticker pack', 0)
 await page.getByLabel('ZIP code for shipping options', { exact: true }).fill('99501')
 await page.getByText(/Oak desk cannot be shipped to ZIP 99501/).waitFor()
 await capture('unserved', page.locator('.st-checkout'))
 assert.deepEqual(errors, [])
 await dev.assertRunning()
 console.log('SHIP-004 shipping journey passed: profile form, places, grid and CSV assignment, ZIP quotes, free-shipping item, furniture basket and unserved ZIP at desktop and phone width')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
