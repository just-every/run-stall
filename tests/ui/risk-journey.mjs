import assert from 'node:assert/strict'
import { purchase,deliverWebhook } from '../api/network.mjs'
export async function riskJourney({page,h,edge,secret,origin,riskLevels,capture}) {
 await page.goto(origin+'/app#settings')
 const form=page.getByRole('form',{name:'Risk hold rules',exact:true})
 await form.getByLabel('Enable fulfillment holds',{exact:true}).check()
 await form.getByLabel('Hold at processor risk score (optional)',{exact:true}).fill('70')
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/stall/commands'))
 await form.getByRole('button',{name:'Save risk rules',exact:true}).click();assert.ok((await saved).ok())
 await page.waitForFunction(()=>!document.querySelector('#risk-review button:disabled'))
 await capture('risk-rules',form)
 const orders=[]
 for(const [index,level] of ['normal','elevated','highest'].entries()) {
  const bought=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1],email:`synthetic-stall-${650+index}@example.test`,expectedTotalCents:2450})
  riskLevels.set(bought.orderId,level)
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200)
  orders.push(bought.orderId)
 }
 await page.reload();await form.getByRole('button',{name:'Save risk rules',exact:true}).waitFor()
 const risk=id=>page.getByRole('article',{name:`Risk for ${id}`,exact:true})
 const held=risk(orders[1]);await held.getByRole('button',{name:'Release fulfillment',exact:true}).waitFor()
 await held.getByText('Processor signals and provenance',{exact:true}).click();await capture('risk-held',held)
 const row=(await h.api('/api/stall/state')).orders.find(o=>o.id===orders[1])
 const blocked=await h.command('shipment.prepare',{orderId:row.id,revision:row.revision,reference:'synthetic-stall-655'},{status:409})
 assert.equal(blocked.error.code,'RISK_HELD')
 let response=page.waitForResponse(r=>r.url().endsWith('/api/stall/commands'))
 await held.getByRole('button',{name:'Release fulfillment',exact:true}).click();assert.ok((await response).ok())
 await held.getByText('Released',{exact:true}).waitFor();await capture('risk-released',held)
 const canceled=risk(orders[2]);response=page.waitForResponse(r=>r.url().endsWith('/api/stall/commands'))
 await canceled.getByRole('button',{name:'Cancel fulfillment',exact:true}).click();assert.ok((await response).ok())
 await canceled.getByText('Fulfillment canceled. Payment and reserved stock remain recorded; handle money and stock separately through their authorized workflows.',{exact:true}).waitFor()
 await capture('risk-canceled',canceled)
 assert.equal((await h.api('/api/stall/risk')).queue.find(r=>r.orderId===orders[0]).status,'clear')
}
