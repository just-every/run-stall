import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { publish,purchase,deliverWebhook } from '../api/network.mjs'

/** ORDER-001a's current-order desk, through its built page and real HTTP/provider doors. */
export async function orderDeskJourney({page,h,edge,secret,origin,evidence}) {
 const label='Payment recorded by staff, not confirmed by a payment provider'
 async function capture(name,locator=page.locator('#orders')) {
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await locator.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} overflows at ${width}`)
   await page.screenshot({path:resolve(evidence,`ORDER-001a-${name}-${width}.png`),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 async function saved(action) {
  const response=page.waitForResponse(response=>response.url().includes('/api/stall/commands')&&response.request().method()==='POST')
  await action();assert.ok((await response).ok());await page.getByRole('button',{name:'Refresh shop',exact:true}).waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.querySelector('#orders .st-view-head button:disabled'))
 }
 await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
 await publish(h,'TOWEL-NAT','Natural linen towel',1800)
 await h.command('shipping.configure',{shippingCents:625})
 const online=await purchase(h,edge,{email:'synthetic-stall-301@example.test',expectedTotalCents:4875})
 assert.equal((await deliverWebhook(h,secret,edge.pay(online.session.id))).response.status,200)
 const teammateCookie=await h.signIn('synthetic-stall-302@example.test'),teammate=(await h.api('/auth/session',undefined,{as:teammateCookie})).operator
 await page.reload()
 await page.getByRole('button',{name:'Record paid sale',exact:true}).click()
 const form=page.getByRole('region',{name:'Manual retail order',exact:true})
 await form.getByLabel('Manual quantity for Blue ceramic mug',{exact:true}).fill('1')
 for(const [field,value] of [['Customer email','synthetic-stall-303@example.test'],['Customer name','Ana Ruiz'],['Address line 1','12 Cedar Lane'],['City','Austin'],['US state','TX'],['ZIP code','78702'],['Payment reference (optional)','Check 1042']])await form.getByLabel(field,{exact:true}).fill(value)
 await form.getByLabel('Payment received on',{exact:true}).fill('2026-10-20')
 await capture('manual-entry',form)
 await form.getByRole('button',{name:'Review paid sale',exact:true}).click()
 await form.getByText('Total paid: $30.75',{exact:true}).waitFor()
 await capture('manual-review',form)
 await saved(()=>form.getByRole('button',{name:'Record paid sale',exact:true}).click())
 const current=()=>h.api('/api/stall/state'),manual=(await current()).orders.find(order=>order.channel==='manual')
 assert.ok(manual);assert.equal(manual.status,'reserved');assert.equal(manual.manualPayment.method,'check');assert.equal(manual.taxTreatment,'no_tax_recorded')
 const filter=page.getByRole('form',{name:'Order filters'})
 await filter.getByLabel('Channel',{exact:true}).selectOption('manual')
 await page.waitForFunction(()=>document.querySelectorAll('#orders .st-order-id').length===1)
 await page.locator('#orders .st-order-id').click()
 const panel=page.locator('.st-order-panel')
 await panel.getByText(label,{exact:true}).first().waitFor()
 await page.getByLabel('Assign to',{exact:true}).selectOption(teammate.id)
 await saved(()=>page.getByRole('button',{name:'Save assignment',exact:true}).click())
 const note='Call the warehouse before dispatch. <img src=x onerror=alert(1)>'
 await page.getByLabel('Internal note',{exact:true}).fill(note)
 await saved(()=>page.getByRole('button',{name:'Add note',exact:true}).click())
 await page.getByLabel('Tag',{exact:true}).fill('Careful packing')
 await saved(()=>page.getByRole('button',{name:'Add tag',exact:true}).click())
 assert.equal(await panel.locator('img').count(),0)
 await panel.getByText('Full order history',{exact:true}).click()
 await panel.getByText('Payment staff recorded',{exact:false}).waitFor()
 await capture('notes-assignment-history',panel)
 await page.getByRole('button',{name:/^Redact note/}).click()
 await page.getByLabel('Redaction reason',{exact:true}).fill('Correct delivery instruction follows')
 await capture('redaction',page.getByRole('form',{name:'Redact internal note'}))
 await saved(()=>page.getByRole('button',{name:'Confirm redaction',exact:true}).click())
 assert.ok(!(await panel.textContent()).includes(note))
 await page.getByLabel('Internal note',{exact:true}).fill('Use the revised packing instruction')
 await saved(()=>page.getByRole('button',{name:'Add note',exact:true}).click())
 await page.getByLabel('Shipping reference',{exact:true}).fill('USPS Ground 9400 1122 3344')
 await saved(()=>page.getByRole('button',{name:'Prepare shipping for approval',exact:true}).click())
 await saved(()=>page.getByRole('button',{name:/^Approve shipping/}).click())
 await panel.getByText('More actions',{exact:true}).click()
 await panel.getByText('Prepare a refund',{exact:true}).click()
 await panel.getByLabel('Reason',{exact:true}).fill('Customer returned the mug; refund recorded outside Stall')
 await saved(()=>page.getByRole('button',{name:'Prepare refund',exact:true}).click())
 const stripeCalls=edge.calls.length
 await saved(()=>page.getByRole('button',{name:/^Approve \$24.50 refund/}).click())
 await panel.getByText('Refund recorded by staff; Stall moved no money.',{exact:false}).first().waitFor()
 assert.equal(edge.calls.length,stripeCalls)
 await capture('recorded-refund',panel)
 // Internal annotations never appear in public shop DOM or catalogue requests.
 await page.goto(origin+'/shop')
 assert.ok(!(await page.locator('body').textContent()).includes('Careful packing'))
 assert.ok(!(await page.locator('body').textContent()).includes('Use the revised packing instruction'))
 await page.goto(origin+'/app#orders')
 await page.getByRole('button',{name:'Refresh shop',exact:true}).waitFor()
 // Calendar labels and filters relabel immediately; commercial UTC stays fixed.
 const stamp='2026-10-20T04:30:00.000Z'
 await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt',?) WHERE id=?").bind(stamp,online.orderId).run()
 await page.clock.setFixedTime(new Date('2026-10-20T16:00:00.000Z'))
 async function zone(value) {
  await page.goto(origin+'/app#settings')
  await page.getByLabel('Time zone',{exact:true}).fill(value)
  const response=page.waitForResponse(response=>response.url().endsWith('/api/stall/commands'))
  await page.getByRole('button',{name:'Save time zone',exact:true}).click();assert.ok((await response).ok())
  await page.getByRole('button',{name:'Save time zone',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('form[aria-label="Shop time zone"] button:disabled'))
  await page.goto(origin+'/app#orders')
  await page.getByRole('button',{name:'All',exact:true}).click()
 }
 await zone('America/Chicago')
 let row=page.locator('#orders tbody tr').filter({hasText:'Test Customer'})
 await row.locator('time').filter({hasText:'Yesterday'}).waitFor()
 await zone('America/New_York')
 row=page.locator('#orders tbody tr').filter({hasText:'Test Customer'})
 await row.locator('time').filter({hasText:'12:30 AM'}).waitFor()
 await filter.getByLabel('Placed from',{exact:true}).fill('2026-10-20');await filter.getByLabel('Placed to',{exact:true}).fill('2026-10-20')
 await row.getByRole('button').click()
 await capture('zone-change-filters',panel)
 assert.equal((await h.api('/api/stall/exports/records')).orders.find(order=>order.id===online.orderId).createdAt,stamp)
 // Per-event offsets on both sides of each transition, on the same inclusive date.
 for(const [name,day,instants,offsets] of [
  ['spring','2026-03-08',['2026-03-08T06:30:00.000Z','2026-03-08T07:30:00.000Z'],['EST','EDT']],
  ['fall','2026-11-01',['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z'],['EDT','EST']]]) {
  for(let index=0;index<instants.length;index++) {
   await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt',?) WHERE id=?").bind(instants[index],online.orderId).run()
   await page.getByRole('button',{name:'Refresh shop',exact:true}).click()
   await filter.getByLabel('Placed from',{exact:true}).fill(day);await filter.getByLabel('Placed to',{exact:true}).fill(day)
   const dateRow=page.locator('#orders tbody tr').filter({hasText:'Test Customer'})
   await dateRow.getByText(offsets[index],{exact:true}).waitFor()
   await dateRow.getByRole('button').click()
   await capture(`dst-${name}-${index}`,panel)
  }
 }
 // Erasure's final built state carries placeholders and attribution, not staff free text.
 await h.command('customer.erase',{email:'synthetic-stall-303@example.test',confirm:'ERASE'})
 await page.reload();await page.getByRole('button',{name:'All',exact:true}).click()
 if(await filter.getByRole('button',{name:'Clear filters',exact:true}).count())await filter.getByRole('button',{name:'Clear filters',exact:true}).click()
 const erased=page.locator('#orders tbody tr').filter({hasText:'Customer details erased'})
 await erased.getByRole('button').click()
 await panel.getByText('Erased with customer contact',{exact:true}).first().waitFor()
 assert.equal(await panel.getByRole('form',{name:'Add internal note'}).count(),0)
 assert.ok(!(await panel.textContent()).includes('Careful packing'));assert.ok(!(await panel.textContent()).includes('Check 1042'))
 await capture('erased-attribution',panel)
 console.log('ORDER-001a browser journey passed: manual review, notes/tags/redaction, assignment/history, recorded refund, privacy, zone relabelling, DST offsets and erasure at 1440/390.')
}
