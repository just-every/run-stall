import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { installation } from '../api/harness.mjs'
import { pierInstallation } from '../api/pier.mjs'
import { stripeEdge, publish, purchase, deliverWebhook } from '../api/network.mjs'
import { readCsv } from '../api/csv-reader.mjs'
import { startOwnedDev, finishCleanup } from '../owned-dev.mjs'

const exec = promisify(execFile), screenshots = resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/integration')
const scratch = await mkdtemp(join(tmpdir(), 'stall-integration-')), checkout = join(scratch, 'run-stall'), rerHome = join(scratch, 'rer-home')
let browser, dev, h, pier, journeyError, cleaning
await mkdir(screenshots, { recursive: true }); await mkdir(rerHome)
function cleanup() {
 return cleaning ??= (async () => {
 const results = await Promise.allSettled([browser?.close(), h?.close(), pier?.close(), dev?.stop()].filter(Boolean))
 const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
 if (failures.length) throw new AggregateError(failures, 'Owned integration-journey cleanup failed')
 await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
 })()
}
const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
try {
 await exec('git', ['clone', '--no-hardlinks', process.cwd(), checkout])
 dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
 const ready = await dev.ready
 pier = await pierInstallation()
 const edge = stripeEdge({ forward: pier.forward }), secret = 'whsec_' + randomBytes(32).toString('hex')
 h = await installation({ bindings: pier.bindings, outboundService: edge.handle })
 await h.command('connection.stripe', { secretKey: 'sk_test_' + randomBytes(16).toString('hex'), webhookSecret: secret })
 await publish(h, 'MUG-BLUE', 'Blue ceramic mug', 2450)
 await publish(h, 'TOWEL-NAT', 'Natural linen towel', 1800)
 const bought = await purchase(h, edge, { email: 'alex@example.test' })
 await deliverWebhook(h, secret, edge.pay(bought.session.id))
 let order = (await h.api('/api/stall/state')).orders[0]
 order = await h.command('shipment.prepare', { orderId: order.id, revision: order.revision, reference: 'USPS 9400 1000 0000 0000 0000 01' })
 order = await h.command('shipment.approve', { orderId: order.id, revision: order.revision })
 await h.command('refund.prepare', { orderId: order.id, revision: order.revision, kind: 'goodwill', amountCents: 500, reason: 'A late delivery; Alex keeps the goods' })
 browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = []
 page.on('pageerror', error => errors.push(error.message))
 await page.route('**/api/stall/**', async route => {
  const req = route.request(), url = new URL(req.url())
  const response = await h.request(url.pathname + url.search, { method: req.method(), ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
  await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await response.arrayBuffer()) })
 })
 await page.goto(ready.openUrl)
 await page.waitForURL(url => ['/setup', '/app'].includes(url.pathname))
 if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click() }
 await page.getByRole('heading', { name: 'Orders', level: 1, exact: true }).waitFor()
 async function capture(name, locator) {
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   await locator.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20))
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`)
   await page.screenshot({ path: join(screenshots, `INTEGRATION-001-${name}-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
 }
 // The human approves the existing draft. Stripe commits but its response is lost.
 edge.loseNextRefundResponse()
 await page.getByRole('button', { name: /Approve \$5.00 refund/ }).click()
 await page.getByRole('button', { name: 'Reconcile', exact: true }).waitFor()
 await capture('uncertain-order', page.locator('.st-order-panel'))
 await page.getByRole('link', { name: 'Settings', exact: true }).click()
 const history = page.getByLabel('Stripe operation history', { exact: true })
 await history.getByRole('heading', { name: 'Stripe operation history · 1 uncertain', exact: true }).waitFor()
 await capture('uncertain-history', history)
 // Recover through the public desk, without another refund POST.
 const writes = edge.calls.filter(call => call.method === 'POST').length
 await history.getByRole('link', { name: /^Order / }).first().click()
 await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
 await page.getByRole('button', { name: 'Refunds', exact: true }).click()
 await page.locator('#orders .st-order-id').first().click()
 await page.locator('.st-order-panel .st-badge').filter({ hasText: /^Succeeded$/ }).waitFor()
 await page.getByText('More actions', { exact: true }).click()
 await page.getByText('Recover an existing provider operation', { exact: true }).click()
 await capture('recovered-order', page.locator('.st-order-panel form').filter({ has: page.getByLabel('Existing Stripe checkout session ID') }))
 await page.getByRole('link', { name: 'Settings', exact: true }).click()
 await history.getByRole('heading', { name: 'Stripe operation history · 0 uncertain', exact: true }).waitFor()
 await capture('recovered-history', history)
 const downloading = page.waitForEvent('download')
 await page.locator('#business-exports').getByRole('button', { name: 'Stripe operations', exact: true }).click()
 const file = await downloading
 const records = readCsv(await readFile(await file.path(), 'utf8'))
 assert.equal(records.length, 2)
 assert.ok(records.every(record => record.status === 'response_observed' && record.providerId))
 await page.locator('#business-exports [role=status]').waitFor()
 await capture('download', page.locator('#business-exports'))
 assert.equal(edge.calls.filter(call => call.method === 'POST').length, writes)
 assert.equal(edge.refunds.size, 1)
 assert.equal((await h.api('/api/stall/state')).orders[0].refunds[0].status, 'succeeded')
 // Disconnect before a second approved effect; reconnect through Settings and
 // make its first (not replacement) write from the existing order.
 order = (await h.api('/api/stall/state')).orders[0]
 await h.command('refund.prepare', { orderId: order.id, revision: order.revision, kind: 'goodwill', amountCents: 200, reason: 'Additional delivery credit' })
 await page.reload()
 await page.getByRole('button', { name: 'Disconnect Stripe', exact: true }).click()
 await page.getByRole('button', { name: 'Connect Stripe', exact: true }).waitFor()
 await page.getByRole('link', { name: /^Orders/ }).click()
 const beforePrepared = edge.calls.filter(call => call.method === 'POST').length
 await page.getByRole('button', { name: /Approve \$2.00 refund/ }).click()
 await page.getByRole('button', { name: 'Reconcile', exact: true }).waitFor()
 await page.getByRole('link', { name: 'Settings', exact: true }).click()
 await history.locator('li').filter({ hasText: /Refund · Prepared · 0 write/ }).waitFor()
 await capture('prepared-history', history)
 assert.equal(edge.calls.filter(call => call.method === 'POST').length, beforePrepared)
 await page.getByLabel('Stripe secret key', { exact: true }).fill('sk_test_' + randomBytes(16).toString('hex'))
 await page.getByLabel(/^Webhook signing secret/).fill(secret)
 await page.getByRole('button', { name: 'Connect Stripe', exact: true }).click()
 await page.getByRole('button', { name: 'Save new Stripe keys', exact: true }).waitFor()
 await history.getByRole('link', { name: /^Order / }).first().click()
 await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
 await page.getByRole('button', { name: 'Refunds', exact: true }).click()
 await page.locator('#orders .st-order-id').first().click()
 await page.locator('.st-panel-block').filter({ has: page.getByRole('heading', { name: 'Refund · $2.00', exact: true }) }).locator('.st-badge').filter({ hasText: /^Succeeded$/ }).waitFor()
 await page.getByRole('link', { name: 'Settings', exact: true }).click()
 await history.getByRole('heading', { name: 'Stripe operation history · 0 uncertain', exact: true }).waitFor()
 await capture('prepared-recovered-history', history)
 assert.equal(edge.calls.filter(call => call.method === 'POST').length, beforePrepared + 1)
 assert.equal(edge.refunds.size, 2)
 assert.deepEqual(errors, [])
 await dev.assertRunning()
 console.log('INTEGRATION-001 browser journey passed: human approval, uncertain Stripe outcome, read-only recovery and truthful terminal history at 1440/390.')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
