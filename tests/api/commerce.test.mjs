import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { installation,archive,restore } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge,deliverWebhook,publish,purchase,sendFile,png } from './network.mjs';
import { volumeStock } from './volume-stock.mjs';
import { readCsv } from './csv-reader.mjs';
const state=h=>h.api('/api/stall/state');
const order=async(h,id)=>(await state(h)).orders.find(o=>o.id===id);
async function reviseProduct(h,sku,name,unitCents) {
 const previous=(await state(h)).products.find(product=>product.id===sku);
 const draft=await h.command('product.prepare',{sku,revision:previous.revision,name,unitCents,description:previous.value.description,active:true});
 return h.command('product.approve',{sku,revision:draft.revision});
}
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
  const oldest=expected.keys().next().value;
  for(const query of ['customer=CUSTOMER@example.test','customer=TEST+CUSTOMER',`sku=${stock.items[0].sku.toLowerCase()}`]) {
   const found=await h.api('/api/stall/orders?'+query);
   const count=query.startsWith('sku=')?5:1000;
   assert.equal(found.total,count);assert.equal(found.orders.length,count);
   assert.ok(found.orders.some(order=>order.id===oldest),'oldest order is searchable beyond 100');
   assert.ok(!JSON.stringify(found).includes('test-stock-network-edge'));assert.ok(found.orders.every(order=>!('requestDigest' in order)&&!('checkoutKey' in order)));
  }
  const result=await state(h);
  assert.equal(result.products.length,200);
  assert.equal(result.orders.length,1000);
  assert.equal(stock.payments.size,1000);
  assert.equal(edge.sessions.size,1000);
  // EXPORT-001: the public download retains the entire supported volume.
  const exported=await h.api('/api/stall/exports/records');
  assert.equal(exported.products.length,200);
  assert.equal(exported.orders.length,1000);
  assert.equal(exported.reconciliation.length,1000);
  for(const row of result.orders) {
   assert.equal(row.status,'reserved');
   assert.equal(row.totalCents,expected.get(row.id));
   assert.equal(row.currency,'usd');
   assert.equal(stock.payments.get(`stall-payment-${row.id}`).amount,(row.totalCents/100).toFixed(2));
  }
 }finally{await h.close()}
});
test('shop purchase, signed paid reservation, shipment and partial refund reconcile through real Pier',async t=>{
 const outbound=[];
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex');
 let h;
 try {
  h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1',STRIPE_WEBHOOK_SECRET:secret},outboundService:async request=>{if(request.method==='POST')outbound.push(await request.clone().text());return edge.handle(request)}});
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
  await t.test('ORDER-003: partial line refund recovery cannot overrefund and never restocks the shipped item',async()=>{
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
  await t.test('ORDER-003: shipping and goodwill approvals preserve cents, quantities, history and one provider effect',async()=>{
   const admin=await h.signIn('shipping-admin@example.test','admin');
   await h.command('shipping.configure',{shippingCents:625},{as:admin,status:403});
   await h.command('shipping.configure',{shippingCents:6.25},{status:400});
   await h.command('shipping.configure',{shippingCents:625});
   assert.equal((await state(h)).shippingCents,625);
   await h.api('/api/stall/checkout',{customerEmail:'late@example.test',lines:[{sku:'MUG-BLUE',quantity:1}],expectedTotalCents:2450,idempotencyKey:randomUUID()},{as:'',status:409});
   const bought=await purchase(h,edge,{email:'late@example.test',expectedTotalCents:4875});
   assert.equal(bought.session.amount_total,4875);
   const changed=await deliverWebhook(h,secret,{...bought.session,total_details:{amount_shipping:624}});
   assert.equal(changed.response.status,400);
   await h.command('shipping.configure',{shippingCents:0});
   const retry=await purchase(h,edge,{email:'late@example.test',key:bought.key,expectedTotalCents:4875});
   assert.equal(retry.orderId,bought.orderId);
   assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200);
   let value=await order(h,bought.orderId);
   assert.equal(value.shippingCents,625);
   const native=(await pier.api('/api/pier/state')).orders.find(row=>row.id===value.reservation.id);
   assert.equal(native.channelPayment.amount,'42.50');
   assert.equal(native.channelPayment.reference,value.payment.intentId);
   const originalLines=structuredClone(value.lines),before=await pier.api('/api/pier/state');
   value=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'USPS LATE-PARCEL'});
   value=await h.command('shipment.approve',{orderId:value.id,revision:value.revision});
   const refundCount=edge.refunds.size;
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:250,reason:'Shipping service delay'});
   const stale=value.revision,first=value.refunds.at(-1).id;
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:250,reason:'Partial shipping refund for delay'});
   await h.command('refund.approve',{orderId:value.id,revision:stale},{status:409});
   assert.equal(edge.refunds.size,refundCount);
   edge.loseNextRefundResponse();
   const approvedRevision=value.revision;
   await h.command('refund.approve',{orderId:value.id,revision:approvedRevision},{status:503});
   value=await order(h,value.id);
   assert.equal(value.refunds.at(-1).status,'pending');
   assert.equal(value.refunds.at(-1).approval.revision,approvedRevision);
   assert.equal(value.refunds.at(-1).lines.length,0);
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:500,reason:'Wait for prior refund'},{status:409});
   value=await h.command('order.reconcile',{orderId:value.id});
   assert.equal(value.refunds.at(-1).status,'succeeded');
   await h.command('refund.approve',{orderId:value.id,revision:approvedRevision,refundId:value.refunds.at(-1).id});
   assert.equal(edge.refunds.size,refundCount+1);
   assert.ok(!value.refunds.some(refund=>refund.id===first));
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:376,reason:'Too much shipping'},{status:409});
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:375,reason:'Remaining shipping for late delivery'});
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:1,reason:'Already refunded shipping'},{status:409});
   for(const amountCents of [0,-1,5.01]) await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents,reason:'Invalid amount'},{status:400});
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:500,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Mixed semantics'},{status:400});
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:500,reason:''},{status:400});
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:500,reason:'Late parcel goodwill; no goods returned'});
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   assert.equal(edge.refunds.size,refundCount+3);
   assert.deepEqual(value.lines,originalLines);
   assert.ok(value.refunds.every(refund=>refund.lines.length===0));
   assert.deepEqual(value.refunds.map(refund=>refund.accountingCategory),['shipping','shipping','goodwill']);
   assert.ok(value.refunds.every(refund=>refund.taxTreatment==='no_tax_recorded'));
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:3751,reason:'Above remaining paid value'},{status:409});
   // Non-line money has consumed value, not purchased quantities: the mug remains refundable in full.
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Refund purchased mug'});
   assert.equal(value.refunds.at(-1).amountCents,2450);
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'TOWEL-NAT',quantity:1}],reason:'Line exceeds remaining value after goodwill'},{status:409});
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:1300,reason:'Refund remaining paid value'});
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   assert.equal(value.refunds.reduce((sum,refund)=>sum+refund.amountCents,0),4875);
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:1,reason:'No refundable value'},{status:409});
   const stock=await pier.api('/api/pier/state');
   assert.equal(stock.returns.length,0);
   assert.equal(stock.shipments.length,before.shipments.length+1);
   const exported=await h.api('/api/stall/exports/records'),record=exported.orders.find(row=>row.id===value.id);
   assert.equal(record.shippingCents,625);
   assert.deepEqual(record.refunds.map(refund=>refund.kind),['shipping','shipping','goodwill','lines','goodwill']);
   const net=exported.reconciliation.find(row=>row.orderId===value.id);
   assert.equal(net.netRecordedCents,0);
   assert.equal(net.succeededRefundCents,4875);
  });
  await t.test('manual paid sales reserve once, preserve commercial truth and record reviewed refunds without moving money',async()=>{
   const owner=(await state(h)).actor,member=await h.signIn('synthetic-stall-201@example.test'),admin=await h.signIn('synthetic-stall-202@example.test','admin');
   const grant=await h.api('/api/stall/agent-token',{}),agent={as:'',headers:{authorization:'Bearer '+grant.token}};
   await reviseProduct(h,'MUG-BLUE','Current mug for paid sales',2450);
   await h.command('shipping.configure',{shippingCents:625});
   const payload={idempotencyKey:randomUUID(),customerEmail:'synthetic-stall-203@example.test',name:'Ana Ruiz',address:{line1:'12 Cedar Lane',line2:'Apt 2',city:'Austin',state:'TX',postal_code:'78702',country:'US'},lines:[{sku:'MUG-BLUE',quantity:1}],expectedTotalCents:3075,amountCents:3075,method:'check',receivedOn:'2026-10-20',reference:'synthetic-stall-204'};
   for(const opts of [{as:'',status:401},{as:member,status:403},{...agent,status:403}])await h.command('order.manual',payload,opts);
   for(const bad of [{amountCents:3074},{receivedOn:'2099-01-01'},{receivedOn:'2026-02-30'},{method:'unpaid'},{lines:[{sku:'MUG-BLUE',quantity:0}]},{address:{...payload.address,country:'CA'}}])await h.command('order.manual',{...payload,...bad},{status:400});
   await h.command('order.manual',{...payload,expectedTotalCents:3074,amountCents:3074},{status:409});
   const before=await pier.api('/api/pier/state'),stripeCalls=edge.calls.length,messages=h.messages.length;
   edge.loseNextPierResponse('order.create');
   await h.command('order.manual',payload,{as:admin,status:503});
   assert.equal((await pier.api('/api/pier/state')).orders.length,before.orders.length+1);
   let value=await h.command('order.manual',payload,{as:admin});
   assert.equal(value.status,'reserved');assert.equal(value.payment.source,'staff');assert.equal(value.payment.label,'Payment recorded by staff, not confirmed by a payment provider');assert.equal(value.payment.intentId,undefined);assert.equal(value.payment.sessionId,undefined);
   await h.api('/api/stall/checkout/confirm',{orderId:value.id},{as:'',status:404});
   assert.equal(value.manualPayment.method,'check');assert.equal(value.manualPayment.amountCents,value.totalCents);assert.equal(value.manualPayment.reference,payload.reference);assert.equal(value.taxTreatment,'no_tax_recorded');assert.equal(value.channel,'manual');
   assert.ok(value.manualPayment.by);assert.ok(value.manualPayment.at.endsWith('Z'));
   assert.equal((await h.command('order.manual',payload)).id,value.id);
   await h.command('order.manual',{...payload,name:'Different buyer'},{status:409});
   const native=(await pier.api('/api/pier/state')).orders.find(order=>order.id===value.reservation.id);
   assert.equal(native.channelPayment,undefined);assert.equal(native.lines[0].reserved,'1');
   assert.equal((await pier.api('/api/pier/state')).orders.length,before.orders.length+1);
   assert.equal(edge.calls.length,stripeCalls);assert.equal(h.messages.length,messages);
   const manual=await h.api('/api/stall/orders?channel=manual&customer=ANA+RUIZ&sku=MUG-BLUE&status=reserved');
   assert.deepEqual(manual.orders.map(order=>order.id),[value.id]);assert.equal(manual.total,1);
   assert.ok(!(await h.api('/api/stall/orders?channel=online')).orders.some(order=>order.id===value.id));
   const original=structuredClone(value);
   value=await h.command('order.note.add',{orderId:value.id,revision:value.revision,text:'synthetic-stall-205'});
   value=await h.command('order.tag.add',{orderId:value.id,revision:value.revision,tag:'synthetic-stall-206'});
   const agentView=(await h.api('/api/stall/state',undefined,agent)).orders.find(order=>order.id===value.id);
   assert.equal(agentView.notes,undefined);assert.equal(agentView.tags,undefined);assert.equal(agentView.payment,undefined);
   value=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'synthetic-stall-207'},agent);
   assert.equal(value.notes,undefined);assert.equal(value.tags,undefined);
   value=await h.command('shipment.approve',{orderId:value.id,revision:value.revision});
   assert.equal(value.status,'shipped');
   await reviseProduct(h,'MUG-BLUE','New catalog name and price',2600);
   value=await order(h,value.id);
   assert.deepEqual(value.lines,original.lines);assert.deepEqual(value.shippingDetails,original.shippingDetails);assert.equal(value.totalCents,original.totalCents);assert.equal(value.reservation.id,original.reservation.id);
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Recorded return; no money moved'});
   await h.command('refund.approve',{orderId:value.id,revision:'stale'},{status:409});
   await h.command('refund.approve',{orderId:value.id,revision:value.revision},{...agent,status:403});
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   assert.equal(value.refunds.at(-1).source,'staff');assert.equal(value.refunds.at(-1).label,'Refund recorded by staff; Stall moved no money');assert.equal(value.refunds.at(-1).status,'succeeded');assert.equal(value.refunds.at(-1).amountCents,2450);assert.equal(value.refunds.at(-1).stripeId,undefined);
   assert.equal((await h.command('refund.approve',{orderId:value.id,revision:value.revision})).refunds.length,1);
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Duplicate purchased units'},{status:409});
   await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:626,reason:'Exceeds remainder'},{status:409});
   value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:625,reason:'Record remaining shipping refund'});
   value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
   assert.equal(value.refunds.reduce((sum,refund)=>sum+refund.amountCents,0),3075);
   assert.equal(edge.calls.length,stripeCalls);assert.equal(h.messages.length,messages);
   for(const text of ['synthetic-stall-204','synthetic-stall-205','synthetic-stall-206']) assert.ok(!outbound.some(body=>body.includes(text)),'internal text never crosses provider boundary');
   const exported=await h.api('/api/stall/exports/records'),record=exported.orders.find(order=>order.id===value.id);
   assert.equal(record.payment.label,'Payment recorded by staff, not confirmed by a payment provider');assert.equal(record.payment.source,'staff');assert.equal(record.payment.method,'check');assert.equal(record.taxTreatment,'no_tax_recorded');
   assert.equal(exported.reconciliation.find(row=>row.orderId===value.id).netRecordedCents,0);
   const history=await h.api('/api/stall/orders/history?orderId='+value.id);
   assert.ok(history.events.some(event=>event.action==='payment.staff-recorded'));assert.equal(history.events.filter(event=>event.action==='refund.staff-recorded').length,2);assert.equal(history.references.payment,undefined);
   // Public catalogues and checkout responses never contain staff annotations.
   assert.ok(!JSON.stringify(await h.api('/api/stall/catalogue',undefined,{as:''})).includes('synthetic-stall-205'));
   assert.equal(owner.role,'owner');
   await reviseProduct(h,'MUG-BLUE','Blue ceramic mug',2450);
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
   // ORDER-001: a partly shipped order is overdue only once Pier's latest dispatch is over 7 days old.
   const overdue=async()=>(await h.api('/api/stall/orders?overdue=partial')).orders.map(o=>o.id);
   const aged=ms=>h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.shipment.dispatches[0].shippedAt',?) WHERE id=?").bind(new Date(Date.now()-ms).toISOString(),value.id).run();
   assert.deepEqual(await overdue(),[]);
   await aged(7*86400000-3600000);assert.deepEqual(await overdue(),[]);
   await aged(7*86400000+3600000);assert.deepEqual(await overdue(),[value.id]);
   assert.deepEqual((await h.api('/api/stall/orders?overdue=partial&status=shipped')).orders,[]);
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

