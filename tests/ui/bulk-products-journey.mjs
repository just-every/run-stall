import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { installation } from '../api/harness.mjs'
import { startOwnedDev, finishCleanup } from '../owned-dev.mjs'

const exec = promisify(execFile), screenshots = resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/bulk-products')
const scratch = await mkdtemp(join(tmpdir(), 'stall-bulk-')), checkout = join(scratch, 'run-stall'), rerHome = join(scratch, 'rer-home')
let browser, dev, h, journeyError, cleaning
await mkdir(screenshots, { recursive: true }); await mkdir(rerHome)
function cleanup() {
 return cleaning ??= (async () => {
  const results = await Promise.allSettled([browser?.close(), h?.close(), dev?.stop()].filter(Boolean))
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures, 'Owned bulk journey cleanup failed')
  await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
 })()
}
const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
try {
 await exec('git', ['clone', '--no-hardlinks', process.cwd(), checkout])
 dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
 const ready = await dev.ready
 h = await installation()
 for (const [sku, name, unitCents] of [['MUG-BLUE', 'Blue ceramic mug', 2450], ['TOWEL-NAT', 'Natural linen towel', 1800]])
  await h.command('product.prepare', { sku, name, description: 'Handmade, ready for a personal touch.', unitCents, active: false })
 browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = []
 page.on('pageerror', error => errors.push(error.message))
 // Test transport to the real migrated commerce Worker; no application fixtures.
 await page.route('**/api/stall/**', async route => {
  const req = route.request(), url = new URL(req.url())
  const response = await h.request(url.pathname + url.search, { method: req.method(), ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
  await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await response.arrayBuffer()) })
 })
 await page.goto(ready.openUrl)
 await page.waitForURL(url => ['/setup', '/app'].includes(url.pathname))
 if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click() }
 async function capture(name, locator) {
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   await locator.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20))
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`)
   await page.screenshot({ path: join(screenshots, `CATALOG-002-${name}-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
 }
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit staged products', exact: true }).click()
 await page.getByLabel('Select MUG-BLUE', { exact: true }).check()
 await page.getByLabel('Select TOWEL-NAT', { exact: true }).check()
 await page.getByLabel('Product name · MUG-BLUE', { exact: true }).fill('Ocean glaze mug')
 await page.getByRole('textbox', { name: /^Description · MUG-BLUE/ }).fill('Maker text: <care> & handle gently.\nDishwasher safe.')
 await page.getByRole('textbox', { name: /^Unit price · USD · MUG-BLUE/ }).fill('27.125')
 assert.equal(await page.getByRole('button', { name: 'Review bulk edit (2)', exact: true }).isDisabled(), true)
 await capture('invalid-price', page.locator('form'))
 await page.getByRole('textbox', { name: /^Unit price · USD · MUG-BLUE/ }).fill('27.15')
 await page.getByRole('textbox', { name: /^Unit price · USD · TOWEL-NAT/ }).fill('19.50')
 await page.getByRole('button', { name: 'Review bulk edit (2)', exact: true }).click()
 const reviewed = page.getByLabel('Reviewed bulk changes', { exact: true })
 await reviewed.getByRole('heading', { name: 'Review exact changes', exact: true }).waitFor()
 assert.equal((await h.api('/api/stall/state')).products.find(p => p.id === 'MUG-BLUE').value.name, 'Blue ceramic mug')
 await capture('review', reviewed)
 // A concurrent native edit invalidates approval; retain all entered grid values.
 let towel = (await h.api('/api/stall/state')).products.find(p => p.id === 'TOWEL-NAT')
 await h.command('product.prepare', { ...towel.value, sku: towel.id, revision: towel.revision, name: 'Native towel edit', active: false })
 await page.getByRole('button', { name: 'Apply reviewed bulk edit', exact: true }).click()
 await page.getByRole('alert').waitFor()
 assert.equal(await page.getByRole('textbox', { name: /^Unit price · USD · MUG-BLUE/ }).inputValue(), '27.15')
 await capture('changed-review', page.getByRole('alert'))
 await page.getByRole('button', { name: 'Review bulk edit (2)', exact: true }).click()
 await page.getByRole('alert').waitFor({ state: 'hidden' })
 await page.getByRole('button', { name: 'Apply reviewed bulk edit', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit completed', exact: true }).waitFor()
 let state = await h.api('/api/stall/state'), mug = state.products.find(p => p.id === 'MUG-BLUE')
 assert.equal(mug.value.unitCents, 2715)
 assert.equal(mug.value.name, 'Ocean glaze mug')
 assert.equal(mug.value.description, 'Maker text: <care> & handle gently.\nDishwasher safe.')
 assert.ok(state.products.every(p => p.value.active === false))
 await capture('completed', reviewed)
 await page.getByRole('button', { name: 'Back to products', exact: true }).click()
 await page.getByRole('heading', { name: 'Products', exact: true }).waitFor()
 await capture('updated-products', page.locator('#products'))
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 await page.getByText('Source custody', { exact: true }).click()
 await capture('retained-source', page.getByRole('button', { name: 'Review undo', exact: true }))
 await page.getByRole('button', { name: 'Review undo', exact: true }).click()
 await page.getByRole('button', { name: 'Undo import', exact: true }).click()
 await page.getByText('Undo finished. Review the journal for preserved records.', { exact: true }).waitFor()
 state = await h.api('/api/stall/state')
 assert.equal(state.products.find(p => p.id === 'MUG-BLUE').value.unitCents, 2450)
 assert.equal(state.products.find(p => p.id === 'TOWEL-NAT').value.draft.name, 'Native towel edit')
 await capture('undone', page.getByText('Undo finished. Review the journal for preserved records.', { exact: true }))
 // A later native edit is retained while the other product reverses.
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit staged products', exact: true }).click()
 for (const sku of ['MUG-BLUE', 'TOWEL-NAT']) await page.getByLabel(`Select ${sku}`, { exact: true }).check()
 await page.getByRole('textbox', { name: /^Unit price · USD · MUG-BLUE/ }).fill('28.00')
 await page.getByRole('textbox', { name: /^Unit price · USD · TOWEL-NAT/ }).fill('20.00')
 await page.getByRole('button', { name: 'Review bulk edit (2)', exact: true }).click()
 await page.getByRole('button', { name: 'Apply reviewed bulk edit', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit completed', exact: true }).waitFor()
 mug = (await h.api('/api/stall/state')).products.find(p => p.id === 'MUG-BLUE')
 await h.command('product.prepare', { ...mug.value, sku: mug.id, revision: mug.revision, name: 'Keep this native mug revision', active: false })
 const protectedMug = (await h.api('/api/stall/state')).products.find(p => p.id === 'MUG-BLUE')
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 await page.getByRole('button', { name: 'Review undo', exact: true }).click()
 await page.getByRole('button', { name: 'Undo import', exact: true }).click()
 const outcomes = page.getByLabel('Product undo outcomes', { exact: true })
 await outcomes.getByText('MUG-BLUE · Kept', { exact: true }).waitFor()
 await outcomes.getByText('TOWEL-NAT · Reversed', { exact: true }).waitFor()
 state = await h.api('/api/stall/state')
 assert.deepEqual(state.products.find(p => p.id === 'MUG-BLUE'), protectedMug)
 assert.equal(state.products.find(p => p.id === 'TOWEL-NAT').value.unitCents, 1800)
 await capture('protected-undo', outcomes)
 assert.deepEqual(errors, [])
 await dev.assertRunning()
 console.log('CATALOG-002 bulk journey passed: exact-cent grid, read-only review, concurrent-edit refusal with retained input, staged apply, literal text, retained source, untouched reversal and named native-edit protection at 1440/390.')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
