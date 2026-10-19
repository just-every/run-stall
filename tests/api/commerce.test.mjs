import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { installation } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge,deliverWebhook,publish,purchase } from './network.mjs';
import { volumeStock } from './volume-stock.mjs';
const state=h=>h.api('/api/stall/state');
const order=async(h,id)=>(await state(h)).orders.find(o=>o.id===id);
test('OPEN-001: an owned installation publishes 200 products, adds 10 staff and takes 1000 paid orders without author fees or gates',async()=>{
 const stock=volumeStock(),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 try {
  for(let i=0;i<10;i++) {
   const cookie=await h.signIn(`maker-${i}@example.test`);
   assert.equal((await h.api('/auth/session',undefined,{as:cookie})).operator.role,'member');
  }
  for(const [i,item] of stock.items.entries()) await publish(h,item.sku,`Handmade piece ${i+1}`,1250+i);
  assert.equal((await h.api('/api/stall/catalogue',undefined,{as:''})).items.length,200);
  const expected=new Map();
  for(let i=0;i<1000;i++) {
   const index=i%stock.items.length,cents=1250+index;
   const bought=await purchase(h,edge,{skus:[stock.items[index].sku],quantities:[1],expectedTotalCents:cents});
   const paid=edge.pay(bought.session.id);
   assert.equal(paid.amount_total,cents);
   const delivered=await deliverWebhook(h,secret,paid);
   assert.equal(delivered.response.status,200,JSON.stringify(delivered.value));
   assert.equal(delivered.value.status,'reserved');
   expected.set(bought.orderId,cents);
  }
  const result=await state(h);
  assert.equal(result.products.length,200);
  assert.equal(result.orders.length,1000);
  assert.equal(stock.payments.size,1000);
  assert.equal(edge.sessions.size,1000);
  for(const row of result.orders) {
   assert.equal(row.status,'reserved');
   assert.equal(row.totalCents,expected.get(row.id));
   assert.equal(row.currency,'usd');
   assert.equal(stock.payments.get(`stall-payment-${row.id}`).amount,(row.totalCents/100).toFixed(2));
  }
 }finally{await h.close()}
});
test('shop purchase, signed paid reservation, shipment and partial refund reconcile through real Pier',async t=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex');
 let h;
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);
  await publish(h,'TOWEL-NAT','Natural linen towel',1800);
  let bought,paid,eventId;
  await t.test('public stock and reviewed prices become one replayable exact-cent hosted checkout',async()=>{
   const catalogue=await h.api('/api/stall/catalogue',undefined,{as:''});
   assert.equal(catalogue.items.length,2);
   assert.ok(catalogue.items.every(p=>p.available==='20'));
   await h.api('/api/stall/state',undefined,{as:'',status:401});
   await h.api('/api/stall/checkout',{customerEmail:'customer@example.test',lines:[{sku:'MUG-BLUE',quantity:1}],idempotencyKey:randomUUID(),expectedTotalCents:2400},{as:'',status:409});
   const absent=await h.command('product.prepare',{sku:'MISSING-PIER-SKU',name:'Unmapped product',description:'',unitCents:1000,active:true});
   await h.command('product.approve',{sku:absent.id,revision:absent.revision},{status:409});
   assert.equal(edge.sessions.size,0);
   bought=await purchase(h,edge,{expectedTotalCents:4250});
   assert.equal(bought.session.amount_total,4250);
   assert.match(bought.url,/^https:\/\/checkout\.stripe\.com\//);
   const replay=await h.api('/api/stall/checkout',{customerEmail:'customer@example.test',lines:[{sku:'MUG-BLUE',quantity:1},{sku:'TOWEL-NAT',quantity:1}],idempotencyKey:bought.key,expectedTotalCents:4250},{as:''});
   assert.equal(replay.orderId,bought.orderId);
   assert.equal(edge.sessions.size,1);
   await h.api('/api/stall/checkout',{customerEmail:'other@example.test',lines:[{sku:'MUG-BLUE',quantity:1}],idempotencyKey:bought.key},{as:'',status:409});
   assert.equal((await pier.api('/api/pier/state')).orders.length,0);
  });
  await t.test('raw signatures, timestamps and mismatched amounts cannot reserve unpaid stock',async()=>{
   const invalid=await deliverWebhook(h,'incorrect-edge-secret',bought.session);
   assert.equal(invalid.response.status,400);
   const old=await deliverWebhook(h,secret,bought.session,{timestamp:Math.floor(Date.now()/1000)-600});
   assert.equal(old.response.status,400);
   const mutated=await deliverWebhook(h,secret,bought.session,{signatureBody:'{}'});
   assert.equal(mutated.response.status,400);
   const unpaid=await deliverWebhook(h,secret,bought.session);
   assert.equal(unpaid.response.status,200);
   assert.equal(unpaid.value.pending,true);
   paid=edge.pay(bought.session.id);
   const wrong=await deliverWebhook(h,secret,{...paid,amount_total:4249});
   assert.equal(wrong.response.status,400);
   assert.equal((await pier.api('/api/pier/state')).orders.length,0);
   assert.equal((await order(h,bought.orderId)).status,'awaiting_payment');
  });
  await t.test('payment survives a lost Pier response and duplicate delivery reserves only once',async()=>{
   edge.loseNextPierResponse('order.create');
   const lost=await deliverWebhook(h,secret,paid);
   eventId=lost.id;
   assert.equal(lost.response.status,503);
   assert.equal((await order(h,bought.orderId)).status,'paid');
   assert.equal((await pier.api('/api/pier/state')).orders.length,1);
   const recovered=await deliverWebhook(h,secret,paid,{id:eventId});
   assert.equal(recovered.response.status,200);
   assert.equal((await order(h,bought.orderId)).status,'reserved');
   const duplicate=await deliverWebhook(h,secret,paid,{id:eventId});
   assert.equal(duplicate.response.status,200);
   assert.equal(duplicate.value.replayed,true);
   const stock=await pier.api('/api/pier/state');
   assert.equal(stock.orders.length,1);
   assert.equal(stock.orders[0].lines.length,2);
   assert.ok(stock.orders[0].lines.every(l=>l.reserved==='1'));
   // Pier receives the prices Stall charged, so the shipment's invoice can post to the books.
   assert.equal(stock.orders[0].pricingStatus,'priced');
   assert.deepEqual(stock.orders[0].lines.map(l=>l.price).sort(),['18','24.5']);
   const confirmed=await order(h,bought.orderId);
   assert.deepEqual(stock.orders[0].channelPayment,{provider:'stripe',reference:confirmed.payment.intentId,amount:'42.50',currency:'USD',paidAt:confirmed.payment.paidAt,orderReference:confirmed.id});
   assert.ok((await h.api('/api/stall/catalogue',undefined,{as:''})).items.every(p=>p.available==='19'));
  });
  await t.test('shipment exact approval and recovery dispatch once through real stock ledger',async()=>{
   let value=await order(h,bought.orderId);
   value=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'AUPOST-123'});
   await h.command('shipment.approve',{orderId:value.id,revision:'stale'},{status:409});
   edge.loseNextPierResponse('dispatch.create');
   await h.command('shipment.approve',{orderId:value.id,revision:value.revision},{status:503});
   // Reading the desk recovers Pier's committed dispatch without sending it again.
   assert.equal((await order(h,value.id)).shipment.status,'shipped');
   const shipped=await h.command('order.reconcile',{orderId:value.id});
   assert.equal(shipped.status,'shipped');
   const again=await h.command('shipment.approve',{orderId:value.id,revision:value.revision});
   assert.equal(again.shipment.pierShipmentId,shipped.shipment.pierShipmentId);
   const stock=await pier.api('/api/pier/state');
   assert.equal(stock.shipments.length,1);
   assert.equal(stock.reservations.length,0);
   assert.ok(stock.positions.every(p=>p.quantity==='19'));
  });
  await t.test('partial refund recovery cannot overrefund and never restocks the shipped item',async()=>{
   let value=await order(h,bought.orderId);
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Customer kept towel'});
   assert.equal(value.refunds[0].amountCents,2450);
   edge.loseNextRefundResponse();
   await h.command('refund.approve',{orderId:value.id,revision:value.revision},{status:503});
   assert.equal((await order(h,value.id)).refunds[0].status,'pending');
   const reconciled=await h.command('order.reconcile',{orderId:value.id});
   assert.equal(reconciled.refunds[0].status,'succeeded');
   assert.equal(edge.refunds.size,1);
   await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   assert.equal(edge.refunds.size,1);
   await h.command('refund.prepare',{orderId:value.id,revision:reconciled.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Duplicate'},{status:409});
   const stock=await pier.api('/api/pier/state');
   assert.equal(stock.shipments.length,1);
   assert.equal(stock.returns.length,0);
   assert.ok(stock.positions.every(p=>p.quantity==='19'));
   const history=(await state(h)).audit;
   assert.ok(history.some(a=>a.action==='shipment.approved'));
   assert.ok(history.some(a=>a.action==='refund.approved'));
  });
  await t.test('warehouse dispatches refresh into Stall without a second dispatch; partial work stays unfinished',async()=>{
   const bought=await purchase(h,edge,{email:'warehouse@example.test'});
   const payment=await deliverWebhook(h,secret,edge.pay(bought.session.id));
   assert.equal(payment.response.status,200);
   let value=await order(h,bought.orderId);
   const native=(await pier.api('/api/pier/state')).orders.find(o=>o.id===value.reservation.id);
   const calls=edge.pierCalls.filter(c=>c.type==='dispatch.create').length;
   const first=await pier.command('dispatch.create',{orderId:native.id,shipmentReference:'WAREHOUSE-ONE',lines:[{orderLineId:native.lines[0].id,quantity:'1'}]});
   value=await order(h,value.id);
   assert.notEqual(value.status,'shipped');
   assert.equal(value.shipment.status,'partial');
   assert.equal(value.shipment.dispatches[0].id,first.id);
   const refused=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'DO-NOT-SHIP-TWICE'},{status:409});
   assert.equal(refused.error.code,'PART_ALREADY_SHIPPED');
   const second=await pier.command('dispatch.create',{orderId:native.id,shipmentReference:'WAREHOUSE-TWO',lines:[{orderLineId:native.lines[1].id,quantity:'1'}]});
   value=await h.command('order.reconcile',{orderId:value.id});
   assert.equal(value.status,'shipped');
   assert.deepEqual(value.shipment.dispatches.map(s=>s.id).sort(),[first.id,second.id].sort());
   assert.ok(value.shipment.dispatches.every(s=>s.shippedAt));
   const again=await order(h,value.id);
   assert.equal(again.revision,value.revision);
   const already=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'DUPLICATE'},{status:409});
   assert.equal(already.error.code,'ALREADY_SHIPPED');
   assert.match(already.error.message,/WAREHOUSE-ONE/);
   assert.equal(edge.pierCalls.filter(c=>c.type==='dispatch.create').length,calls);
   // Revoke the real scoped key, as a restore does. The original Pier reason survives.
   const channel=(await pier.api('/api/pier/state')).channels.find(c=>c.id===pier.channelId);
   await pier.command('channel.stallUnlink',{channelId:channel.id,version:channel.version});
   const provider=await pier.api('/api/pier/state',undefined,{as:pier.bindings.PIER_SESSION,status:401});
   const stale=await state(h);
   assert.ok(stale.shipmentSync.error.includes(provider.error.message));
   assert.equal(stale.orders.find(o=>o.id===value.id).status,'shipped');
   const revoked=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'RESTORED-KEY'},{status:503});
   assert.equal(revoked.error.code,'PIER_CREDENTIAL');
   assert.ok(revoked.error.message.includes(provider.error.message));
  });
 }finally {if(h) await h.close();await pier.close();}
});