// ORDER-001 adds responsibility and local presentation without changing commercial facts.
test('ORDER-001: time zones and revision-checked staff assignments survive transfer without granting authority',async()=>{
 const stock=volumeStock(),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 let destination;
 try {
  const member=await h.signIn('packer@example.test');
  const staff=(await h.api('/auth/session',undefined,{as:member})).operator;
  const owner=(await state(h)).actor;
  await h.command('shop.configure',{timeZone:'Pacific/Auckland'});
  assert.equal((await state(h)).timeZone,'Pacific/Auckland');
  await h.command('shop.configure',{timeZone:'Mars/Crater'},{status:400});
  await h.command('shop.configure',{timeZone:'+09:00'},{status:400});
  await h.command('shop.configure',{timeZone:'Europe/London'},{as:member,status:403});
  assert.equal((await state(h)).timeZone,'Pacific/Auckland');
  await h.command('shop.configure',{timeZone:'US/Central'});
  assert.equal((await state(h)).timeZone,'America/Chicago');
  await h.command('shop.configure',{timeZone:'America/New_York'});
  assert.equal((await state(h)).timeZone,'America/New_York');
  assert.ok((await state(h)).audit.some(event=>event.action==='shop.configured'&&event.actor===owner.id));
  await h.command('shop.configure',{timeZone:'Pacific/Auckland'});
  await publish(h,stock.items[0].sku,'A handmade ceramic bowl',3000);
  const bought=await purchase(h,edge,{skus:[stock.items[0].sku],quantities:[1]});
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200);
  const paidSnapshot=await order(h,bought.orderId);
  // Later provider address and catalog edits cannot rewrite the purchased snapshot.
  edge.sessions.get(bought.session.id).collected_information.shipping_details.address.line1='Changed in provider account';
  await reviseProduct(h,stock.items[0].sku,'Changed catalog name',3300);
  await h.command('order.reconcile',{orderId:bought.orderId});
  const afterChanges=await order(h,bought.orderId);
  assert.deepEqual(afterChanges.shippingDetails,paidSnapshot.shippingDetails);assert.deepEqual(afterChanges.lines,paidSnapshot.lines);
  assert.deepEqual(afterChanges.payment,paidSnapshot.payment);assert.deepEqual(afterChanges.reservation,paidSnapshot.reservation);assert.equal(afterChanges.totalCents,paidSnapshot.totalCents);
  const original=await order(h,bought.orderId),payload={orderId:original.id,revision:original.revision,assigneeId:staff.id};
  await h.command('order.assign',payload,{as:'',status:401});
  await h.command('order.assign',payload,{as:member,status:403});
  const grant=await h.api('/api/stall/agent-token',{});
  await h.command('order.assign',payload,{as:'',headers:{authorization:'Bearer '+grant.token},status:403});
  await h.command('shop.configure',{timeZone:'UTC'},{as:'',headers:{authorization:'Bearer '+grant.token},status:403});
  await h.command('order.assign',{...payload,assigneeId:'missing-staff'},{status:400});
  const assigned=await h.command('order.assign',payload);
  assert.equal(assigned.assignments[0].assigneeId,staff.id);
  assert.equal(assigned.assignments[0].by,owner.id);
  assert.ok(Number.isFinite(Date.parse(assigned.assignments[0].at)));
  assert.deepEqual(assigned.lines,original.lines);
  assert.deepEqual(assigned.payment,original.payment);
  assert.deepEqual(assigned.reservation,original.reservation);
  assert.equal(assigned.totalCents,original.totalCents);
  await h.command('order.assign',{...payload,assigneeId:null},{status:409});
  // Assignment does not give a member private reads or any approval authority.
  await h.api('/api/stall/state',undefined,{as:member,status:403});
  const unchanged=await h.command('order.assign',{...payload,revision:assigned.revision});
  assert.deepEqual(unchanged.assignments,assigned.assignments);
  const cleared=await h.command('order.assign',{...payload,revision:assigned.revision,assigneeId:null});
  assert.deepEqual(cleared.assignments.map(a=>a.assigneeId),[staff.id,null]);
  const saved=await h.command('order.assign',{...payload,revision:cleared.revision});
  // ORDER-001 search: filters combine, and dates are the saved zone's inclusive calendar days.
  await publish(h,stock.items[1].sku,'A second handmade piece',3200);
  const second=await purchase(h,edge,{skus:[stock.items[1].sku],quantities:[1],email:'later@example.test'});
  assert.equal((await deliverWebhook(h,secret,edge.pay(second.session.id))).response.status,200);
  const find=async(query,opts)=>(await h.api('/api/stall/orders?'+query,undefined,opts)).orders?.map(o=>o.id);
  await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt','2026-03-01T11:30:00.000Z') WHERE id=?").bind(original.id).run();
  assert.deepEqual(await find('from=2026-03-02&to=2026-03-02'),[original.id]);
  assert.deepEqual(await find('to=2026-03-01'),[]);
  await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt','2026-03-01T10:59:59.000Z') WHERE id=?").bind(original.id).run();
  assert.deepEqual(await find('to=2026-03-01'),[original.id]);
  assert.deepEqual(await find('from=2026-03-02&to=2026-03-02'),[]);
  assert.deepEqual(await find(`sku=${stock.items[1].sku}`),[second.orderId]);
  assert.deepEqual(await find('customer=LATER@example'),[second.orderId]);
  assert.deepEqual(await find(`status=reserved&sku=${stock.items[0].sku}&to=2026-03-01`),[original.id]);
  assert.deepEqual(await find('status=shipped'),[]);
  assert.equal((await find('')).length,2);
  await find('from=2026-02-30',{status:400});await find('from=2026-03-03&to=2026-03-02',{status:400});await find('status=bogus',{status:400});await find('overdue=yes',{status:400});
  await find('',{as:member,status:403});await find('',{as:'',status:401});
  // The order's one history lists every audited action and the provider references it keeps.
  const history=await h.api('/api/stall/orders/history?orderId='+original.id);
  assert.ok(history.events.some(e=>e.action==='payment.confirmed'&&e.actor==='stripe'));
  assert.equal(history.events.filter(e=>e.action==='order.assigned'&&e.actor===owner.id).length,3);
  assert.equal(history.references.payment.sessionId,original.payment.sessionId);
  assert.equal(history.references.reservation,original.reservation.reference);
  assert.ok(history.events.every(e=>Number.isFinite(Date.parse(e.at))));
  await h.api('/api/stall/orders/history?orderId='+original.id,undefined,{as:member,status:403});
  await h.api('/api/stall/orders/history?orderId=missing',undefined,{status:404});
  await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt','2026-10-20T04:30:00.000Z') WHERE id=?").bind(original.id).run();
  await h.command('shop.configure',{timeZone:'America/Chicago'});
  assert.deepEqual(await find('from=2026-10-19&to=2026-10-19'),[original.id]);
  const utcBefore=(await h.api('/api/stall/exports/records')).orders.find(order=>order.id===original.id).createdAt;
  await h.command('shop.configure',{timeZone:'America/New_York'});
  assert.deepEqual(await find('from=2026-10-20&to=2026-10-20'),[original.id]);
  assert.deepEqual(await find('from=2026-10-19&to=2026-10-19'),[]);
  assert.equal((await order(h,original.id)).createdAt,utcBefore);
  assert.equal((await h.api('/api/stall/exports/records')).orders.find(order=>order.id===original.id).createdAt,utcBefore);
  for(const [day,first,last,before,after] of [
   ['2026-03-08','2026-03-08T05:00:00.000Z','2026-03-09T03:59:59.999Z','2026-03-08T04:59:59.999Z','2026-03-09T04:00:00.000Z'],
   ['2026-11-01','2026-11-01T04:00:00.000Z','2026-11-02T04:59:59.999Z','2026-11-01T03:59:59.999Z','2026-11-02T05:00:00.000Z']]) {
   for(const [at,included] of [[first,true],[last,true],[before,false],[after,false]]) {
    await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt',?) WHERE id=?").bind(at,original.id).run();
    assert.equal((await find(`from=${day}&to=${day}`)).includes(original.id),included);
   }
  }
  await h.command('shop.configure',{timeZone:'Pacific/Auckland'});
  const exported=await h.api('/api/stall/exports/records');
  assert.equal(exported.timeZone,'Pacific/Auckland');
  assert.deepEqual(exported.orders.find(o=>o.id===original.id).assignments,saved.assignments);
  const logs=(await state(h)).audit.filter(a=>a.action==='order.assigned');
  assert.equal(logs.length,3);
  assert.ok(logs.every(a=>a.actor===owner.id&&a.subject===original.id&&Number.isFinite(Date.parse(a.at))));
  destination=await installation();
  await restore(destination,await archive(h));
  const restored=await state(destination);
  assert.equal(restored.timeZone,'Pacific/Auckland');
  assert.deepEqual(restored.orders.find(o=>o.id===original.id).assignments,saved.assignments);
  assert.equal(restored.staff[staff.id],undefined);
  await destination.command('order.assign',{...payload,revision:restored.orders.find(o=>o.id===original.id).revision},{status:400});
  await destination.api('/api/stall/state',undefined,{as:member,status:401});
  assert.equal(edge.sessions.size,2);
 }finally{if(destination)await destination.close();await h.close()}
});

