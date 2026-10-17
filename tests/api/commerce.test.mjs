import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { installation } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge,deliverWebhook,publish,purchase } from './network.mjs';
const state=h=>h.api('/api/stall/state');
const order=async(h,id)=>(await state(h)).orders.find(o=>o.id===id);
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
   assert.ok((await h.api('/api/stall/catalogue',undefined,{as:''})).items.every(p=>p.available==='19'));
  });
  await t.test('shipment exact approval and recovery dispatch once through real stock ledger',async()=>{
   let value=await order(h,bought.orderId);
   value=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'AUPOST-123'});
   await h.command('shipment.approve',{orderId:value.id,revision:'stale'},{status:409});
   edge.loseNextPierResponse('dispatch.create');
   await h.command('shipment.approve',{orderId:value.id,revision:value.revision},{status:503});
   assert.equal((await order(h,value.id)).shipment.status,'pending');
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
 }finally {if(h) await h.close();await pier.close();}
});

test('people approve exact drafts; members and revoked agent grants cannot write',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward});
 const h=await installation({bindings:pier.bindings,outboundService:edge.handle});
 try {
  const member=await h.signIn('member@example.test');
  const admin=await h.signIn('admin@example.test','admin');
  await h.api('/api/stall/state',undefined,{as:member,status:403});
  await h.command('product.prepare',{sku:'NOPE',name:'Nope',description:'',unitCents:100,active:true},{as:member,status:403});
  await h.api('/api/stall/agent-token',{}, {as:admin,status:403});
  await h.command('product.prepare',{sku:'CSRF',name:'Nope',description:'',unitCents:100,active:true},{headers:{origin:'https://other.example.test'},status:403});
  const grant=await h.api('/api/stall/agent-token',{});
  const agent={as:'',headers:{authorization:'Bearer '+grant.token}};
  const draft=await h.command('product.prepare',{sku:'MUG-BLUE',name:'Made by owner',description:'Australian ceramic',unitCents:3000,active:true},agent);
  assert.equal(draft.value.active,false);
  await h.command('product.approve',{sku:'MUG-BLUE',revision:draft.revision},{...agent,status:403});
  await h.api('/api/stall/agent-token',{}, {...agent,status:403});
  await h.command('product.approve',{sku:'MUG-BLUE',revision:'stale'},{status:409});
  const published=await h.command('product.approve',{sku:'MUG-BLUE',revision:draft.revision});
  assert.equal(published.value.active,true);
  assert.ok(published.value.approval.by);
  await h.api('/api/stall/agent-token/revoke',{grantId:grant.id});
  await h.command('product.prepare',{sku:'MUG-BLUE',revision:published.revision,name:'Changed',description:'',unitCents:1,active:true},{...agent,status:401});
  assert.equal((await state(h)).products.find(p=>p.id==='MUG-BLUE').value.unitCents,3000);
 }finally {await h.close();await pier.close();}
});
