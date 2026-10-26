import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { installation, archive, restore } from './harness.mjs'
import { pierInstallation } from './pier.mjs'
import { stripeEdge, purchase, deliverWebhook } from './network.mjs'

// Only Stripe is simulated; Stall and Pier are real Workers with real databases.
test('RETURN-001: eligible-line requests, policy, human decisions, exchange reservation and progress for account and guest customers', async () => {
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1301',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 let destination
 const order=async id=>(await h.api('/api/stall/state')).orders.find(o=>o.id===id)
 const paid=async(skus,quantities,email)=>{const bought=await purchase(h,edge,{skus,quantities,email});await deliverWebhook(h,secret,edge.pay(bought.session.id));return bought.orderId}
 const ship=async(id,daysAgo=0)=>{
  let o=await order(id);o=await h.command('shipment.prepare',{orderId:id,revision:o.revision,reference:'synthetic-stall-1310'})
  await h.command('shipment.approve',{orderId:id,revision:o.revision})
  await order(id)
  if(daysAgo)await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.shipment.dispatches[0].shippedAt',?) WHERE id=?").bind(new Date(Date.now()-daysAgo*86400000).toISOString(),id).run()
 }
 const request=(as,body,opts={})=>h.api('/api/stall/returns/requests',body,{as,...opts})
 const eligibility=(as,id,opts={})=>h.api('/api/stall/returns/eligibility?orderId='+id,undefined,{as,...opts})
 try {
  const ana='synthetic-stall-1302@example.test',member=await h.signIn(ana),other=await h.signIn('synthetic-stall-1303@example.test'),grant=await h.api('/api/stall/agent-token',{})
  await h.command('product.prepare',{sku:'WARE',name:'Stoneware',description:'Hand thrown',unitCents:2450,active:true,details:{options:[{name:'Size',values:['Small','Large']}],variants:[{sku:'MUG-BLUE',options:{Size:'Small'}},{sku:'TOWEL-NAT',options:{Size:'Large'},unitCents:1800}]}})
  await h.command('product.approve',{sku:'WARE',revision:(await h.api('/api/stall/state')).products.find(p=>p.id==='WARE').revision})
  const shipped=await paid(['MUG-BLUE'],[6],ana),unsent=await paid(['MUG-BLUE'],[1],ana),towels=await paid(['TOWEL-NAT'],[1],ana),old=await paid(['MUG-BLUE'],[1],ana)
  await ship(shipped);await ship(towels);await ship(old,60)
  const reservedOrders=(await pier.api('/api/pier/state')).orders.length
  // Nothing is requested before the owner publishes a policy; cancellation before shipment needs none.
  assert.equal((await h.api('/api/stall/return-policy',undefined,{as:''})).configured,false)
  assert.equal((await request(member,{orderId:shipped,kind:'return',lines:[{sku:'MUG-BLUE',quantity:1,reason:'defective'}]},{status:409})).error.code,'RETURN_POLICY_UNSET')
  const policy={windowDays:30,condition:'Unused and in the original packaging',feeCents:500,returnShipping:'The customer pays return postage',finalSaleSkus:['TOWEL-NAT'],exchanges:true}
  await h.command('return.policy.save',{...policy,revision:null},{as:member,status:403})
  await h.command('return.policy.save',{...policy,revision:null},{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  const saved=await h.command('return.policy.save',{...policy,revision:null})
  await h.command('return.policy.save',{...policy,revision:null},{status:409})
  const shown=await h.api('/api/stall/return-policy',undefined,{as:''})
  assert.deepEqual([shown.windowDays,shown.condition,shown.feeCents,shown.returnShipping,shown.finalSaleSkus,shown.exchanges],[30,policy.condition,500,policy.returnShipping,['TOWEL-NAT'],true])
  // Eligibility is per line, with each rule's reason; only the order's own customer sees it.
  const view=await eligibility(member,shipped)
  assert.deepEqual([view.lines[0].eligible,view.lines[0].remaining],[true,6]);assert.deepEqual(view.lines[0].exchangeOptions.map(o=>[o.sku,o.availableQuantity]),[['TOWEL-NAT',6]])
  await eligibility(other,shipped,{status:404});await eligibility('',shipped,{status:401})
  assert.match((await eligibility(member,towels)).lines[0].reasons[0],/Final sale/)
  assert.match((await eligibility(member,old)).lines[0].reasons[0],/30-day return window ended/)
  assert.equal((await eligibility(member,unsent)).cancellation.eligible,true);assert.equal(view.cancellation.eligible,false)
  for(const [id,line,pattern] of [[towels,'TOWEL-NAT',/Final sale/],[old,'MUG-BLUE',/return window ended/]]) assert.match((await request(member,{orderId:id,kind:'return',lines:[{sku:line,quantity:1,reason:'changed_mind'}]},{status:409})).error.message,pattern)
  assert.match((await request(member,{orderId:shipped,kind:'cancellation'},{status:409})).error.message,/Fulfillment has started/)
  const before=await order(shipped),writesBefore=edge.pierCalls.length
  const body={orderId:shipped,kind:'return',lines:[{sku:'MUG-BLUE',quantity:1,reason:'defective'}],note:'The handle cracked in the box'}
  await request(other,body,{status:404});await request('',body,{status:401})
  await request(member,{...body,customerEmail:'synthetic-stall-1304@example.test'},{status:400})
  await request(member,{...body,lines:[{sku:'MUG-BLUE',quantity:1,reason:'defective',toSku:'TOWEL-NAT'}]},{status:400})
  const first=await request(member,body,{status:201}),again=await request(member,body,{status:200})
  assert.equal(first.duplicate,false);assert.equal(again.duplicate,true);assert.equal(again.case.id,first.case.id)
  assert.equal(first.case.state,'requested');assert.match(first.case.progress[0].text,/A person reviews/)
  await request(member,{...body,lines:[{sku:'MUG-BLUE',quantity:6,reason:'defective'}]},{status:409})
  // Exchange: a replacement must be a stocked sibling variant, and only a person's acceptance sets it aside.
  const swap={orderId:shipped,kind:'exchange',lines:[{sku:'MUG-BLUE',quantity:1,reason:'wrong_size',toSku:'TOWEL-NAT'}]}
  await request(member,{...swap,lines:[{...swap.lines[0],toSku:'MUG-BLUE'}]},{status:409})
  const accepted=(await request(member,swap,{status:201})).case,doomed=(await request(member,{...swap,lines:[{...swap.lines[0],quantity:2,reason:'changed_mind'}]},{status:201})).case
  assert.equal((await pier.api('/api/pier/state')).orders.length,reservedOrders,'requests reserve no replacement stock')
  // A guest link opens one order only and reaches the same eligibility and request doors.
  const link=await h.api('/api/stall/account/guest-order-link',{orderId:shipped},{as:member}),guest={'x-stall-order-token':link.token}
  assert.equal((await eligibility('',shipped,{headers:guest})).lines[0].remaining,2)
  await eligibility('',old,{headers:guest,status:404})
  await request('',{...body,orderId:old},{headers:guest,status:404})
  assert.equal((await request('',body,{headers:guest,status:200})).case.id,first.case.id,'the same request from the private link is the same request')
  const guestCase=(await request('',{orderId:shipped,kind:'return',lines:[{sku:'MUG-BLUE',quantity:2,reason:'not_as_described'}]},{headers:guest,status:201})).case
  assert.deepEqual((await h.api('/api/stall/guest-order',undefined,{as:'',headers:guest})).returnCases.map(c=>c.id).sort(),[first.case.id,accepted.id,doomed.id,guestCase.id].sort())
  const cancelled=(await request(member,{orderId:unsent,kind:'cancellation'},{status:201})).case
  assert.deepEqual(await order(shipped),before);assert.equal(edge.pierCalls.length,writesBefore)
  // Staff see every case without a workflow rule; only a person who is owner or administrator decides.
  const queue=async()=>(await h.api('/api/stall/returns')).cases
  assert.deepEqual((await queue()).filter(c=>c.state==='requested').map(c=>c.id).sort(),[first.case.id,accepted.id,doomed.id,guestCase.id,cancelled.id].sort())
  await h.api('/api/stall/returns',undefined,{as:member,status:403})
  const revision=id=>queue().then(all=>all.find(c=>c.id===id).revision)
  const decide=async(id,decision,explanation,opts={})=>h.command('return.decide',{caseId:id,revision:opts.revision??await revision(id),decision,explanation},opts)
  await decide(first.case.id,'accept','Please return it',{as:member,status:403})
  await decide(first.case.id,'accept','Please return it',{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403})
  await decide(first.case.id,'accept','',{status:400});await decide(first.case.id,'accept','Please return it',{revision:'stale',status:409})
  await decide(first.case.id,'accept','Cracked handle confirmed from your note; post it back within 14 days.')
  await decide(first.case.id,'refuse','Changed my mind',{status:409})
  await decide(guestCase.id,'refuse','The glaze shown matches the listing, so this is outside our policy.')
  await decide(cancelled.id,'accept','Not yet picked, so we will cancel it.')
  // The accepted exchange sets one replacement aside once; later stock loss refuses nothing already promised.
  const ordersBefore=(await pier.api('/api/pier/state')).orders.length
  const done=await decide(accepted.id,'accept','Swapping for the large size.')
  assert.equal(done.state,'accepted');assert.equal((await pier.api('/api/pier/state')).orders.length,ordersBefore+1)
  await decide(accepted.id,'accept','Again',{status:409});assert.equal((await pier.api('/api/pier/state')).orders.length,ordersBefore+1)
  await paid(['TOWEL-NAT'],[18],'synthetic-stall-1305@example.test')
  assert.deepEqual((await eligibility(member,shipped)).lines[0].exchangeOptions,[])
  await request(member,swap,{status:409})
  assert.equal((await decide(doomed.id,'accept','Out of stock now',{status:409})).error.code,'EXCHANGE_STOCK')
  await decide(doomed.id,'refuse','The large size sold out; please request a return instead.')
  // Customers read the explanation and progress. Money, order, shipment and stock records stay untouched by decisions.
  const mine=(await h.api('/api/stall/account',undefined,{as:member})).returnCases,byId=id=>mine.find(c=>c.id===id)
  assert.deepEqual([byId(first.case.id).state,byId(accepted.id).state,byId(doomed.id).state,byId(guestCase.id).state,byId(cancelled.id).state],['accepted','accepted','refused','refused','accepted'])
  assert.match(byId(first.case.id).decision,/Cracked handle/);assert.ok(byId(first.case.id).progress.at(-1).text.includes('refund is decided only after the goods are received'))
  assert.equal(byId(accepted.id).replacementReserved,true);assert.equal(byId(doomed.id).replacementReserved,false)
  assert.ok(!JSON.stringify(mine).includes('decidedBy'));assert.deepEqual((await h.api('/api/stall/account',undefined,{as:other})).returnCases,[])
  const final=await order(shipped);assert.deepEqual([final.refunds,final.status,final.payment],[before.refunds,before.status,before.payment]);assert.equal(edge.refunds.size,0)
  const exported=(await h.api('/api/stall/exports/records')).returns
  assert.equal(exported.cases.length,5);assert.equal(exported.policy.revision!==saved.revision,false)
  // Cases and decisions travel with the business; erasure removes them.
  const saved2=await archive(h);destination=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1301',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});await restore(destination,saved2)
  assert.deepEqual((await destination.api('/api/stall/returns')).cases.map(c=>[c.id,c.state,c.decision]),(await queue()).map(c=>[c.id,c.state,c.decision]))
  await ship(unsent)
  await h.command('customer.erase',{email:ana,confirm:'ERASE'})
  assert.equal((await queue()).length,0);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_return_events').first()).n,0)
 } finally { await destination?.close();await h.close();await pier.close() }
})