test('AGENT-001: agents prepare exact product, shipment and refund drafts; only people approve; expired and revoked grants fail',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward});
 const secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 try {
  const member=await h.signIn('member@example.test');
  const admin=await h.signIn('admin@example.test','admin');
  await h.api('/api/stall/state',undefined,{as:member,status:403});
  await h.command('product.prepare',{sku:'NOPE',name:'Nope',description:'',unitCents:100,active:true},{as:member,status:403});
  await h.api('/api/stall/agent-token',{}, {as:admin,status:403});
  await h.command('product.prepare',{sku:'CSRF',name:'Nope',description:'',unitCents:100,active:true},{headers:{origin:'https://other.example.test'},status:403});
  const grant=await h.api('/api/stall/agent-token',{});
  const agent={as:'',headers:{authorization:'Bearer '+grant.token}};
  assert.ok(grant.expiresAt>Date.now());
  const owner=(await state(h)).actor;
  const administrator=(await h.api('/api/stall/state',undefined,{as:admin})).actor;
  const draft=await h.command('product.prepare',{sku:'MUG-BLUE',name:'Made by owner',description:'Australian ceramic',unitCents:3000,active:true},agent);
  assert.equal(draft.value.active,false);
  await h.command('product.approve',{sku:'MUG-BLUE',revision:draft.revision},{...agent,status:403});
  await h.api('/api/stall/agent-token',{}, {...agent,status:403});
  await h.api('/api/stall/agent-token/revoke',{}, {...agent,status:403});
  await h.api('/api/stall/portability/exports',{}, {...agent,status:403});
  await h.api('/api/stall/portability/imports',{confirmed:true}, {...agent,status:403});
  await h.command('customer.erase',{email:'customer@example.test',confirm:'ERASE'},{...agent,status:403});
  await h.command('connection.remove',{provider:'stripe'},{...agent,status:403});
  await h.command('product.approve',{sku:'MUG-BLUE',revision:'stale'},{status:409});
  const published=await h.command('product.approve',{sku:'MUG-BLUE',revision:draft.revision});
  assert.equal(published.value.active,true);
  assert.equal(published.value.approval.by,owner.id);
  assert.equal(published.value.approval.revision,draft.revision);
  await publish(h,'TOWEL-NAT','Natural linen towel',1800);
  const bought=await purchase(h,edge,{expectedTotalCents:4800});
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200);
  let value=await order(h,bought.orderId);
  const first=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'USPS-AGENT-ORIGINAL'},agent);
  value=await h.command('shipment.prepare',{orderId:first.id,revision:first.revision,reference:'USPS-AGENT-REVIEWED'},agent);
  assert.equal(value.shipment.preparedBy,`agent:${grant.id}`);
  await h.command('shipment.approve',{orderId:value.id,revision:value.revision},{...agent,status:403});
  await h.command('shipment.approve',{orderId:value.id,revision:first.revision},{as:admin,status:409});
  assert.equal((await pier.api('/api/pier/state')).shipments.length,0);
  const shippingRevision=value.revision;
  value=await h.command('shipment.approve',{orderId:value.id,revision:shippingRevision},{as:admin});
  assert.equal(value.shipment.status,'shipped');
  assert.equal(value.shipment.reference,'USPS-AGENT-REVIEWED');
  assert.equal(value.shipment.approval.by,administrator.id);
  assert.equal(value.shipment.approval.revision,shippingRevision);
  assert.equal((await pier.api('/api/pier/state')).shipments.length,1);
  const refund=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Mug damaged; customer keeps towel'},agent);
  value=await h.command('refund.prepare',{orderId:value.id,revision:refund.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Customer supplied damage photos; no stock return'},agent);
  assert.equal(value.refunds[0].preparedBy,`agent:${grant.id}`);
  assert.equal(value.refunds[0].amountCents,3000);
  await h.command('refund.approve',{orderId:value.id,revision:value.revision},{...agent,status:403});
  await h.command('refund.approve',{orderId:value.id,revision:refund.revision},{status:409});
  assert.equal(edge.refunds.size,0);
  const refundRevision=value.revision;
  value=await h.command('refund.approve',{orderId:value.id,revision:refundRevision});
  assert.equal(value.refunds[0].status,'succeeded');
  assert.equal(value.refunds[0].approval.by,owner.id);
  assert.equal(value.refunds[0].approval.revision,refundRevision);
  assert.equal(edge.refunds.size,1);
  const history=(await state(h)).audit;
  for(const action of ['product.prepared','shipment.prepared','refund.prepared'])assert.ok(history.some(a=>a.actor===`agent:${grant.id}`&&a.action===action));
  await h.api('/api/stall/agent-token/revoke',{grantId:grant.id});
  await h.api('/api/stall/state',undefined,{...agent,status:401});
  await h.command('product.prepare',{sku:'MUG-BLUE',revision:published.revision,name:'Changed',description:'',unitCents:1,active:true},{...agent,status:401});
  assert.equal((await state(h)).products.find(p=>p.id==='MUG-BLUE').value.unitCents,3000);
  const expiring=await h.api('/api/stall/agent-token',{});
  const expired={as:'',headers:{authorization:'Bearer '+expiring.token}};
  await h.api('/api/stall/state',undefined,expired);
  // Advance the stored grant's lifetime to its expired state; authorization is
  // exercised only through public HTTP, without waiting a week in the suite.
  await h.db.prepare('UPDATE st_agent_tokens SET expires_at=? WHERE id=?').bind(Date.now()-1,expiring.id).run();
  await h.api('/api/stall/state',undefined,{...expired,status:401});
  await h.command('product.prepare',{sku:'EXPIRED',name:'Must not exist',description:'',unitCents:100,active:false},{...expired,status:401});
  assert.ok(!(await state(h)).products.some(p=>p.id==='EXPIRED'));
 }finally {await h.close();await pier.close();}
});