test('CATALOG-001: variants, galleries, handles and listing states sell the exact variant and keep immutable order history',async()=>{
 const stock=volumeStock(['TEE-S-RED','TEE-M-RED','TEE-M-BLUE','HAT-1','TEE-XL']),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 let destination;
 try {
  const upload=async(bytes,type,opts)=>sendFile(h,'/api/stall/media',bytes,type,opts);
  const front=await (await upload(png(80,1),'image/png')).json(),back=await (await upload(png(90,2),'image/png')).json();
  assert.equal(front.kind,'image');
  const member=await h.signIn('catalog-member@example.test');
  for(const [bytes,type,opts,status] of [[Buffer.from('not an image'),'image/png',{},415],[png(),'image/jpeg',{},415],[png(700001),'image/png',{},413],[png(),'image/png',{as:''},401],[png(),'image/png',{as:member},403],[png(),'image/png',{origin:'https://elsewhere.test'},403]])
   assert.equal((await upload(bytes,type,opts)).status,status);
  const details={costCents:900,weightGrams:200,dimensionsMm:{length:300,width:200,height:20},taxCategory:'apparel',hsCode:'610910',countryOfOrigin:'PT',customsDescription:'Cotton t-shirt',handle:'linen-tee',compareAtCents:3500,categories:['Tops'],tags:['summer','cotton'],attributes:[{name:'Material',value:'Organic cotton'}],
   customFields:[{key:'size_chart',label:'Size chart',type:'text',value:'S chest 92 cm · M chest 98 cm'}],media:[{id:front.id,kind:'image',alt:'Front of the tee'},{id:back.id,kind:'image',alt:'Back of the tee'}],
   options:[{name:'Size',values:['S','M']},{name:'Color',values:['Red','Blue']}],
   variants:[{sku:'TEE-S-RED',options:{Size:'S',Color:'Red'}},{sku:'TEE-M-RED',options:{Size:'M',Color:'Red'},unitCents:2600,weightGrams:210,mediaId:back.id},{sku:'TEE-M-BLUE',options:{Size:'M',Color:'Blue'},customsDescription:'Blue cotton t-shirt'}]};
  const payload={sku:'TEE',name:'Linen tee',description:'Soft and light',unitCents:2500,active:true,details};
  const variants=details.variants;
  for(const invalid of [
   {...details,variants:[{...variants[0],options:{Size:'XL',Color:'Red'}}]},{...details,variants:[variants[0],{...variants[0],sku:'OTHER'}]},{...details,variants:[variants[0],{...variants[1],sku:'TEE-S-RED'}]},
   {...details,variants:[{...variants[0],options:{Size:'S'}}]},{...details,handle:'Linen Tee'},{...details,media:[{id:front.id,kind:'image',alt:''}]},{...details,variants:[{...variants[0],mediaId:randomUUID()}]},
   {...details,options:undefined,variants:undefined,personalization:[{key:'x',label:'X',type:'file',fileTypes:['exe'],maxBytes:100}]},{...details,secret:'x'},
  ]) await h.command('product.prepare',{...payload,details:invalid},{status:400});
  await h.command('product.prepare',{...payload,details:{...details,compareAtCents:2500}},{status:400});
  await h.command('product.prepare',{...payload,details:{...details,media:[{id:randomUUID(),kind:'image',alt:'Missing'}],variants:variants.map(({mediaId,...rest})=>rest)}},{status:409});
  const prepared=await h.command('product.prepare',payload);
  assert.deepEqual((await h.api('/api/stall/catalogue',undefined,{as:''})).items,[]);
  assert.equal((await h.request('/api/stall/media/'+front.id,{as:''})).status,404);
  assert.equal((await h.request('/api/stall/media/'+front.id)).status,200,'staff preview an unpublished file');
  await h.command('product.prepare',{sku:'MISSING-PIER',name:'No stock',description:'',unitCents:100,active:true,details:{options:[{name:'Size',values:['S']}],variants:[{sku:'NOT-IN-PIER',options:{Size:'S'}}]}});
  await h.command('product.approve',{sku:'MISSING-PIER',revision:(await state(h)).products.find(p=>p.id==='MISSING-PIER').revision},{status:409});
  const published=await h.command('product.approve',{sku:'TEE',revision:prepared.revision});
  assert.deepEqual(published.value.details,details);
  const shop=await h.api('/api/stall/catalogue',undefined,{as:''});
  assert.deepEqual(shop.items.map(item=>[item.sku,item.name,item.unitCents,item.compareAtCents]),[['TEE-S-RED','Linen tee — S / Red',2500,3500],['TEE-M-RED','Linen tee — M / Red',2600,3500],['TEE-M-BLUE','Linen tee — M / Blue',2500,3500]]);
  const page=shop.products.find(product=>product.sku==='TEE');
  assert.deepEqual([page.handle,page.categories,page.tags,page.attributes,page.options.length,page.customFields[0].label],['linen-tee',['Tops'],['summer','cotton'],[{name:'Material',value:'Organic cotton'}],2,'Size chart']);
  assert.deepEqual(page.media.map(item=>[item.alt,item.url]),[['Front of the tee','/api/stall/media/'+front.id],['Back of the tee','/api/stall/media/'+back.id]]);
  assert.equal(shop.items[1].variant.mediaId,back.id);
  for(const field of ['costCents','taxCategory','hsCode','weightGrams','customsDescription']) assert.ok(!JSON.stringify(shop).includes(field));
  const file=await h.request('/api/stall/media/'+front.id,{as:''});
  assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/png');assert.equal(file.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),png(80,1));
  // Another product may not take this product's SKU or handle.
  await h.command('product.prepare',{sku:'TEE-M-BLUE',name:'Clash',description:'',unitCents:100,active:true},{status:409});
  await h.command('product.prepare',{sku:'OTHER-TEE',name:'Clash',description:'',unitCents:100,active:true,details:{handle:'linen-tee'}},{status:409});
  // Buy two exact variants; the order records each selection at the price paid.
  const total=2600+2500+(await state(h)).shippingCents;
  const bought=await purchase(h,edge,{skus:['TEE-M-RED','TEE-S-RED'],quantities:[1,1],expectedTotalCents:total});
  assert.equal((await deliverWebhook(h,secret,edge.pay(bought.session.id))).response.status,200);
  const lines=(await order(h,bought.orderId)).lines;
  assert.deepEqual(lines.map(line=>[line.sku,line.name,line.productSku,line.variant,line.unitCents]),[['TEE-M-RED','Linen tee — M / Red','TEE',{Size:'M',Color:'Red'},2600],['TEE-S-RED','Linen tee — S / Red','TEE',{Size:'S',Color:'Red'},2500]]);
  // Change the current price, then archive one variant: history keeps what was bought.
  const revised=await h.command('product.prepare',{...payload,revision:published.revision,unitCents:3000,details:{...details,compareAtCents:4000,variants:[{...variants[0],archived:true},{...variants[1],unitCents:3200},variants[2]]}});
  await h.command('product.approve',{sku:'TEE',revision:revised.revision});
  const after=await h.api('/api/stall/catalogue',undefined,{as:''});
  assert.deepEqual(after.items.map(item=>[item.sku,item.unitCents]),[['TEE-M-RED',3200],['TEE-M-BLUE',3000]]);
  await h.command('order.reconcile',{orderId:bought.orderId});
  assert.deepEqual((await order(h,bought.orderId)).lines.map(line=>[line.sku,line.unitCents,line.description]),[['TEE-M-RED',2600,'Soft and light'],['TEE-S-RED',2500,'Soft and light']]);
  assert.equal((await h.api('/api/stall/checkout',{customerEmail:'late@example.test',lines:[{sku:'TEE-S-RED',quantity:1}],idempotencyKey:randomUUID()},{as:'',status:409})).error.code,'PRODUCT');
  // Exports and archives carry variants, media references and the purchased selection.
  const exported=await h.api('/api/stall/exports/records');
  assert.equal(exported.products.find(p=>p.id==='TEE').value.details.variants.length,3);
  assert.equal(exported.orders[0].lines[0].variant.Size,'M');
  assert.match(readCsv(await (await h.request('/api/stall/exports/lines')).text())[0].variant,/Size/);
  destination=await installation();
  await restore(destination,await archive(h));
  assert.deepEqual((await destination.api('/api/stall/exports/records')).products,exported.products);
  assert.deepEqual(Buffer.from(await (await destination.request('/api/stall/media/'+front.id,{as:''})).arrayBuffer()),png(80,1));
  // Scheduling: invisible until its time, then live without another approval; archive withdraws it.
  const soon=new Date(Date.now()+2500).toISOString();
  await h.command('product.prepare',{sku:'HAT-1',name:'Wool hat',description:'Warm',unitCents:1800,active:false,publishAt:soon},{status:400});
  const hat=await h.command('product.prepare',{sku:'HAT-1',name:'Wool hat',description:'Warm',unitCents:1800,active:true,publishAt:soon});
  const scheduled=await h.command('product.approve',{sku:'HAT-1',revision:hat.revision});
  assert.equal(scheduled.value.publishAt,soon);
  assert.ok(!(await h.api('/api/stall/catalogue',undefined,{as:''})).items.some(item=>item.sku==='HAT-1'));
  await new Promise(resolve=>setTimeout(resolve,2600));
  assert.ok((await h.api('/api/stall/catalogue',undefined,{as:''})).items.some(item=>item.sku==='HAT-1'));
  const retired=await h.command('product.prepare',{sku:'HAT-1',name:'Wool hat',description:'Warm',unitCents:1800,archived:true,revision:scheduled.revision});
  await h.command('product.approve',{sku:'HAT-1',revision:retired.revision});
  assert.ok(!(await h.api('/api/stall/catalogue',undefined,{as:''})).items.some(item=>item.sku==='HAT-1'));
  const archivedTee=await h.command('product.prepare',{sku:'TEE',revision:(await state(h)).products.find(p=>p.id==='TEE').revision,name:'Linen tee',description:'Soft and light',unitCents:3000,archived:true});
  await h.command('product.approve',{sku:'TEE',revision:archivedTee.revision});
  assert.deepEqual((await h.api('/api/stall/catalogue',undefined,{as:''})).items,[]);
  assert.equal((await h.request('/api/stall/media/'+front.id,{as:''})).status,404);
  assert.equal((await order(h,bought.orderId)).lines[0].name,'Linen tee — M / Red');
 }finally{if(destination)await destination.close();await h.close()}
});

