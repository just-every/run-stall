import assert from 'node:assert/strict'
import { startJourney } from './journey-kit.mjs'
import { resolve } from 'node:path'
import { publish, purchase, deliverWebhook } from '../api/network.mjs'

// RETURN-001 intake only: native invited-member identity, no received-goods evidence.
let journey, journeyError
try {
  journey = await startJourney({ name: 'requests', skus: ['MUG-BLUE'] })
  const { h, page, ready, edge, secret, capture, context } = journey
  await publish(h, 'MUG-BLUE', 'Blue ceramic mug', 2450)
  const ownEmail = 'synthetic-stall-901@example.test', member = await h.signIn(ownEmail), other = await h.signIn('synthetic-stall-902@example.test')
  const owner = (await h.api('/auth/session')).operator
  const hidden = await purchase(h, edge, { skus: ['MUG-BLUE'], quantities: [1], email: 'synthetic-stall-902@example.test' })
  await deliverWebhook(h, secret, edge.pay(hidden.session.id))
  let as = ''
  await context.route('**/api/stall/**', async route => {
    const req = route.request(), url = new URL(req.url())
    const response = await h.request(url.pathname + url.search, { method: req.method(), as, ...(req.postData() ? { body: JSON.parse(req.postData()) } : {}) })
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await response.arrayBuffer()) })
  })
  const rules = []
  for (const width of [1440, 390]) {
    const bought = await purchase(h, edge, { skus: ['MUG-BLUE'], quantities: [1], email: ownEmail })
    await deliverWebhook(h, secret, edge.pay(bought.session.id))
    const before = (await h.api('/api/stall/state')).orders.find(o => o.id === bought.orderId)
    await page.setViewportSize({ width, height: 1000 })
    as = ''; await page.goto(ready.url + '/order')
    await page.getByRole('link', { name: 'Sign in to your invited account', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Request staff review', exact: true }).count(), 0)
    await capture(`RETURN-001-signin-${width}`)
    as = member; await page.reload()
    const form = page.getByRole('form', { name: 'Request order help', exact: true })
    await form.getByLabel('Order', { exact: true }).selectOption(bought.orderId)
    assert.ok(!(await page.locator('main').innerText()).includes(hidden.orderId))
    assert.equal(await form.getByLabel('Order', { exact: true }).locator(`option[value="${hidden.orderId}"]`).count(), 0)
    // The server refuses direct substitution even when no UI offers the foreign order.
    assert.equal(await page.evaluate(async id => (await fetch('/api/stall/customer-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: id, kind: 'return' }) })).status, hidden.orderId), 404)
    await capture(`RETURN-001-form-${width}`, form)
    const ids = []
    for (const kind of ['return', 'cancellation']) {
      await page.setViewportSize({ width, height: 1000 })
      await form.getByLabel('Request type', { exact: true }).selectOption(kind)
      const submit = async () => {
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stall/customer-requests' && r.request().method() === 'POST')
        await form.getByRole('button', { name: 'Request staff review', exact: true }).click()
        const done = await response; assert.ok(done.ok(), await done.text()); const receipt = await done.json()
        await page.getByText('Request received for staff review.', { exact: true }).waitFor()
        return receipt.request.id
      }
      const id = await submit(); assert.equal(await submit(), id, 'repeat UI submission keeps one request')
      ids.push(id)
      await capture(`RETURN-001-${kind}-received-${width}`)
    }
    assert.deepEqual((await h.api('/api/stall/state')).orders.find(o => o.id === bought.orderId), before, 'intake moves no order, stock or money')
    as = other; await page.reload()
    assert.ok(!(await page.getByRole('combobox', { name: 'Order', exact: true }).innerText()).includes(bought.orderId))
    as = h.cookie; await page.goto(ready.url + '/app#requests')
    await page.getByRole('heading', { name: 'Customer requests', exact: true, level: 1 }).waitFor()
    for (const id of ids) await page.getByRole('article', { name: `Request ${id}`, exact: true }).waitFor()
    if (width === 1440) {
      assert.equal((await h.api('/api/stall/workflows')).tasks.length, 0, 'owner sees intake without a rule')
      for (const trigger of ['return_request', 'cancellation_request']) {
        const { result: rule } = await h.api('/api/stall/workflows', { type: 'workflow.save', payload: { rule: { name: `Review ${trigger}`, trigger, assigneeId: owner.id, dueMinutes: 60, notifyStaff: true, action: 'task', conditions: {} } } })
        await h.api('/api/stall/workflows', { type: 'workflow.activate', payload: { id: rule.id, revision: rule.revision } }); rules.push(rule.id)
      }
    }
    await capture(`RETURN-001-staff-intake-${width}`)
    // Existing workflow UI performs the explicit scan; each request generates one task/alert.
    await page.goto(ready.url + '/app#settings')
    await page.getByRole('button', { name: 'Run active workflows now', exact: true }).click()
    await page.getByText('Workflow state saved.', { exact: true }).waitFor()
    let workflow = await h.api('/api/stall/workflows')
    for (const id of ids) {
      const tasks = workflow.tasks.filter(task => task.eventKey === 'request:' + id)
      assert.equal(tasks.length, 1); assert.ok(rules.includes(tasks[0].ruleId))
      assert.equal(workflow.notifications.filter(n => n.taskId === tasks[0].id).length, 1)
    }
    await page.getByRole('button', { name: 'Run active workflows now', exact: true }).click()
    await page.getByText('Workflow state saved.', { exact: true }).waitFor()
    workflow = await h.api('/api/stall/workflows')
    for (const id of ids) assert.equal(workflow.tasks.filter(task => task.eventKey === 'request:' + id).length, 1)
    await page.goto(ready.url + '/app#requests')
    await capture(`RETURN-001-staff-followup-${width}`)
    await page.getByRole('article', { name: `Request ${ids[0]}`, exact: true }).getByRole('link', { name: `Open order ${bought.orderId}`, exact: true }).click()
    await page.waitForURL(url => url.hash === '#orders/' + bought.orderId)
    as = member
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/stall/state')
    await page.goto(ready.url + '/app#requests'); await page.reload()
    assert.equal((await denied).status(), 403, 'an invited customer has no staff workspace grant')
    await page.getByRole('heading', { name: 'Shop desk unavailable', exact: true }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Shop desk', exact: true }).getByRole('link', { name: 'Customer requests', exact: true }).count(), 0)
    assert.deepEqual((await h.api('/api/stall/state')).orders.find(o => o.id === bought.orderId), before)
  }
  const site = await context.newPage()
  for (const [path, label] of [['/docs/workflows', 'guide'], ['/contract', 'contract']]) {
    assert.equal((await site.goto(ready.siteUrl + path)).status(), 200)
    for (const width of [1440, 390]) {
      await site.setViewportSize({ width, height: 1000 })
      const target = path === '/contract' ? site.getByRole('row').filter({ hasText: 'Customer self-service returns, cancellations and exchanges' }) : site.locator('main')
      await target.scrollIntoViewIfNeeded()
      assert.ok(await site.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await site.screenshot({ path: resolve(process.env.STALL_SCREENSHOTS ?? 'test-results/requests', `RETURN-001-${label}-${width}.png`) })
    }
  }
  await site.close()
  assert.deepEqual(journey.errors, [])
  await journey.dev.assertRunning()
  console.log('PASS RETURN-001 invited-member and staff request intake at 1440 and 390')
} catch (error) { journeyError = error; if (journey?.page) { await journey.page.screenshot({ path: (process.env.STALL_SCREENSHOTS ?? 'test-results/requests') + '/failure.png', fullPage: true }); console.log('Visible failure:', (await journey.page.locator('main').innerText()).slice(0, 4000)) } throw error }
finally { await journey?.finish(journeyError) }
