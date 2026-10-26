import assert from 'node:assert/strict'
import { startJourney } from './journey-kit.mjs'
import { sendFile, solidPng } from '../api/network.mjs'

// AI-005: real agent preparation, cited review, selective approval and source refusals.
let journey, journeyError
try {
  journey = await startJourney({ name: 'merch-proposals', skus: ['synthetic-stall-1501'] })
  const { h, page, capture } = journey, sku = 'synthetic-stall-1501', collection = 'synthetic-stall-1502'
  const imageResponse = await sendFile(h, '/api/stall/media', solidPng(400, 400, [159, 117, 73]), 'image/png')
  assert.equal(imageResponse.status, 200)
  const image = await imageResponse.json()
  const details = { handle: 'synthetic-stall-1501', categories: ['Lighting'], attributes: [{ name: 'Finish', value: 'Brushed bronze' }], media: [{ id: image.id, kind: 'image', alt: 'Bronze table lamp on a desk' }] }
  let product = await h.command('product.prepare', { sku, name: 'Desk lamp', description: 'Adjustable table light.', unitCents: 4900, active: true, details })
  product = await h.command('product.approve', { sku, revision: product.revision })
  await h.command('collection.save', { handle: collection, title: 'Desk essentials', description: 'For the workspace.', kind: 'manual', skus: [], published: true })
  const credential = await h.api('/api/stall/agent-token', {}), agent = { as: '', headers: { authorization: `Bearer ${credential.token}` } }
  const bundle = await h.api(`/api/stall/merchandising?sku=${sku}`, undefined, agent)
  assert.ok(bundle.sources.some(source => source.id === `media:${image.id}`))
  const changes = [
    { field: 'name', value: 'Desk lamp · Lighting', citations: ['name', 'category:0'] },
    { field: 'description', value: 'Adjustable table light. · Brushed bronze', citations: ['description', 'attribute:0'] },
    { field: 'alt', target: image.id, value: 'Bronze table lamp on a desk · Desk lamp', citations: [`media:${image.id}`, 'name'] },
    { field: 'attribute', target: 'Finish', value: 'Brushed bronze', citations: ['attribute:0'] },
    { field: 'seoTitle', value: 'Desk lamp · Lighting', citations: ['name', 'category:0'] },
    { field: 'seoDescription', value: 'Adjustable table light.', citations: ['description'] },
    { field: 'collection', target: collection, value: collection, citations: [`collection:${collection}`] },
    { field: 'channel', value: 'google_product', citations: ['sku'] }
  ]
  const proposal = await h.command('merch.prepare', { sku, revision: bundle.revision, changes, requests: ['inventory', 'certification', 'reviews'] }, agent)
  // Fabricated claims go through the same public command transport as a real agent.
  for (const change of [
    { field: 'description', value: 'Certified safe for children', citations: ['description'] },
    { field: 'inventory', value: '100', citations: ['sku'] },
    { field: 'description', value: 'Five star customer favorite', citations: ['synthetic-stall-1503'] }
  ]) {
    const response = await h.request('/api/stall/commands', { method: 'POST', body: { type: 'merch.prepare', payload: { sku, revision: bundle.revision, changes: [change] } }, ...agent })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_CLAIM')
  }
  await page.goto(journey.ready.url + `/app#products/${sku}`)
  const panel = page.getByRole('region', { name: 'Merchandising proposals', exact: true }), draft = panel.locator(`[data-proposal-id="${proposal.id}"]`)
  await draft.getByText('Unsupported requests refused', { exact: true }).waitFor()
  await panel.getByText('What are the product measurements and size guidance?', { exact: true }).first().waitFor()
  await panel.getByText('What materials are confirmed by the merchant?', { exact: true }).first().waitFor()
  await panel.getByText('What safety instructions or restrictions are confirmed?', { exact: true }).first().waitFor()
  await panel.locator('summary', { hasText: 'Approved source bundle' }).click()
  await capture('AI-005-source-and-refusals', panel)
  await panel.locator('summary', { hasText: 'Approved source bundle' }).click()
  const select = field => draft.locator(`[data-change-field="${field}"]`).getByRole('checkbox')
  await select('seoTitle').check()
  await draft.getByRole('button', { name: 'Preview selected changes', exact: true }).click()
  await draft.getByRole('button', { name: 'Approve 1 selected change', exact: true }).waitFor()
  // A changed selection discards the previous exact preview.
  await select('alt').check()
  assert.equal(await draft.getByRole('button', { name: /^Approve \d+ selected/ }).count(), 0)
  await select('collection').check(); await select('channel').check()
  await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/stall/merchandising'), panel.getByRole('button', { name: 'Refresh proposals', exact: true }).click()])
  for (const field of ['seoTitle', 'alt', 'collection', 'channel']) assert.equal(await select(field).isChecked(), true, `refresh retains ${field}`)
  await draft.getByRole('button', { name: 'Preview selected changes', exact: true }).click()
  await draft.getByRole('button', { name: 'Approve 4 selected changes', exact: true }).waitFor()
  await draft.getByRole('region', { name: 'Channel feed validation' }).getByText('Valid mapping', { exact: true }).waitFor()
  await draft.getByText(/Inventory is a timestamped validation observation/).waitFor()
  await capture('AI-005-selective-review', draft)
  const selected = ['seoTitle', 'alt', 'collection', 'channel'].map(field => proposal.changes.find(change => change.field === field).id)
  await draft.getByRole('button', { name: 'Approve 4 selected changes', exact: true }).click()
  await panel.locator(`[data-proposal-id="${proposal.id}"] > summary`, { hasText: 'Approved' }).waitFor()
  const saved = (await h.api('/api/stall/state')).products.find(row => row.id === sku)
  assert.equal(saved.value.name, product.value.name)
  assert.equal(saved.value.description, product.value.description)
  assert.equal(saved.value.details.seo.title, changes.find(change => change.field === 'seoTitle').value)
  assert.equal(saved.value.details.seo.description, undefined)
  assert.equal(saved.value.details.media[0].alt, changes.find(change => change.field === 'alt').value)
  const approved = (await h.api(`/api/stall/merchandising?sku=${sku}`)).proposals.find(row => row.id === proposal.id)
  assert.deepEqual(approved.selected, selected)
  assert.equal(approved.feed.connected, false); assert.equal(approved.feed.valid, true)
  const group = (await h.api('/api/stall/state')).merchandising.collections.find(row => row.id === collection)
  assert.ok(group.value.skus.includes(sku))
  await panel.locator(`[data-proposal-id="${proposal.id}"] > summary`).click()
  await capture('AI-005-approved-selection', panel.locator(`[data-proposal-id="${proposal.id}"]`))
  // A draft open in the browser must refuse a product change that happened elsewhere.
  const freshBundle = await h.api(`/api/stall/merchandising?sku=${sku}`, undefined, agent)
  const stale = await h.command('merch.prepare', { sku, revision: freshBundle.revision, changes: [{ field: 'seoDescription', value: saved.value.description, citations: ['description'] }] }, agent)
  await panel.getByRole('button', { name: 'Refresh proposals', exact: true }).click()
  const staleDraft = panel.locator(`[data-proposal-id="${stale.id}"]`)
  await staleDraft.getByRole('checkbox').check()
  const revision = await h.command('product.prepare', { ...saved.value, approval: undefined, revision: saved.revision, description: 'Updated approved table light.' })
  await h.command('product.approve', { sku, revision: revision.revision })
  await staleDraft.getByRole('button', { name: 'Preview selected changes', exact: true }).click()
  await staleDraft.getByRole('alert').filter({ hasText: 'A cited source changed.' }).waitFor()
  const refused = await h.request('/api/stall/commands', { method: 'POST', body: { type: 'merch.approve', payload: { id: stale.id, revision: stale.revision, selected: stale.changes.map(change => change.id) } } })
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).error.code, 'SOURCE_CHANGED')
  await capture('AI-005-stale-refusal', staleDraft)
  await panel.getByRole('button', { name: 'Refresh proposals', exact: true }).click()
  await staleDraft.getByText('The product has changed.', { exact: false }).waitFor()
  assert.equal(await staleDraft.getByRole('button', { name: 'Preview selected changes', exact: true }).isDisabled(), true)
  assert.deepEqual(journey.errors, [])
  await journey.dev.assertRunning()
  console.log('AI-005 merchandising journey passed: source bundle, real agent grant, fabricated claim refusals, unanswered questions, exact selective review and approval, validated unconnected feed and stale source refusal at desktop and phone widths')
} catch (error) { journeyError = error; throw error }
finally { await journey?.finish(journeyError) }