test('STORE-002: collections, menus, search, filters, synonyms and pins agree with the published sellable catalog',async()=>{
 const bulk=Array.from({length:25},(_,i)=>`BULK-${String(i).padStart(2,'0')}`);
 const skus=['TSH-1','HAT-1','MUG-1','BAG-1','HOOD-S-BLK','HOOD-M-BLK','HOOD-M-GRY','SECRET-1',...bulk];
 const stock=volumeStock(skus),edge=stripeEdge({forward:stock.forward});
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:randomBytes(32).toString('hex')},outboundService:edge.handle});
 let destination;
 try {
  const put=async(sku,name,unitCents,details,description='')=>{const draft=await h.command('product.prepare',{sku,name,description,unitCents,active:true,details});return h.command('product.approve',{sku,revision:draft.revision})};
  const material=value=>({name:'Material',value});
  await put('TSH-1','Linen t-shirt',2500,{handle:'linen-t-shirt',categories:['Tops'],tags:['summer'],attributes:[material('Cotton')]},'Light summer top');
  await put('HAT-1','Wool beanie',1800,{categories:['Accessories'],tags:['winter'],attributes:[material('Wool')]});
  await put('MUG-1','Ceramic mug',2200,{categories:['Home'],attributes:[material('Ceramic')]},'Hand glazed');
  await put('BAG-1','Cotton tote bag',3000,{categories:['Accessories'],tags:['summer'],attributes:[material('Cotton')]});
  await put('HOODIE','Fleece hoodie',5000,{categories:['Tops'],attributes:[material('Cotton')],options:[{name:'Size',values:['S','M']},{name:'Color',values:['Black','Grey']}],
   variants:[{sku:'HOOD-S-BLK',options:{Size:'S',Color:'Black'}},{sku:'HOOD-M-BLK',options:{Size:'M',Color:'Black'},unitCents:5500},{sku:'HOOD-M-GRY',options:{Size:'M',Color:'Grey'},unitCents:5500}]});
  for(const sku of bulk) await put(sku,`Bulk item ${sku.slice(-2)}`,1000+Number(sku.slice(-2)),{categories:['Bulk']});
  const secret=await h.command('product.prepare',{sku:'SECRET-1',name:'Secret prototype',description:'',unitCents:900,active:true});
  const find=async(query='',opts={})=>h.api('/api/stall/discover'+(query?'?'+query:''),undefined,{as:'',...opts});
  const names=async query=>{const result=await find(query),catalogue=await h.api('/api/stall/catalogue',undefined,{as:''});return result.order.map(sku=>catalogue.products.find(product=>product.sku===sku).name)};
  let all=await find();
  assert.equal(all.total,30,'unpublished and unstocked products stay out of the catalog');
  assert.equal(all.order.length,24);assert.equal(all.pages,2);
  assert.equal((await find('page=2')).order.length,6);
  assert.ok(!JSON.stringify(all).includes('Secret'));
  // Collections: a hand-picked list and rule-based sets.
  const rejected=[{handle:'Bad Handle',title:'x',kind:'manual',skus:[]},{handle:'gifts',title:'Gifts',kind:'manual',skus:['NOPE-1']},{handle:'gifts',title:'Gifts',kind:'rule',rules:[]},{handle:'gifts',title:'Gifts',kind:'rule',rules:[{field:'colour',value:'x'}]}];
  for(const payload of rejected) await h.command('collection.save',{description:'',...payload},{status:400});
  const gifts=await h.command('collection.save',{handle:'gifts',title:'Gifts under the tree',description:'Small things people keep.',kind:'manual',skus:['MUG-1','HAT-1']});
  await h.command('collection.save',{handle:'cotton',title:'Cotton goods',description:'',kind:'rule',match:'all',rules:[{field:'attribute',name:'Material',value:'cotton'}]});
  await h.command('collection.save',{handle:'under-25',title:'Under $25',description:'',kind:'rule',rules:[{field:'price_max',cents:2500}],sort:'price-desc'});
  await h.command('collection.save',{handle:'gifts',title:'Again',description:'',kind:'manual',skus:[]},{status:409});
  await h.command('collection.save',{handle:'draft-list',title:'Not yet',description:'',kind:'manual',skus:['TSH-1'],published:false});
  assert.deepEqual(await names('collection=gifts'),['Ceramic mug','Wool beanie'],'a manual collection keeps its merchant order');
  const gift=await find('collection=gifts');
  assert.deepEqual([gift.total,gift.collection.title,gift.collection.description],[2,'Gifts under the tree','Small things people keep.']);
  assert.deepEqual((await names('collection=cotton')).sort(),['Cotton tote bag','Fleece hoodie','Linen t-shirt']);
  assert.equal((await find('collection=draft-list')).total,0,'an unpublished collection is not browsable');
  assert.ok(!all.facets.collections.some(entry=>entry.handle==='draft-list'));
  assert.deepEqual((await names('collection=under-25')).slice(0,3),['Linen t-shirt','Ceramic mug','Wool beanie'],'a collection can set its own sort');
  // Filters combine; counts, facets and totals agree.
  all=await find();
  assert.deepEqual(all.facets.collections.map(entry=>[entry.handle,entry.count]),[['cotton',3],['gifts',2],['under-25',28]]);
  assert.deepEqual(all.facets.categories.slice(0,3).map(entry=>[entry.value,entry.count]),[['Bulk',25],['Accessories',2],['Tops',2]]);
  assert.deepEqual(all.facets.options.map(group=>[group.name,group.values.map(entry=>[entry.value,entry.count])]),[['Color',[['Black',1],['Grey',1]]],['Size',[['M',1],['S',1]]]]);
  const combined=await find('collection=cotton&category=Tops&option.Size=M&option.Color=Grey&min=50&max=60');
  assert.deepEqual([combined.total,combined.order],[1,['HOODIE']]);
  assert.deepEqual((await find('option.Size=S&option.Color=Grey')).order,[],'options must hold for one variant together');
  assert.equal((await find('category=Tops&category=Home')).total,3);
  assert.equal((await find('min=20&max=26')).total,2);
  assert.equal((await find('attr.Material=Wool')).total,1);
  const prices=await find('collection=cotton&sort=price-asc'),priceDesc=await find('collection=cotton&sort=price-desc');
  assert.deepEqual(priceDesc.order,prices.order.slice().reverse());
  assert.deepEqual((await find('sort=name')).order.slice(0,2),['BULK-00','BULK-01']);
  // Publication and stock changes reach the public results at once.
  stock.setAvailable('HAT-1','0');
  assert.equal((await find('available=1')).total,29);assert.equal((await find()).total,30,'sold out stays listed');
  assert.deepEqual((await find('collection=gifts')).facets.available,{inStock:1,all:2});
  const hat=(await state(h)).products.find(product=>product.id==='MUG-1');
  const withdrawn=await h.command('product.prepare',{sku:'MUG-1',revision:hat.revision,name:'Ceramic mug',description:'Hand glazed',unitCents:2200,active:false});
  await h.command('product.approve',{sku:'MUG-1',revision:withdrawn.revision});
  assert.deepEqual([(await find()).total,(await find('collection=gifts')).total,(await find('category=Home')).total],[29,1,0]);
  assert.ok(!(await find('q=mug')).order.length);
  // Search: names, SKUs, variant SKUs, attributes, case and prefixes.
  assert.deepEqual(await names('q=LINEN'),['Linen t-shirt']);
  assert.deepEqual(await names('q=lin'),['Linen t-shirt']);
  assert.deepEqual(await names('q=tsh-1'),['Linen t-shirt']);
  assert.deepEqual(await names('q=hood-m-gry'),['Fleece hoodie']);
  assert.deepEqual((await names('q=wool')),['Wool beanie']);
  assert.deepEqual((await names('q=cotton')).sort(),['Cotton tote bag','Fleece hoodie','Linen t-shirt']);
  assert.deepEqual(await names('q=cotton&category=Accessories'),['Cotton tote bag']);
  // No results: a useful state, and the query is reported.
  const nothing=await find('q=zzzz&report=1');
  assert.deepEqual([nothing.total,nothing.order,nothing.noResults.query],[0,[],'zzzz']);
  assert.ok(nothing.noResults.suggestions.collections.length&&nothing.noResults.suggestions.categories.length);
  assert.equal((await find('q=tee')).total,0);
  await find('q=zzzz&report=1');await find('q=Linen&report=1');await find('q=linen&page=1');
  // Synonyms change results.
  await h.command('search.synonyms',{groups:[['tee']]},{status:400});
  await h.command('search.synonyms',{groups:[['tee','t-shirt'],['t-shirt','top']]},{status:400});
  const synonyms=await h.command('search.synonyms',{groups:[['tee','t-shirt','tshirt']]});
  assert.deepEqual(await names('q=tee'),['Linen t-shirt']);
  assert.deepEqual(await names('q=tshirt'),['Linen t-shirt']);
  await h.command('search.synonyms',{groups:[],revision:'stale'},{status:409});
  // Pinned and boosted products change the order for their query only.
  const before=await names('q=cotton');
  const first=await h.command('search.pin',{pins:[{query:'cotton',pinned:['HAT-1']}]});
  await h.command('search.pin',{pins:[{query:'cotton',pinned:['HAT-1']}]},{status:409});
  const pinned=await h.command('search.pin',{pins:[{query:'Cotton',pinned:['HAT-1'],boosted:['BAG-1']}],revision:first.revision});
  const after=await names('q=cotton');
  assert.deepEqual([after[0],after[1]],['Wool beanie','Cotton tote bag']);assert.notDeepEqual(after,before);
  assert.deepEqual(await names('q=wool'),['Wool beanie']);
  await h.command('search.pin',{pins:[{query:'x',pinned:['NOPE']}],revision:pinned.revision},{status:400});
  // Predictive suggestions only offer published, sellable things.
  const suggestions=(await h.api('/api/stall/discover/suggest?q=lin',undefined,{as:''})).suggestions;
  assert.deepEqual(suggestions[0],{kind:'product',label:'Linen t-shirt',href:'/shop/linen-t-shirt'});
  assert.ok((await h.api('/api/stall/discover/suggest?q=gif',undefined,{as:''})).suggestions.some(entry=>entry.kind==='collection'&&entry.href==='/shop?collection=gifts'));
  assert.deepEqual((await h.api('/api/stall/discover/suggest?q=secret',undefined,{as:''})).suggestions,[]);
  assert.ok((await h.api('/api/stall/discover/suggest?q=t-sh',undefined,{as:''})).suggestions.length);
  // Menus link only to what is published.
  await h.command('menu.save',{name:'main',items:[{label:'javascript',to:{type:'link',href:'javascript:alert(1)'}}]},{status:400});
  await h.command('menu.save',{name:'main',items:[{label:'Nested',to:{type:'link',href:'/shop'},children:[{label:'Deep',to:{type:'link',href:'/shop'},children:[{label:'Deeper',to:{type:'link',href:'/shop'}}]}]}]},{status:400});
  await h.command('menu.save',{name:'main',items:[{label:'Gifts',to:{type:'collection',handle:'gifts'}},{label:'Shirt',to:{type:'product',handle:'linen-t-shirt'}},{label:'Draft',to:{type:'collection',handle:'draft-list'}},{label:'Mug',to:{type:'product',handle:'mug-1'}},{label:'Shop',to:{type:'link',href:'/shop'},children:[{label:'Tops',to:{type:'link',href:'/shop?category=Tops'}}]}]});
  assert.deepEqual((await h.api('/api/stall/menus',undefined,{as:''})).menus.main,[{label:'Gifts',href:'/shop?collection=gifts'},{label:'Shirt',href:'/shop/linen-t-shirt'},{label:'Shop',href:'/shop',children:[{label:'Tops',href:'/shop?category=Tops'}]}]);
  // Merchant controls are owner/admin people only; agents and members are refused.
  const member=await h.signIn('merch-member@example.test'),grant=await h.api('/api/stall/agent-token',{});
  for(const [type,payload] of [['collection.save',{handle:'x',title:'X',description:'',kind:'manual',skus:[]}],['menu.save',{name:'footer',items:[]}],['search.synonyms',{groups:[]}],['search.pin',{pins:[]}]]) {
   await h.command(type,payload,{as:member,status:403});
   await h.command(type,payload,{as:'',headers:{authorization:`Bearer ${grant.token}`},status:403});
   await h.command(type,payload,{as:'',status:401});
  }
  // The search report lists what shoppers asked for, including queries with no results.
  const report=await h.api('/api/stall/search-report');
  assert.deepEqual(report.top.slice(0,2).map(row=>[row.query,row.searches]),[['zzzz',2],['linen',1]]);
  assert.deepEqual(report.noResults.map(row=>[row.query,row.noResults]),[['zzzz',2]]);
  await h.api('/api/stall/search-report',undefined,{as:'',status:401});await h.api('/api/stall/search-report',undefined,{as:member,status:403});
  // Records travel with the archive and export.
  const exported=await h.api('/api/stall/exports/records');
  assert.deepEqual([exported.collections.length,exported.merchandising.synonyms,exported.merchandising.pins[0].query,exported.searchTerms[0].query],[4,[['tee','t shirt','tshirt']],'cotton','zzzz']);
  destination=await installation();
  await restore(destination,await archive(h));
  assert.deepEqual((await destination.api('/api/stall/exports/records')).collections,exported.collections);
  assert.deepEqual((await destination.api('/api/stall/exports/records')).merchandising,exported.merchandising);
  assert.equal((await h.command('collection.save',{handle:'gifts',title:'Gifts under the tree',description:'Small things people keep.',kind:'manual',skus:['HAT-1'],revision:(await state(h)).merchandising.collections.find(entry=>entry.id==='gifts').revision})).value.skus[0],'HAT-1');
  await h.command('collection.delete',{handle:'draft-list',revision:(await state(h)).merchandising.collections.find(entry=>entry.id==='draft-list').revision});
  assert.equal((await state(h)).merchandising.collections.length,3);void gifts;void synonyms;
 }finally{if(destination)await destination.close();await h.close()}
});
