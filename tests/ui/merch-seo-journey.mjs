import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { volumeStock } from '../api/volume-stock.mjs'
import { solidPng } from '../api/network.mjs'
import { finishCleanup } from '../owned-dev.mjs'

// AI-005: the emitted Worker serves approved SEO from its own migrated native DB.
// Run after `rer build`. The only simulated boundary is the external stock desk.
const exec = promisify(execFile), persist = await mkdtemp(join(tmpdir(), 'stall-merch-seo-'))
const screenshots = resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/merch-seo'), stock = volumeStock(['synthetic-stall-1511'])
let worker, browser, edge, journeyError, cleaning, workerError
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function cleanup() {
  return cleaning ??= (async () => {
    await browser?.close()
    if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
      const exited = new Promise(resolve => worker.once('exit', resolve))
      worker.kill('SIGTERM')
      let timer
      try {
        if (!await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000) })])) {
          worker.kill('SIGKILL')
          await exited
        }
      } finally { clearTimeout(timer) }
    }
    if (edge?.listening) { edge.closeAllConnections(); await new Promise((resolve, reject) => edge.close(error => error ? reject(error) : resolve())) }
    await rm(persist, { recursive: true, force: true })
    await rm('dist/server/.wrangler', { recursive: true, force: true })
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
  const args = ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', config, '--port', String(port), ...Object.entries(bindings).flatMap(([key, value]) => ['--var', `${key}:${value}`])]
  worker = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  // Runtime output may contain synthetic credentials; consume it without logging it.
  worker.stdout.resume(); worker.stderr.resume(); worker.once('error', error => { workerError = error.code ?? 'spawn' })
  let ready = false
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.ok(!workerError && worker.exitCode === null, 'The owned emitted Worker stopped before readiness')
    try { ready = (await fetch(origin + '/health')).ok } catch {}
    if (ready) break
    await pause(250)
  }
  assert.ok(ready, 'The emitted Worker did not become healthy')
  let cookie = ''
  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', agent, bytes, mime } = {}) {
    return fetch(origin + path, { method, redirect: 'manual', headers: { origin, ...(agent ? { authorization: `Bearer ${agent}` } : cookie ? { cookie } : {}), 'content-type': mime ?? 'application/json' }, ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  async function api(path, body, options) {
    const response = await request(path, { body, ...options }), value = await response.json()
    assert.ok(response.ok, `${path} failed (${response.status}): ${value.error?.code ?? 'unknown'}`)
    return value
  }
  const command = async (type, payload, agent) => (await api('/api/stall/commands', { type, payload }, { agent })).result
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
  const sku = 'synthetic-stall-1511', title = 'Studio mug · Matte glaze', description = 'Hand-thrown mug · Matte glaze'
  let product = await command('product.prepare', { sku, name: 'Studio mug', description: 'Hand-thrown mug', unitCents: 2800, active: true, details: { handle: 'studio-mug', media, customFields: [{ key: 'finish', label: 'Finish', type: 'text', value: 'Matte glaze' }] } })
  product = await command('product.approve', { sku, revision: product.revision })
  const grant = await api('/api/stall/agent-token', {}), bundle = await api(`/api/stall/merchandising?sku=${sku}`, undefined, { agent: grant.token })
  assert.equal(bundle.sources.find(source => source.id === 'fact:finish').value, 'Matte glaze')
  const proposal = await command('merch.prepare', { sku, revision: bundle.revision, changes: [{ field: 'seoTitle', value: title, citations: ['name', 'fact:finish'] }, { field: 'seoDescription', value: description, citations: ['description', 'fact:finish'] }] }, grant.token)
  await command('merch.approve', { id: proposal.id, revision: proposal.revision, selected: proposal.changes.map(change => change.id) })
  const document = await fetch(origin + '/shop/studio-mug'), html = await document.text()
  assert.equal(document.status, 200)
  assert.ok(html.includes(`<title>${title}</title>`), 'Approved title is emitted in native SSR HTML')
  assert.ok(html.match(/<meta\b[^>]*name="description"[^>]*>/g)?.some(tag => tag.includes(`content="${description}"`)), 'Approved description is emitted in native SSR HTML')
  const saved = (await api('/api/stall/state')).products.find(row => row.id === sku)
  assert.deepEqual(saved.value.details.seo, { title, description })
  assert.equal(saved.value.name, 'Studio mug'); assert.equal(saved.value.description, 'Hand-thrown mug')
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/shop/studio-mug')
  await expect(page).toHaveTitle(title)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description)
  await page.getByRole('heading', { name: 'Studio mug', exact: true }).waitFor()
  await page.getByText('Matte glaze', { exact: true }).waitFor()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const thumbnail = page.getByRole('button', { name: 'Show image 2: Studio mug handle and glaze', exact: true }), tooltip = page.getByRole('tooltip', { name: 'Show image 2', exact: true })
    await page.mouse.move(0, 0); await thumbnail.evaluate(element => element.blur())
    await expect(tooltip).toBeHidden()
    const started = Date.now()
    await thumbnail.hover()
    assert.equal(await tooltip.isVisible(), false, 'Hover tooltip waits before appearing')
    await expect(tooltip).toBeVisible({ timeout: 1500 })
    assert.ok(Date.now() - started >= 250, 'Hover follows the shared approximately 300 ms delay')
    await thumbnail.click()
    await expect(page.locator('.st-gallery > img')).toHaveAttribute('alt', 'Studio mug handle and glaze')
    await page.keyboard.press('Escape'); await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
    await thumbnail.evaluate(element => element.blur())
    await thumbnail.focus()
    assert.equal(await tooltip.isVisible(), true, 'Keyboard focus reveals its tooltip immediately')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Product page overflows at ${width}`)
    await page.screenshot({ path: join(screenshots, `AI-005-native-seo-tooltip-${width}.png`), fullPage: true })
  }
  const withdrawn = await command('product.prepare', { ...saved.value, active: false, revision: saved.revision })
  await command('product.approve', { sku, revision: withdrawn.revision })
  const missing = await fetch(origin + '/shop/studio-mug'), missingHtml = await missing.text()
  assert.equal(missing.status, 404)
  assert.ok(!missingHtml.includes(`<title>${title}</title>`), 'Unpublished title is absent from SSR metadata')
  assert.ok(!missingHtml.includes(`content="${description}"`), 'Unpublished description is absent from SSR metadata')
  assert.equal((await page.goto(origin + '/shop/studio-mug')).status(), 404)
  await page.getByText('This product is not available', { exact: true }).waitFor()
  await expect(page).not.toHaveTitle(title)
  assert.deepEqual(errors, [])
  console.log('AI-005 native SEO journey passed: emitted Worker, native owner and agent auth, HTTP media upload, exact approved SSR metadata, unpublished metadata exclusion and thumbnail hover and focus tooltips at 1440 and 390')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
