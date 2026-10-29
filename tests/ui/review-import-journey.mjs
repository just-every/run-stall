import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { unstable_dev } from 'wrangler'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { volumeStock } from '../api/volume-stock.mjs'
import { solidPng } from '../api/network.mjs'
import { finishCleanup } from '../owned-dev.mjs'

// Run after `rer build`. The emitted Worker owns sessions, migrations and review data.
// Only the external stock desk is simulated; API coverage proves retired source media.
const exec = promisify(execFile), persist = await mkdtemp(join(tmpdir(), 'stall-review-import-'))
const screenshots = resolve(process.env.STALL_SCREENSHOTS ?? './test-results/reviews'), stock = volumeStock(['synthetic-stall-1511'])
stock.setAvailable('synthetic-stall-1511', '12')
let worker, browser, edge, page, journeyError, cleaning
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function cleanup() {
  return cleaning ??= (async () => {
    await browser?.close()
    await worker?.stop()
    if (edge?.listening) { edge.closeAllConnections(); await new Promise((resolve, reject) => edge.close(error => error ? reject(error) : resolve())) }
    await rm(persist, { recursive: true, force: true })
  })()
}
const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
try {
  await mkdir(screenshots, { recursive: true })
  edge = createServer(async (incoming, outgoing) => {
    try {
      assert.equal(incoming.method, 'GET'); assert.equal(incoming.url, '/api/pier/state')
      const response = await stock.forward(new Request('https://stock.example.test' + incoming.url))
      outgoing.writeHead(response.status, { 'content-type': 'application/json' }); outgoing.end(await response.text())
    } catch { outgoing.writeHead(502); outgoing.end('Stock edge request refused') }
  })
  await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve))
  const edgeOrigin = `http://127.0.0.1:${edge.address().port}`
  const portSocket = createServer()
  await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve))
  const port = portSocket.address().port
  await new Promise(resolve => portSocket.close(resolve))
  const origin = `http://127.0.0.1:${port}`, setup = randomBytes(32).toString('hex')
  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, config = 'dist/server/wrangler.json'
  await exec(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, '--config', config], { env })
  const bindings = { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', RER_DEMO: '0', RER_DEV_ORIGIN: '', OWNER_EMAIL: 'synthetic-stall-1512@example.test', SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'development', PIER_ORIGIN: edgeOrigin, PIER_SESSION: 'synthetic-stall-1513', PIER_CUSTOMER_ID: 'shop' }
  // Exercise one immutable production build. The CLI's default file/asset
  // watchers can replace its workerd while a native request is in flight,
  // surfacing a transport-only "Network connection lost" instead of a result.
  // Keep Wrangler's real bindings, assets and persisted D1, without HMR.
  worker = await unstable_dev('dist/server/index.js', {
    config, local: true, ip: '127.0.0.1', port, persistTo: persist,
    inspectorPort: 0, inspect: false, vars: bindings, logLevel: 'none',
    experimental: { watch: false, liveReload: false, disableExperimentalWarning: true },
  })
  let stopped = false
  void worker.waitUntilExit().then(() => { stopped = true })
  let ready = false
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.ok(!stopped, 'The owned emitted Worker stopped before readiness')
    try { ready = (await fetch(origin + '/health')).ok } catch {}
    if (ready) break
    await pause(250)
  }
  assert.ok(ready, 'The emitted Worker did not become healthy')
  let cookie = ''
  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', bytes, mime } = {}) {
    return fetch(origin + path, { method, redirect: 'manual', headers: { origin, ...(cookie ? { cookie } : {}), 'content-type': mime ?? 'application/json' }, ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  async function api(path, body, options) {
    const response = await request(path, { body, ...options }), value = await response.json()
    assert.ok(response.ok, `${path} failed (${response.status}): ${value.error?.code ?? 'unknown'}`)
    return value
  }
  const command = async (type, payload) => (await api('/api/stall/commands', { type, payload })).result
  const boot = await request('/auth/bootstrap', { body: { token: setup, displayName: 'Studio owner' } })
  assert.equal(boot.status, 303)
  cookie = boot.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Native owner bootstrap returned no session')
  const media = []
  for (const [index, color] of [[1, [155, 122, 83]], [2, [87, 128, 141]]]) {
    const uploaded = await request('/api/stall/media', { method: 'POST', bytes: solidPng(400, 400, color), mime: 'image/png' })
    assert.equal(uploaded.status, 200)
    media.push({ id: (await uploaded.json()).id, kind: 'image', alt: index === 1 ? 'Studio mug from the front' : 'Studio mug handle and glaze' })
  }
  const sku = 'synthetic-stall-1511'
  const productCSV = 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\nstudio-mug,Studio mug,Hand-thrown mug,synthetic-stall-1511,28.00,TRUE\n'
  const productPreview = await api('/api/stall/imports/preview', { csv: productCSV })
  await api('/api/stall/imports/apply', { csv: productCSV, fingerprint: productPreview.fingerprint })
  const importedProduct = (await api('/api/stall/state')).products.find(row => row.id === sku)
  const product = await command('product.prepare', { sku, revision: importedProduct.revision, name: 'Studio mug', description: 'Hand-thrown mug', unitCents: 2800, active: true, details: { handle: 'studio-mug', media } })
  await command('product.approve', { sku, revision: product.revision })
  const native = await api('/api/stall/reviews', { productId: sku, rating: 4, title: 'Native review', body: 'Already here', reviewerName: 'Native shopper', date: '2024-01-01T00:00:00Z' })
  const publicReviews = async () => {
    const response = await fetch(origin + '/api/stall/reviews?handle=studio-mug')
    assert.equal(response.status, 200)
    return response.json()
  }
  const initial = await publicReviews()
  assert.equal(initial.reviews.length, 1)
  assert.equal(initial.reviews[0].id, native.id)

  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addCookies(cookie.split('; ').map(value => {
    const split = value.indexOf('=')
    return { name: value.slice(0, split), value: value.slice(split + 1), url: origin, httpOnly: true, sameSite: 'Lax' }
  }))
  page = await context.newPage(); const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/app')
  await page.getByRole('checkbox', { name: 'I confirm this owner account is ready to use.' }).check()
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
  await page.waitForURL(origin + '/app')

  async function capture(label, target, assertions = async () => {}) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await assertions(width)
      await target.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflows at ${width}`)
      await target.screenshot({ path: join(screenshots, `${label}-${width}.png`) })
    }
  }
  async function tooltipProof(control, label) {
    const tooltip = page.getByRole('tooltip', { name: label, exact: true })
    await page.mouse.move(0, 0); await control.evaluate(element => element.blur())
    await expect(tooltip).toBeHidden()
    const started = Date.now()
    await control.hover()
    assert.equal(await tooltip.isVisible(), false, `${label} hover waits before appearing`)
    await expect(tooltip).toBeVisible({ timeout: 1500 })
    assert.ok(Date.now() - started >= 250, `${label} follows the shared hover delay`)
    await page.keyboard.press('Escape'); await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
    await control.evaluate(element => element.blur()); await control.focus()
    assert.equal(await tooltip.isVisible(), true, `${label} focus reveals the tooltip immediately`)
    await page.keyboard.press('Escape'); await control.evaluate(element => element.blur())
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await tooltipProof(page.getByRole('button', { name: 'Account menu for Studio owner', exact: true }), 'Account menu')
  }
  await page.getByRole('navigation', { name: 'Shop desk', exact: true }).getByRole('link', { name: 'Move in', exact: true }).click()
  const desk = page.getByRole('region', { name: 'Bring your reviews', exact: true })
  await desk.getByRole('heading', { name: 'Bring your reviews', exact: true }).waitFor()
  await desk.getByText('No review imports yet.', { exact: true }).waitFor()
  await expect(desk.getByRole('status', { name: '' }).filter({ hasText: 'Showing 0 of 0 review imports.' })).toBeVisible()
  const source = desk.getByLabel('Review source', { exact: true })
  const upload = desk.getByLabel('Choose a review CSV file', { exact: true })
  const run = desk.getByRole('button', { name: 'Run review dry run', exact: true })
  const apply = desk.getByRole('button', { name: 'Apply reviewed reviews', exact: true })
  const approval = desk.getByRole('checkbox', { name: /^I reviewed these rows, product matches and exclusions/ })
  const definitions = label => desk.locator('.st-counts > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  const previewResponse = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/stall/review-imports/preview' && response.request().method() === 'POST')
  async function dryRun(action) {
    const pending = previewResponse()
    await action()
    const response = await pending
    assert.ok(response.ok(), `Review dry run failed (${response.status()})`)
    await expect(run).toBeEnabled()
    return response.json()
  }
  const imports = []
  const sources = [
    { id: 'judge-me', label: 'Judge.me', fixture: './fixtures/reviews-judge.csv', lead: 'Morning favourite', second: 'Solid everyday cup', orphan: 'Old collection', date: '2026-09-17', reply: 'Thank you for sharing.', verified: true },
    { id: 'yotpo', label: 'Yotpo', fixture: './fixtures/reviews-yotpo.csv', lead: 'Excellent glaze', second: 'Nice size', orphan: 'From the archive', date: '2026-09-20T09:30:00Z', reply: 'Thank you for the photo.', verified: true },
  ]
  for (const item of sources) {
    // Preserve the published fixture columns and multiline content. Media copying is
    // exercised by the API suite with a bounded external edge, never a live website.
    const csv = (await readFile(item.fixture, 'utf8')).replaceAll('https://reviews.example.test/photo.png', '')
    await source.selectOption(item.id)
    await upload.setInputFiles({ name: item.fixture.split('/').at(-1), mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(desk.getByRole('textbox', { name: 'Review CSV source', exact: true })).toHaveValue(csv)
    const before = await publicReviews()
    let preview = await dryRun(() => run.click())
    assert.deepEqual(preview.counts, { total: 3, mapped: 1, orphans: 2, duplicates: 0 })
    assert.deepEqual(await publicReviews(), before, 'A dry run leaves public reviews unchanged')
    await expect(apply).toBeDisabled(); await expect(approval).toBeDisabled()
    const row = title => desk.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    await capture(`MIGRATE-007-${item.id}-dry-run`, desk, async () => {
      await source.focus(); await page.keyboard.press('Tab'); await expect(upload).toBeFocused()
      await page.keyboard.press('Tab'); await expect(desk.getByRole('textbox', { name: 'Review CSV source', exact: true })).toBeFocused()
      await page.keyboard.press('Tab'); await expect(run).toBeFocused()
      await expect(row(item.lead).locator('time')).toHaveAttribute('datetime', item.date)
      await expect(row(item.second).getByText('Needs a product', { exact: true })).toBeVisible()
      await expect(row(item.orphan).getByText('Needs a product', { exact: true })).toBeVisible()
      await expect(definitions('Orphans')).toHaveText('2')
    })
    const secondRow = preview.rows.find(entry => entry.title === item.second).row
    preview = await dryRun(() => desk.getByRole('combobox', { name: `Product for CSV row ${secondRow}`, exact: true }).selectOption(sku))
    assert.deepEqual(preview.counts, { total: 3, mapped: 2, orphans: 1, duplicates: 0 })
    await expect(approval).toBeDisabled()
    const orphanRow = preview.rows.find(entry => entry.title === item.orphan).row
    preview = await dryRun(() => desk.getByRole('checkbox', { name: `Exclude CSV row ${orphanRow} from this import.`, exact: true }).check())
    await expect(approval).toBeEnabled(); await expect(approval).not.toBeChecked()
    await expect(apply).toBeDisabled()
    await approval.check()
    await capture(`MIGRATE-007-${item.id}-reviewed`, desk, async () => {
      await expect(approval).toBeChecked(); await expect(apply).toBeEnabled()
      await expect(row(item.lead).getByText(item.verified ? `Verified purchase claimed by ${item.label}` : 'No verified purchase claim', { exact: true })).toBeVisible()
    })
    const applying = page.waitForResponse(response => new URL(response.url()).pathname === '/api/stall/review-imports/apply' && response.request().method() === 'POST')
    await apply.click()
    const applied = await applying
    assert.ok(applied.ok(), `Review import failed (${applied.status()})`)
    const job = await applied.json()
    imports.push({ ...item, job })
    await desk.getByText(`Imported 2 reviews from ${item.label}.`, { exact: true }).waitFor()
    const after = await publicReviews(), lead = after.reviews.find(review => review.title === item.lead)
    assert.equal(after.reviews.length, before.reviews.length + 2)
    assert.equal(lead.source, item.id); assert.equal(lead.imported, true)
    assert.equal(lead.sourceVerified, item.verified); assert.equal(lead.verifiedPurchase, false)
    assert.equal(lead.date, item.date); assert.equal(lead.reply, item.reply)
    assert.ok(!after.reviews.some(review => review.title === item.orphan), 'An excluded orphan is never published')
    if (item.id === 'judge-me') assert.equal(after.reviews.find(review => review.title === item.second).body, 'A useful size.\nThe colour matches our kitchen.')
    preview = await dryRun(() => run.click())
    assert.deepEqual(preview.counts, { total: 3, mapped: 0, orphans: 1, duplicates: 2 })
    await capture(`MIGRATE-007-${item.id}-duplicates`, desk, async () => {
      await expect(row(item.lead).getByText('Duplicate', { exact: true })).toBeVisible()
      await expect(row(item.second).getByText('Duplicate', { exact: true })).toBeVisible()
      await expect(apply).toBeDisabled(); await expect(approval).toBeDisabled()
      await expect(definitions('Duplicates')).toHaveText('2')
    })
    assert.deepEqual(await publicReviews(), after, 'Duplicate dry run preserves every review')
    await expect(desk.getByText(`Showing ${imports.length} of ${imports.length} review imports.`, { exact: true })).toBeVisible()
  }

  const all = await publicReviews()
  assert.equal(all.reviews.length, 5)
  assert.ok(all.reviews.every(review => review.verifiedPurchase === false))
  const document = await fetch(origin + '/shop/studio-mug'), html = await document.text()
  assert.equal(document.status, 200)
  assert.ok(html.includes('Imported from Judge.me') && html.includes('Imported from Yotpo'), 'Imported labels are emitted in the initial product HTML')
  const scripts = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]))
  const structured = scripts.find(value => value['@type'] === 'Product')
  assert.ok(structured, 'Native product HTML emits Product structured data')
  assert.equal(structured.sku, sku)
  assert.equal(structured.aggregateRating['@type'], 'AggregateRating')
  assert.equal(structured.aggregateRating.reviewCount, all.reviews.length)
  assert.equal(structured.aggregateRating.ratingValue, all.aggregate.ratingValue)
  assert.equal(structured.review.length, all.reviews.length)
  for (const item of sources) {
    const review = structured.review.find(review => review.name === item.lead)
    assert.equal(review['@type'], 'Review'); assert.equal(review.datePublished, item.date)
    assert.equal(review.reviewRating.ratingValue, 5)
  }
  await page.goto(origin + '/shop/studio-mug')
  const reviews = page.locator('section.st-store-panel').filter({ has: page.getByRole('heading', { name: 'Customer reviews', exact: true }) })
  await capture('MIGRATE-007-imported-product', page.locator('main'), async () => {
    for (const item of sources) {
      const review = reviews.getByRole('article').filter({ has: page.getByRole('heading', { name: item.lead, exact: true }) })
      await expect(review.getByText(`Imported from ${item.label}${item.verified ? ` · Verified by ${item.label}` : ''}`, { exact: true })).toBeVisible()
      await expect(review.locator('time')).toHaveAttribute('datetime', item.date)
      await expect(review.getByText(item.reply, { exact: true })).toBeVisible()
    }
    await expect(reviews.getByText('Merchant-entered review', { exact: true })).toBeVisible()
    await expect(reviews.getByText('Already here', { exact: true })).toBeVisible()
    await expect(reviews.getByText('Verified purchase', { exact: true })).toHaveCount(0)
    const thumbnail = page.getByRole('button', { name: 'Show image 2: Studio mug handle and glaze', exact: true })
    await tooltipProof(thumbnail, 'Show image 2')
    await thumbnail.click()
    await expect(page.locator('.st-gallery > img')).toHaveAttribute('alt', 'Studio mug handle and glaze')
  })

  await page.goto(origin + '/app#move-in')
  await desk.getByRole('heading', { name: 'Bring your reviews', exact: true }).waitFor()
  for (const item of imports) {
    const history = desk.getByRole('article').filter({ has: page.getByRole('heading', { name: `${item.label} · 2 reviews`, exact: true }) })
    await history.getByRole('button', { name: /^Review undo/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Undo this review import?', exact: true })
    const before = await publicReviews()
    await capture(`MIGRATE-007-${item.id}-undo-confirmation`, dialog, async () => {
      await expect(dialog.getByText(/Existing reviews from other imports remain/)).toBeVisible()
    })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.deepEqual(await publicReviews(), before, 'Canceling undo preserves all reviews')
    await history.getByRole('button', { name: /^Review undo/ }).click()
    const undoing = page.waitForResponse(response => new URL(response.url()).pathname === `/api/stall/review-imports/${item.job.id}/undo`)
    await dialog.getByRole('button', { name: 'Undo review import', exact: true }).click()
    const undone = await undoing
    assert.ok(undone.ok(), `Review undo failed (${undone.status()})`)
    await expect(dialog).toBeHidden()
    await expect(history.getByRole('button', { name: /^Review undo/ })).toHaveCount(0)
    const remaining = await publicReviews()
    assert.deepEqual(remaining.reviews, before.reviews.filter(review => review.source !== item.id), 'Undo removes only the selected import')
    assert.deepEqual(remaining.reviews.find(review => review.id === native.id), initial.reviews[0], 'Undo preserves the original native review')
    await capture(`MIGRATE-007-${item.id}-undone`, desk, async () => {
      await expect(history.getByText('Undone', { exact: true })).toBeVisible()
    })
  }
  await page.goto(origin + '/shop/studio-mug')
  await capture('MIGRATE-007-native-review-preserved', reviews, async () => {
    await expect(reviews.getByRole('heading', { name: 'Native review', exact: true })).toBeVisible()
    await expect(reviews.getByRole('article')).toHaveCount(1)
    await expect(reviews.locator('time')).toHaveAttribute('datetime', '2024-01-01T00:00:00.000Z')
  })
  const hostile = '<img id=synthetic-stall-1521 src=x onerror=globalThis.x=1>'
  const hostileInput = { source: 'judge-me', csv: 'product_handle,rating,title,body,reviewer_name,reply,review_date\n' + ['studio-mug', 2, hostile, hostile, hostile, hostile, '2024-05-06'].join(',') + '\n' }
  const hostilePreview = await api('/api/stall/review-imports/preview', hostileInput)
  await api('/api/stall/review-imports/apply', { ...hostileInput, fingerprint: hostilePreview.fingerprint })
  await page.goto(origin + '/shop/studio-mug')
  await capture('MIGRATE-007-hostile-review-inert', reviews, async () => {
    const review = reviews.getByRole('article').filter({ has: page.getByRole('heading', { name: hostile, exact: true }) })
    await expect(review).toBeVisible()
    assert.equal(await review.textContent().then(text => text.split(hostile).length - 1), 4, 'Title, body, display name and reply stay literal')
    await expect(page.locator('#synthetic-stall-1521')).toHaveCount(0)
    assert.equal(await page.evaluate(() => globalThis.x), undefined)
  })
  for (let index = 0; index < 100; index++) {
    const input = { source: 'shopify', csv: 'id,product_handle,rating,body,created_at\nsynthetic-stall-ui-history-' + index + ',studio-mug,3,History window review,2024-06-07\n' }
    const preview = await api('/api/stall/review-imports/preview', input)
    await api('/api/stall/review-imports/apply', { ...input, fingerprint: preview.fingerprint })
  }
  await page.goto(origin + '/app#move-in')
  const historyCount = desk.getByText('Showing 100 of 103 review imports.', { exact: true })
  const older = desk.getByRole('button', { name: 'Show older review imports', exact: true })
  await capture('MIGRATE-007-history-count', historyCount, async () => {
    await expect(historyCount).toBeVisible(); await expect(older).toBeVisible()
  })
  await capture('MIGRATE-007-history-older-control', older)
  await older.click()
  await capture('MIGRATE-007-history-complete', desk.getByText('Showing 103 of 103 review imports.', { exact: true }), async () => {
    await expect(older).toHaveCount(0)
    for (const item of imports) await expect(desk.getByRole('heading', { name: `${item.label} · 2 reviews`, exact: true })).toBeVisible()
  })
  assert.deepEqual(errors, [])
  console.log('PASS MIGRATE-007: emitted Worker, native sessions and public uploads, both CSV dry runs, explicit remap and orphan exclusion, reviewed apply, original dates and replies, source claims without native purchase verification, public Product, Review and AggregateRating data, duplicate rerun and scoped undo at 1440 and 390. Browser CSV uploads omit source photos; API coverage proves media copying after source retirement.')
} catch (error) { journeyError = error; if (page) { console.log('Review journey failure at ' + new URL(page.url()).pathname + new URL(page.url()).hash); console.log(await page.locator('main select').evaluateAll(elements => elements.map(element => ({ label: element.labels?.[0]?.textContent, name: element.getAttribute('aria-label') })))); await page.screenshot({ path: join(screenshots, 'failure.png'), fullPage: true }).catch(() => {}) } throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
