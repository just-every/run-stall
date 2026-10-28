import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { volumeStock } from '../api/volume-stock.mjs'
import { readCsv } from '../api/csv-reader.mjs'
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
 await exec('git', ['-C', checkout, 'config', 'user.name', 'Run Edit Run fleet'])
 await exec('git', ['-C', checkout, 'config', 'user.email', ['fleet', 'runeditrun.com'].join('@')])
 dev = await startOwnedDev({ launcher: resolve('node_modules/@runeditrun/rer/global/rer.mjs'), checkout, env: { ...process.env, HOME: rerHome, RER_SERVER_JOURNEY: '1', RER_LOCAL_OPERATION: '' } })
 const ready = await dev.ready
 const stock = volumeStock(['synthetic-stall-1801-S', 'synthetic-stall-1801-M', ...Array.from({ length: 11 }, (_, index) => `synthetic-stall-${1802 + index}`)])
 h = await installation({ bindings: { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'synthetic-stall-1800', PIER_CUSTOMER_ID: 'shop' }, outboundService: stock.forward })
 for (const [sku, name, unitCents] of [['MUG-BLUE', 'Blue ceramic mug', 2450], ['TOWEL-NAT', 'Natural linen towel', 1800]])
  await h.command('product.prepare', { sku, name, description: 'Handmade, ready for a personal touch.', unitCents, active: false })
 browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = []
 page.on('pageerror', error => errors.push(error.message))
 // Test transport to the real migrated commerce Worker; no application fixtures.
 await page.route('**/api/stall/**', async route => {
  const req = route.request(), url = new URL(req.url())
  const response = await h.request(url.pathname + url.search, { method: req.method(), ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
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
 // Review a mixed CSV and explicitly acknowledge the value-invalid row.
 await page.getByRole('textbox', { name: /^CSV source/ }).fill('Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\nlinen-runner,Linen table runner,<p>Natural linen; hemmed by hand.</p>,RUNNER-NAT,34.50,FALSE\nbroken-runner,Unpriced sample,<p>Price needs correction.</p>,RUNNER-BAD,34.555,FALSE\n')
 await page.getByRole('button', { name: 'Run dry run', exact: true }).click()
 const acknowledgement = page.getByRole('checkbox', { name: /^Exclude the 1 rejected CSV rows/ })
 await acknowledgement.waitFor()
 assert.equal(await page.getByRole('button', { name: 'Apply reviewed import', exact: true }).isDisabled(), true)
 assert.ok(!(await h.api('/api/stall/state')).products.some(p => p.id === 'RUNNER-NAT'))
 await capture('mixed-preview', acknowledgement)
 await acknowledgement.check()
 await page.getByRole('button', { name: 'Apply reviewed import', exact: true }).click()
 await page.getByRole('button', { name: 'Import completed', exact: true }).waitFor()
 state = await h.api('/api/stall/state')
 assert.equal(state.products.find(p => p.id === 'RUNNER-NAT').value.unitCents, 3450)
 assert.ok(!state.products.some(p => p.id === 'RUNNER-BAD'))
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 const rejectedRows = page.getByLabel('Rejected CSV rows', { exact: true })
 await rejectedRows.getByRole('heading', { name: 'Rejected CSV rows', exact: true }).waitFor()
 assert.match(await rejectedRows.innerText(), /CSV row 3.*positive decimal/)
 await capture('mixed-applied', rejectedRows)
 await page.getByRole('button', { name: 'Review undo', exact: true }).click()
 await page.getByRole('button', { name: 'Undo import', exact: true }).click()
 await page.getByLabel('Product undo outcomes', { exact: true }).getByText('RUNNER-NAT · Reversed', { exact: true }).waitFor()
 assert.ok(!(await h.api('/api/stall/state')).products.some(p => p.id === 'RUNNER-NAT'))
 await capture('mixed-undone', page.getByLabel('Product undo outcomes', { exact: true }))
 // CATALOG-002 metadata uses the same public reviewed import and journal doors.
 const details = { costCents: 735, weightGrams: 350, dimensionsMm: { length: 120, width: 90, height: 100 }, taxCategory: 'ceramics', hsCode: '691200', countryOfOrigin: 'US', customFields: [{ key: 'care', label: 'Care', type: 'text', value: '<img src=x onerror=alert(1)> Hand wash' }] }
 const cell = value => '"' + JSON.stringify(value).replaceAll('"', '""') + '"'
 const metadataCSV = 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published,Stall Details\n' + Array.from({ length: 12 }, (_, index) => `meta-${index + 1},Metadata product ${index + 1},Reviewed facts,META-${index + 1},12.34,FALSE,${cell(details)}\n`).join('') + `meta-bad,Invalid weight,,META-BAD,12.34,FALSE,${cell({ weightGrams: 0 })}\n`
 await page.getByRole('textbox', { name: /^CSV source/ }).fill(metadataCSV)
 await page.getByRole('button', { name: 'Run dry run', exact: true }).click()
 await page.getByText('Stall Details replaces all optional details on each valid row, including any pending native details. Review the complete before-image; {} clears them. Tax and customs facts are not provider verified.', { exact: true }).waitFor()
 await page.getByText('Review planned product changes', { exact: true }).click()
 assert.ok(!(await h.api('/api/stall/state')).products.some(p => p.id === 'META-1'))
 await capture('metadata-review', page.getByText('Review planned product changes', { exact: true }))
 await page.getByRole('checkbox', { name: /^Exclude the 1 rejected CSV rows/ }).check()
 await page.getByRole('button', { name: 'Apply reviewed import', exact: true }).click()
 await page.getByRole('button', { name: 'Resume apply', exact: true }).waitFor()
 // Leave the source form and resume using only retained source in the journal.
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 await page.getByRole('button', { name: 'Resume apply from retained source', exact: true }).click()
 await page.getByText('Import completed.', { exact: true }).waitFor()
 state = await h.api('/api/stall/state')
 const metadata = state.products.filter(p => p.id.startsWith('META-'))
 assert.equal(metadata.length, 12)
 assert.ok(metadata.every(p => p.value.active === false))
 for (const item of metadata) assert.deepEqual(item.value.details, details)
 assert.ok(!state.products.some(p => p.id === 'META-BAD'))
 await capture('metadata-resumed', page.getByText('Import completed.', { exact: true }))
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('button', { name: 'Metadata product 1', exact: true }).click()
 const metadataPanel = page.getByRole('complementary', { name: 'Product META-1', exact: true })
 await metadataPanel.getByText('<img src=x onerror=alert(1)> Hand wash', { exact: true }).waitFor()
 assert.equal(await metadataPanel.locator('img').count(), 0)
 await capture('metadata-product', metadataPanel)
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 await page.getByRole('button', { name: 'Review undo', exact: true }).click()
 await page.getByRole('button', { name: 'Undo import', exact: true }).click()
 await page.getByRole('button', { name: 'Resume undo', exact: true }).waitFor()
 await page.getByRole('button', { name: 'Resume undo', exact: true }).click()
 await page.getByRole('button', { name: 'Undo import', exact: true }).click()
 await page.getByText('Undo finished. Review the journal for preserved records.', { exact: true }).waitFor()
 assert.ok(!(await h.api('/api/stall/state')).products.some(p => p.id.startsWith('META-')))
 await capture('metadata-undone', page.getByLabel('Product undo outcomes', { exact: true }))

 // Complete catalog grid: retain the existing editor components and review every field.
 const ids = Array.from({ length: 12 }, (_, index) => `synthetic-stall-${1801 + index}`)
 const richDetails = { ...details, customFields: [{ key: 'care', label: 'Care', type: 'text', value: 'Original care' }] }
 for (const [index, sku] of ids.entries()) await h.command('product.prepare', { sku, name: `Complete catalog ${index + 1}`, description: 'Grid before-image', unitCents: 1500 + index, active: false,
  details: { ...richDetails, ...(index === 0 ? { options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ sku: sku + '-S', options: { Size: 'S' }, unitCents: 1731 }, { sku: sku + '-M', options: { Size: 'M' }, unitCents: 1943 }] } : {}) } })
 const collectionId = 'synthetic-stall-1820'
 await h.command('collection.save', { handle: collectionId, title: 'Original collection', description: 'Before bulk', kind: 'manual', published: false, skus: [ids[0]] })
 await page.reload()
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit staged products', exact: true }).click()
 await page.getByRole('checkbox', { name: 'Edit complete catalog fields', exact: true }).check()
 for (const sku of ids) await page.getByLabel(`Select ${sku}`, { exact: true }).check()
 const first = page.getByLabel(`Bulk product ${ids[0]}`, { exact: true })
 await first.getByLabel(`Product name · ${ids[0]}`, { exact: true }).fill('Reviewed variant product')
 await first.getByRole('textbox', { name: /^Unit price · USD/ }).fill('23.41')
 await first.getByRole('combobox', { name: /^Publication ·/ }).selectOption('published')
 await first.getByText('Optional product details', { exact: true }).click()
 await first.getByLabel('Weight · g', { exact: true }).fill('425')
 await first.getByLabel('Length · mm', { exact: true }).fill('130')
 await first.getByLabel('Width · mm', { exact: true }).fill('95')
 await first.getByLabel('Height · mm', { exact: true }).fill('110')
 await first.getByLabel('Tax category', { exact: true }).fill('apparel')
 await first.getByLabel('HS code', { exact: true }).fill('610910')
 await first.getByLabel('Country of origin', { exact: true }).fill('CA')
 await first.getByLabel('Field value 1', { exact: true }).fill('Reviewed care instructions')
 await first.getByText('Options and variants', { exact: true }).first().click()
 await first.getByLabel('Variant 1 price · USD', { exact: true }).fill('21.37')
 await first.getByLabel('Variant 1 weight · g', { exact: true }).fill('125')
 await first.getByLabel('Variant 1 length · mm', { exact: true }).fill('10')
 await first.getByLabel('Variant 1 width · mm', { exact: true }).fill('20')
 await first.getByLabel('Variant 1 height · mm', { exact: true }).fill('30')
 await first.getByLabel('Variant 1 HS code', { exact: true }).fill('610910')
 await first.getByLabel('Variant 1 country of origin', { exact: true }).fill('CA')
 assert.equal(await first.getByRole('combobox', { name: /^Stock mode ·/ }).inputValue(), 'pier')
 await page.getByLabel(`Bulk product ${ids[1]}`, { exact: true }).getByRole('combobox', { name: /^Publication ·/ }).selectOption('archived')
 await page.getByLabel(`Select collection ${collectionId}`, { exact: true }).check()
 await page.getByLabel(`Collection title · ${collectionId}`, { exact: true }).fill('Reviewed collection')
 await page.getByRole('textbox', { name: /^Collection products ·/ }).fill(ids.slice(0, 2).join(', '))
 await page.getByLabel(`Published collection · ${collectionId}`, { exact: true }).check()
 const beforeNative = await h.api('/api/stall/exports/records')
 await page.getByRole('button', { name: 'Review bulk edit (13)', exact: true }).click()
 await page.getByRole('heading', { name: 'Review exact changes', exact: true }).waitFor()
 assert.deepEqual((await h.api('/api/stall/exports/records')).products, beforeNative.products)
 const accountControl = page.getByRole('button', { name: /^Account menu/ })
 await accountControl.focus()
 await page.getByRole('tooltip').filter({ hasText: 'Account menu' }).waitFor()
 assert.equal(await first.getByRole('textbox', { name: /^Product name ·/ }).evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 13), true)
 await capture('complete-grid-review', page.getByLabel('Reviewed bulk changes', { exact: true }))
 const later = (await h.api('/api/stall/state')).products.find(row => row.id === ids[11])
 await h.command('product.prepare', { ...later.value, sku: later.id, revision: later.revision, name: 'Concurrent native work', active: false })
 await page.getByRole('button', { name: 'Apply reviewed bulk edit', exact: true }).click()
 await page.getByRole('alert').waitFor()
 assert.equal(await first.getByLabel('Tax category', { exact: true }).inputValue(), 'apparel')
 assert.equal((await h.api('/api/stall/state')).products.find(row => row.id === ids[0]).value.name, 'Complete catalog 1')
 await page.getByRole('button', { name: 'Review bulk edit (13)', exact: true }).click()
 await page.getByRole('button', { name: 'Apply reviewed bulk edit', exact: true }).click()
 await page.getByRole('button', { name: 'Resume reviewed bulk edit', exact: true }).waitFor()
 await page.getByRole('button', { name: 'Resume reviewed bulk edit', exact: true }).click()
 await page.getByRole('button', { name: 'Bulk edit completed', exact: true }).waitFor()
 let native = await h.api('/api/stall/exports/records')
 const appliedProduct = native.products.find(row => row.id === ids[0]).value
 assert.equal(appliedProduct.name, 'Reviewed variant product')
 assert.equal(appliedProduct.unitCents, 2341)
 assert.equal(appliedProduct.active, true)
 assert.equal(appliedProduct.details.weightGrams, 425)
 assert.deepEqual(appliedProduct.details.dimensionsMm, { length: 130, width: 95, height: 110 })
 assert.equal(appliedProduct.details.taxCategory, 'apparel')
 assert.equal(appliedProduct.details.hsCode, '610910')
 assert.equal(appliedProduct.details.countryOfOrigin, 'CA')
 assert.equal(appliedProduct.details.customFields[0].value, 'Reviewed care instructions')
 assert.equal(appliedProduct.details.variants[0].unitCents, 2137)
 assert.equal(appliedProduct.details.variants[0].weightGrams, 125)
 assert.deepEqual(appliedProduct.details.variants[0].dimensionsMm, { length: 10, width: 20, height: 30 })
 assert.equal(appliedProduct.details.variants[0].hsCode, '610910')
 assert.equal(appliedProduct.details.variants[0].countryOfOrigin, 'CA')
 assert.equal(native.products.find(row => row.id === ids[1]).value.archived, true)
 assert.equal(native.collections.find(row => row.id === collectionId).value.title, 'Reviewed collection')
 assert.deepEqual(native.collections.find(row => row.id === collectionId).value.skus, ids.slice(0, 2))
 const publicVariants = (await h.api('/api/stall/catalogue', undefined, { as: '' })).items.map(row => row.sku)
 assert.deepEqual(publicVariants.sort(), [ids[0] + '-M', ids[0] + '-S'].sort())
 await capture('complete-grid-applied', page.getByLabel('Reviewed bulk changes', { exact: true }))
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 // Download the native file through the visible export door and upload edited complete records.
 const downloadPromise = page.waitForEvent('download')
 await page.getByRole('button', { name: 'Export native catalog CSV', exact: true }).click()
 const download = await downloadPromise
 const exportedCSV = await readFile(await download.path(), 'utf8'), exported = readCsv(exportedCSV)
 const exportedFirst = JSON.parse(exported.find(row => row.ID === ids[0]).Value)
 assert.deepEqual(exportedFirst.details, appliedProduct.details)
 assert.equal(exportedFirst.publication, 'published')
 assert.equal(exportedFirst.stockMode, 'pier')
 const fileRows = exported.filter(row => ids.includes(row.ID) || row.ID === collectionId).map(row => {
  const value = JSON.parse(row.Value)
  if (row.Kind === 'product') {
   value.unitCents += 100
   value.details.taxCategory = 'housewares'
   value.details.weightGrams = 510
   value.details.dimensionsMm = { length: 140, width: 100, height: 120 }
   value.details.hsCode = '691200'
   value.details.countryOfOrigin = 'US'
   value.details.customFields[0].value = 'File care instructions'
   if (value.details.variants) value.details.variants[0].unitCents = 2279
  } else { value.title = 'File collection'; value.skus = [ids[0], ids[2]] }
  return [row.Kind, row.ID, value]
 })
 fileRows.push(['product', 'synthetic-stall-1821', { ...exportedFirst, sku: 'synthetic-stall-1821', stockMode: 'untracked' }])
 const catalogCell = value => '"' + String(value).replaceAll('"', '""') + '"'
 const nativeCSV = 'Kind,ID,Value\n' + fileRows.map(([kind, id, value]) => [kind, id, JSON.stringify(value)].map(catalogCell).join(',')).join('\n') + '\n'
 await page.getByLabel('Choose a CSV file', { exact: true }).setInputFiles({ name: 'synthetic-stall-catalog.csv', mimeType: 'text/csv', buffer: Buffer.from(nativeCSV) })
 await page.getByRole('button', { name: 'Run dry run', exact: true }).click()
 await page.getByRole('checkbox', { name: /^Exclude the 1 rejected CSV rows/ }).waitFor()
 assert.deepEqual((await h.api('/api/stall/exports/records')).products, native.products)
 await capture('complete-file-review', page.getByText('Review planned product changes', { exact: true }))
 await page.getByRole('checkbox', { name: /^Exclude the 1 rejected CSV rows/ }).check()
 // A changed source review is also refused through the file form.
 const last = (await h.api('/api/stall/state')).products.find(row => row.id === ids[11])
 await h.command('product.prepare', { ...last.value, sku: last.id, revision: last.revision, name: 'Later file review edit', active: false })
 await page.getByRole('button', { name: 'Apply reviewed import', exact: true }).click()
 await page.getByRole('alert').waitFor()
 await page.getByRole('button', { name: 'Run dry run', exact: true }).click()
 await page.getByRole('checkbox', { name: /^Exclude the 1 rejected CSV rows/ }).check()
 await page.getByRole('button', { name: 'Apply reviewed import', exact: true }).click()
 await page.getByRole('button', { name: 'Resume apply', exact: true }).waitFor()
 await page.getByRole('link', { name: 'Products', exact: true }).click()
 await page.getByRole('link', { name: 'Move in', exact: true }).click()
 await page.getByRole('button', { name: 'View', exact: true }).first().click()
 await page.getByRole('button', { name: 'Resume apply from retained source', exact: true }).click()
 await page.getByText('Import completed.', { exact: true }).waitFor()
 native = await h.api('/api/stall/exports/records')
 for (const [kind, id, value] of fileRows.slice(0, -1)) {
  if (kind === 'product') {
   const actual = native.products.find(row => row.id === id).value
   assert.equal(actual.unitCents, value.unitCents)
   assert.deepEqual(actual.details, value.details)
  } else assert.deepEqual(native.collections.find(row => row.id === id).value, value)
 }
 assert.ok(!native.products.some(row => row.id === 'synthetic-stall-1821'))
 await capture('complete-file-resumed', page.getByText('Import completed.', { exact: true }))
 // Both jobs protect a subsequent native edit while untouched changes reverse.
 let firstCurrent = (await h.api('/api/stall/state')).products.find(row => row.id === ids[0])
 await h.command('product.prepare', { ...firstCurrent.value, sku: firstCurrent.id, revision: firstCurrent.revision, name: 'Keep complete native edit', active: true })
 const protectedFirst = (await h.api('/api/stall/state')).products.find(row => row.id === ids[0])
 for (let jobIndex = 0; jobIndex < 2; jobIndex++) {
  await page.getByRole('button', { name: 'View', exact: true }).nth(jobIndex).click()
  await page.getByRole('button', { name: 'Review undo', exact: true }).click()
  await page.getByRole('button', { name: 'Undo import', exact: true }).click()
  const resumeUndo = page.getByRole('button', { name: 'Resume undo', exact: true })
  if (await resumeUndo.isVisible()) { await resumeUndo.click(); await page.getByRole('button', { name: 'Undo import', exact: true }).click() }
  await page.getByText('Undo finished. Review the journal for preserved records.', { exact: true }).waitFor()
  await page.getByLabel('Product undo outcomes', { exact: true }).getByText(`${ids[0]} · Kept`, { exact: true }).waitFor()
  assert.deepEqual((await h.api('/api/stall/state')).products.find(row => row.id === ids[0]), protectedFirst)
 }
 assert.equal((await h.api('/api/stall/exports/records')).collections.find(row => row.id === collectionId).value.title, 'Original collection')
 await capture('complete-protected-undo', page.getByLabel('Product undo outcomes', { exact: true }))
 const sitePage = await context.newPage()
 for (const [path, name] of [['/docs/move-in', 'metadata-guide'], ['/docs/products', 'product-guide'], ['/contract', 'contract']]) {
  const response = await sitePage.goto(ready.siteUrl + path)
  assert.equal(response.status(), 200)
  for (const width of [1440, 390]) {
   await sitePage.setViewportSize({ width, height: 1000 })
   assert.ok(await sitePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} overflow at ${width}`)
   await sitePage.screenshot({ path: join(screenshots, `CATALOG-002-${name}-${width}.png`), fullPage: true })
  }
 }
 await sitePage.close()
 assert.deepEqual(errors, [])
 await dev.assertRunning()
 console.log('CATALOG-002 bulk journey passed: exact-cent grid, read-only review, concurrent-edit refusal with retained input, staged apply, literal text, retained source, untouched reversal and named native-edit protection, explicit mixed-row exclusion, metadata review/import/journal resume/undo and guides/contract at 1440/390.')
} catch (error) { journeyError = error; throw error }
finally { try { await finishCleanup(cleanup, journeyError) } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupted) } }
