import assert from 'node:assert/strict'
import { startJourney } from './journey-kit.mjs'
import { experimentFixture, seedBaseline, seedOrders, seedViews, backdate, ago, day, priceInput, budget, expSku, expVariant } from '../api/experiment-fixture.mjs'

// AI-003: measured price experiment from agent proposal to approval, stop rule, result and restore.
let journey, journeyError
try {
  journey = await startJourney({ name: 'experiments', skus: [expVariant] })
  const { h, page, capture } = journey
  const f = await experimentFixture(h)
  await seedBaseline(h)
  const read = () => h.api(`/api/stall/experiments?sku=${expSku}&days=7`, undefined, f.agent)
  const prepare = async (extra = {}) => h.command('experiment.prepare', priceInput((await read()).revision, extra), f.agent)
  const price = async () => (await h.api('/api/stall/catalogue', undefined, { as: '' })).items[0].unitCents
  const first = await prepare()
  await page.goto(journey.ready.url + `/app#products/${expSku}`)
  const panel = page.getByRole('region', { name: 'Measured experiments', exact: true }), card = id => panel.locator(`[data-experiment-id="${id}"]`)
  const refresh = () => panel.getByRole('button', { name: 'Refresh experiments', exact: true }).click()
  await card(first.id).locator('summary', { hasText: 'Awaiting review' }).waitFor()
  await card(first.id).getByText('A ten percent price cut should lift conversion', { exact: false }).waitFor()
  await card(first.id).getByText('break-even conversion change 76.47%', { exact: false }).waitFor()
  await card(first.id).getByText('Global Privacy Control', { exact: false }).waitFor()
  await panel.locator('summary', { hasText: 'Measured source bundle' }).click()
  await capture('AI-003-proposal', panel)
  await panel.locator('summary', { hasText: 'Measured source bundle' }).click()
  assert.equal(await price(), 2600)
  await card(first.id).getByRole('button', { name: 'Approve and start 7-day test', exact: true }).click()
  await card(first.id).locator('summary', { hasText: 'Running' }).waitFor()
  assert.equal(await price(), 2340)
  await backdate(h, first.id)
  for (const k of [1, 2, 3]) { const at = ago(k * day); await seedOrders(h, { count: 20, at, unitCents: 2340, refunded: k === 1 ? 2 : 0 }); await seedViews(h, { at, views: 400 }) }
  await refresh()
  await card(first.id).getByText('1200 page views · 60 orders', { exact: false }).waitFor()
  await card(first.id).getByRole('button', { name: 'Check stop rules', exact: true }).click()
  await card(first.id).locator('summary', { hasText: 'Running' }).waitFor()
  await h.db.prepare("UPDATE st_experiments SET value_json=json_set(value_json,'$.endsAt',?) WHERE id=?").bind(ago(3600000), first.id).run()
  await card(first.id).getByRole('button', { name: 'Check stop rules', exact: true }).click()
  const result = card(first.id).getByRole('region', { name: 'Experiment result' })
  await result.getByText('Margin eroded', { exact: true }).waitFor()
  await result.getByText('Conversion rose but margin per visit fell', { exact: false }).waitFor()
  await result.getByText('The earlier value was restored.', { exact: false }).waitFor()
  assert.equal(await price(), 2600)
  await capture('AI-003-result', card(first.id))

  const tight = await prepare({ budget: budget({ maxDiscountCents: 5000 }) })
  await refresh()
  await card(tight.id).getByRole('button', { name: 'Approve and start 7-day test', exact: true }).click()
  await card(tight.id).locator('summary', { hasText: 'Running' }).waitFor()
  await backdate(h, tight.id)
  await refresh()
  await card(tight.id).getByRole('alert').filter({ hasText: 'A stop rule is crossed: Discount spend reached' }).waitFor()
  await capture('AI-003-stop-rule', card(tight.id))
  await card(tight.id).getByRole('button', { name: 'Stop and restore', exact: true }).click()
  await card(tight.id).locator('summary', { hasText: 'Stopped and restored' }).waitFor()
  assert.equal(await price(), 2600)

  const stale = await prepare()
  await refresh()
  await card(stale.id).locator('summary', { hasText: 'Awaiting review' }).waitFor()
  const current = (await h.api('/api/stall/state')).products.find(row => row.id === expSku)
  const revised = await h.command('product.prepare', { ...current.value, approval: undefined, revision: current.revision, description: 'Updated approved description.' })
  await h.command('product.approve', { sku: expSku, revision: revised.revision })
  await refresh()
  await card(stale.id).getByText('The product has changed.', { exact: false }).waitFor()
  assert.equal(await card(stale.id).getByRole('button', { name: 'Approve and start 7-day test', exact: true }).isDisabled(), true)
  await capture('AI-003-stale-refusal', card(stale.id))

  // Icon-only controls on this screen show a tooltip.
  const bare = await page.locator('main button').evaluateAll(buttons => buttons.filter(button => !button.textContent.trim() && !button.closest('.st-tooltip')).map(button => button.getAttribute('aria-label') ?? button.outerHTML.slice(0, 80)))
  assert.deepEqual(bare, [])

  // A shopper's product page counts one anonymous view.
  const counted = async () => (await h.db.prepare('SELECT COALESCE(SUM(views),0) AS views FROM st_product_views').first()).views
  const before = await counted()
  const handle = 'studio-plate'
  await page.goto(`${journey.ready.url}/shop/${handle}`)
  await page.getByRole('heading', { name: 'Studio plate' }).first().waitFor()
  for (let attempt = 0; attempt < 50 && await counted() === before; attempt++) await page.waitForTimeout(100)
  assert.equal(await counted(), before + 1)
  assert.deepEqual(journey.errors, [])
  await journey.dev.assertRunning()
  console.log('AI-003 experiments journey passed: cited proposal, exact approval, live trial numbers, stop rule, margin-erosion result, restore, stale refusal and anonymous view count at desktop and phone widths')
} catch (error) { journeyError = error; throw error }
finally { await journey?.finish(journeyError) }
