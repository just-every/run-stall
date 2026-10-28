import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { installation } from '../api/harness.mjs'
import { stripeEdge, sendFile } from '../api/network.mjs'
import { volumeStock } from '../api/volume-stock.mjs'
import { startOwnedDev, finishCleanup } from '../owned-dev.mjs'

const exec = promisify(execFile)
/** An owned `rer dev` checkout serving the real UI, with its API requests sent to a migrated Worker over a fake stock desk and Stripe edge. */
export async function startJourney({ name, skus, stock, installationFactory, captureFullPage = true, screenshots = process.env.STALL_SCREENSHOTS ?? `test-results/${name}` }) {
  const scratch = await mkdtemp(join(tmpdir(), `stall-${name}-`)), checkout = join(scratch, 'run-stall'), rerHome = join(scratch, 'rer-home')
  const kit = { stock: stock ?? volumeStock(skus) }
  const progress = stage => console.log(`[${name}] ${stage}`)
  await mkdir(resolve(screenshots), { recursive: true }); await mkdir(rerHome)
  let cleaning
  const cleanup = () => cleaning ??= (async () => {
    await kit.browser?.close()
    const results = await Promise.allSettled([kit.h?.close(), kit.dev?.stop(), kit.stock?.close?.()].filter(Boolean))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, `Owned ${name} journey cleanup failed`)
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })()
  const interrupted = () => { void cleanup().then(() => process.exit(1), () => process.exit(1)) }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted)
  kit.finish = async journeyError => { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
  try {
  progress('Clone committed UI')
  await exec('git', ['clone', '--no-hardlinks', process.cwd(), checkout])
  progress('Start native development server')
  kit.dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
  kit.ready = await kit.dev.ready
  progress('Development server ready; start commerce Worker')
  kit.edge = stripeEdge({ forward: kit.stock.forward }); kit.secret = randomBytes(32).toString('hex')
  kit.h = installationFactory ? await installationFactory(kit) : await installation({ bindings: { ...(kit.stock.bindings ?? { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'test-stock-network-edge', PIER_CUSTOMER_ID: 'shop' }), STRIPE_SECRET_KEY: 'test-network-edge', STRIPE_WEBHOOK_SECRET: kit.secret }, outboundService: kit.edge.handle, onProgress:stage=>progress('Commerce '+stage) })
  progress('Commerce Worker ready; launch browser')
  kit.browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  kit.context = await kit.browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); kit.page = await kit.context.newPage(); kit.errors = []
  kit.page.on('pageerror', error => kit.errors.push(error.message))
  // Test transport to the real migrated commerce Worker; no application fixtures. File bodies pass through as bytes.
  await kit.context.route('**/api/stall/**', async route => {
    const req = route.request(), url = new URL(req.url()), type = req.headers()['content-type'] ?? '', raw = req.postDataBuffer()
    const response = raw && !type.startsWith('application/json')
      ? await sendFile(kit.h, url.pathname + url.search, raw, type, { as: url.pathname === '/api/stall/personalization/upload' ? '' : kit.h.cookie })
      : await kit.h.request(url.pathname + url.search, { method: req.method(), ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', ...(response.headers.get('content-disposition') ? { 'content-disposition': response.headers.get('content-disposition') } : {}) }, body: Buffer.from(await response.arrayBuffer()) })
  })
  progress('Open native owner entry')
  await kit.page.goto(kit.ready.openUrl)
  await kit.page.waitForURL(url => ['/setup', '/app'].includes(url.pathname))
  if (new URL(kit.page.url()).pathname === '/setup') { await kit.page.getByRole('checkbox').check(); await kit.page.getByRole('button', { name: 'Finish setup', exact: true }).click() }
  progress('Native UI ready')
  /** One screenshot per width, failing if the page scrolls sideways. */
  kit.capture = async (label, target = kit.page.locator('main'), shown = kit.page) => {
    const previousViewport = shown.viewportSize()
    for (const width of [1440, 390]) {
      await shown.setViewportSize({ width, height: 1000 })
      await target.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20))
      assert.ok(await shown.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflow at ${width}`)
      await shown.screenshot({ path: join(resolve(screenshots), `${label}-${width}.png`), fullPage: captureFullPage })
    }
    await shown.setViewportSize(previousViewport ?? { width: 1440, height: 1000 })
  }
  return kit
  } catch (error) { await kit.finish(error); throw error }
}
