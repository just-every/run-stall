import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { installation,archive,restore } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge,deliverWebhook,publish,purchase,sendFile,png } from './network.mjs';
import { taxEdge } from './tax-edge.mjs';
import { volumeStock } from './volume-stock.mjs';
import { readCsv } from './csv-reader.mjs';
const state=h=>h.api('/api/stall/state');
const order=async(h,id)=>(await state(h)).orders.find(o=>o.id===id);
test('free shipping promotions reserve real checkout budgets atomically and redeem only verified paid orders',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex'),received=[];
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-801',STRIPE_WEBHOOK_SECRET:secret},outboundService:async request=>{
  const url=new URL(request.url);
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]});
  if(url.hostname==='hooks.synthetic-stall-802.com'){received.push({body:await request.text(),headers:Object.fromEntries(request.headers)});return new Response(null,{status:204})}
  return edge.handle(request);
 }});
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);
  await h.command('shipping.configure',{shippingCents:625});
  const base='/api/stall/promotions',headless='/api/stall/v1',origin='https://shop.synthetic-stall-803.com',customer=await h.signIn('synthetic-stall-804@example.test');
  const app=await h.api(headless+'/admin/apps',{label:'Promotion client',origin,scopes:['cart:write','checkout:write','orders:read']});
  const subscription=await h.api(headless+'/admin/subscriptions',{appId:app.id,endpoint:'https://hooks.synthetic-stall-802.com/events',kinds:['promotion'],consent:'Send minimal Stall event identifiers to this endpoint'});
  const input={code:'SYNTHETIC-STALL-805',startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),minimumBasketCents:2500,maxUsesPerCustomer:1,maxTotalUses:3,maxShippingDiscountCents:1250};
  await h.api(base,input,{as:'',status:401});
  await h.api(base,input,{as:customer,status:403});
  await h.api(base,input,{headers:{origin:origin},status:403});
  const agent=await h.api('/api/stall/agent-token',{});
  await h.api(base,input,{headers:{authorization:'Bearer '+agent.token},status:403});
  let promotion=await h.api(base,input);
  const reportPath=id=>base+'/report?promotionId='+id;
  await h.api(reportPath(promotion.id),undefined,{as:'',status:401});
  await h.api(reportPath(promotion.id),undefined,{as:customer,status:403});
  await h.api(reportPath(promotion.id),undefined,{headers:{authorization:'Bearer '+agent.token},status:403});
  await h.api(reportPath(promotion.id),undefined,{headers:{origin},status:403});
  await h.api(base+'/report?promotionId=synthetic-stall-absent',undefined,{status:404});
  await h.api(reportPath(promotion.id)+'&limit=101',undefined,{status:400});
  await h.api(reportPath(promotion.id)+'&after=invalid',undefined,{status:400});
  assert.deepEqual((await h.api(reportPath(promotion.id))).totals,{checkouts:0,reservedUses:0,paidUses:0,committedDiscountCents:0,grossPaidCents:0,refundedCents:0,pendingRefundCents:0,netPaidCents:0});

  const nativeGet=await h.mf.dispatchFetch(h.origin+base,{headers:{cookie:h.cookie}});
  assert.equal(nativeGet.status,200,'native same-origin GET needs no Origin header');
  assert.equal((await nativeGet.json()).promotions.length,1);
  assert.equal((await h.mf.dispatchFetch(h.origin+base)).status,401,'omitting Origin never grants an anonymous reader access');
  assert.equal((await h.mf.dispatchFetch(h.origin+base,{headers:{cookie:customer}})).status,403);
  assert.equal((await h.mf.dispatchFetch(h.origin+base,{headers:{authorization:'Bearer '+agent.token}})).status,403);
  await h.api(base,undefined,{headers:{origin},status:403});
  const lines=[{sku:'MUG-BLUE',quantity:1}],quoteInput={lines,customerEmail:'synthetic-stall-806@example.test',promotionCode:input.code};
  const quote=overrides=>h.api(base+'/quote',{...quoteInput,...overrides},{as:''});
  const save=async overrides=>{promotion=await h.api(base,{...input,...overrides,id:promotion.id,revision:promotion.revision});return promotion};
  assert.equal((await quote({promotionCode:'SYNTHETIC-STALL-UNKNOWN'})).reason,'UNKNOWN_CODE');
  assert.equal((await quote()).reason,'MINIMUM_BASKET');
  await save({startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString()});
  assert.equal((await quote()).reason,'NOT_STARTED');
  await save({startsAt:new Date(Date.now()-7200000).toISOString(),endsAt:new Date(Date.now()-3600000).toISOString()});
  assert.equal((await quote()).reason,'ENDED');
  await save({minimumBasketCents:2000});
  await h.api(base,{...input,id:promotion.id,revision:'synthetic-stall-stale'},{status:409});
  const applicable=await quote();
  assert.equal(applicable.applicable,true);assert.equal(applicable.discountCents,625);assert.equal(applicable.shippingCents,0);assert.equal(applicable.totalCents,2450);
  const counts=async id=>(await h.api(base)).promotions.find(p=>p.id===id);
  assert.equal((await counts(promotion.id)).reservedUses,0,'quotes do not consume budget');
  await h.api('/api/stall/checkout',{...quoteInput,idempotencyKey:randomUUID()},{as:'',status:400});
  await h.api('/api/stall/checkout',{...quoteInput,idempotencyKey:randomUUID(),expectedTotalCents:3075},{as:'',status:409});
  const firstInput={...quoteInput,idempotencyKey:randomUUID(),expectedTotalCents:2450};
  edge.loseNextCheckoutResponse();
  await h.api('/api/stall/checkout',firstInput,{as:'',status:503});
  assert.equal(edge.sessions.size,1);
  assert.equal((await counts(promotion.id)).reservedUses,1,'uncertain provider effect keeps its allocation');
  assert.equal((await quote()).reason,'CUSTOMER_LIMIT');
  const attempts=['synthetic-stall-807@example.test','synthetic-stall-808@example.test'].map(customerEmail=>({...firstInput,customerEmail,idempotencyKey:randomUUID()}));
  assert.ok((await Promise.all(attempts.map(p=>quote({customerEmail:p.customerEmail})))).every(q=>q.applicable));
  const raced=await Promise.all(attempts.map(async p=>{const response=await h.request('/api/stall/checkout',{method:'POST',as:'',body:p});return {status:response.status,body:await response.json()}}));
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
  assert.equal(edge.sessions.size,2);
  const reserved=await counts(promotion.id);
  assert.equal(reserved.reservedUses,2);assert.equal(reserved.reservedDiscountCents,1250);assert.equal(reserved.usedUses,0);
  assert.equal((await quote({customerEmail:'synthetic-stall-809@example.test'})).reason,'DISCOUNT_BUDGET');
  await h.api(base,{...input,id:promotion.id,revision:promotion.revision,maxShippingDiscountCents:624},{status:409});
  await h.api(base+'/revoke',{id:promotion.id,revision:promotion.revision});
  assert.equal((await quote()).reason,'REVOKED');
  const first=await h.api('/api/stall/checkout',firstInput,{as:''});
  assert.equal(edge.sessions.size,2,'retry recovers the original uncertain checkout after revocation');
  assert.equal((await h.api('/api/stall/checkout',firstInput,{as:''})).orderId,first.orderId);
  await h.api('/api/stall/checkout',{...firstInput,promotionCode:'SYNTHETIC-STALL-OTHER'},{as:'',status:409});
  const session=[...edge.sessions.values()].find(s=>s.client_reference_id===first.orderId);
  assert.equal(session.amount_total,2450);assert.equal(session.total_details.amount_shipping,0);
  const before=await order(h,first.orderId),snapshot=structuredClone(before.promotion);
  assert.equal(snapshot.id,promotion.id);assert.equal(snapshot.discountCents,625);assert.equal(snapshot.originalShippingCents,625);
  assert.ok(!JSON.stringify(snapshot).includes(input.code));
  assert.equal((await deliverWebhook(h,secret,session)).value.pending,true);
  assert.equal((await counts(promotion.id)).usedUses,0,'unpaid callbacks never redeem');
  const paid=edge.pay(session.id),delivery=await deliverWebhook(h,secret,paid);
  assert.equal(delivery.response.status,200);
  assert.equal((await deliverWebhook(h,secret,paid,{id:delivery.id})).value.replayed,true);
  assert.equal((await deliverWebhook(h,secret,paid)).response.status,200);
  let value=await order(h,first.orderId);
  assert.deepEqual(value.promotion,snapshot);
  assert.equal((await counts(promotion.id)).usedUses,1);assert.equal((await counts(promotion.id)).reservedUses,1);
  value=await h.command('shipment.prepare',{orderId:value.id,revision:value.revision,reference:'synthetic-stall-810'});
  value=await h.command('shipment.approve',{orderId:value.id,revision:value.revision});
  await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'shipping',amountCents:625,reason:'Free shipping has no refundable paid value'},{status:409});
  await h.command('refund.prepare',{orderId:value.id,revision:value.revision,kind:'goodwill',amountCents:3075,reason:'Cannot refund more than the paid total'},{status:400});
  value=await h.command('refund.prepare',{orderId:value.id,revision:value.revision,lines:[{sku:'MUG-BLUE',quantity:1}],reason:'Refund actual merchandise paid'});
  value=await h.command('refund.approve',{orderId:value.id,revision:value.revision});
  assert.equal(value.refunds.at(-1).amountCents,2450);assert.deepEqual(value.promotion,snapshot);
  assert.equal((await counts(promotion.id)).usedDiscountCents,625);assert.equal((await counts(promotion.id)).reservedDiscountCents,625);
  const report=await h.api(reportPath(promotion.id)+'&limit=1');
  assert.deepEqual(report.totals,{checkouts:2,reservedUses:1,paidUses:1,committedDiscountCents:1250,grossPaidCents:2450,refundedCents:2450,pendingRefundCents:0,netPaidCents:0});
  assert.equal(report.orders.length,1);assert.ok(report.nextAfter);
  const next=await h.api(reportPath(promotion.id)+'&limit=1&after='+report.nextAfter);
  assert.deepEqual(next.totals,report.totals);assert.equal(next.orders.length,1);assert.equal(next.nextAfter,null);
  const entries=[...report.orders,...next.orders];assert.equal(new Set(entries.map(r=>r.orderId)).size,2);
  const paidEntry=entries.find(r=>r.orderId===first.orderId);
  assert.equal(paidEntry.orderTotalCents,2450);assert.equal(paidEntry.shippingCents,0);assert.equal(paidEntry.refundedCents,2450);
  assert.equal(paidEntry.promotionRevision,snapshot.revision);assert.equal(paidEntry.taxTreatment,'no_tax_recorded');
  assert.equal(paidEntry.qualificationEventId,'promotion.qualified.'+first.orderId);assert.equal(paidEntry.redemptionEventId,'promotion.redeemed.'+first.orderId);
  assert.equal(entries.find(r=>r.status==='reserved').redemptionEventId,null);
  assert.match(report.taxNotice,/unavailable/);
  for(const privateValue of [input.code,firstInput.customerEmail,secret,session.id])assert.ok(!JSON.stringify(report).includes(privateValue));
  const admin=await h.signIn('synthetic-stall-812@example.test','admin');
  assert.deepEqual((await h.api(reportPath(promotion.id),undefined,{as:admin})).totals,report.totals);
  const administrator=(await h.api('/auth/session',undefined,{as:admin})).operator;
  await h.command('staff.configure',{actorId:administrator.id,staffRole:'marketing',refundLimitCents:0});
  await h.api(reportPath(promotion.id),undefined,{as:admin,status:403});

  // The second retail door uses the signed-in customer's identity and the same ledger.
  const second=await h.api(base,{...input,code:'SYNTHETIC-STALL-811',minimumBasketCents:0,maxTotalUses:1,maxShippingDiscountCents:625});
  const headers={origin,authorization:'Bearer '+app.token},call=(path,body,opts={})=>h.api(headless+path,body,{as:customer,headers,...opts});
  const cart=await call('/carts',{lines},{headers:{...headers,'idempotency-key':randomUUID()}});
  const headlessQuote=await call('/carts/'+cart.id+'/quote',{promotionCode:'SYNTHETIC-STALL-811',customerEmail:firstInput.customerEmail});
  assert.equal(headlessQuote.promotion.applicable,true);assert.equal(headlessQuote.promotion.totalCents,2450);
  const headlessInput={cartId:cart.id,promotionCode:'SYNTHETIC-STALL-811',expectedTotalCents:2450},checkoutHeaders={...headers,'idempotency-key':randomUUID()};
  const bought=await call('/checkout',headlessInput,{headers:checkoutHeaders});
  assert.equal((await call('/checkout',headlessInput,{headers:checkoutHeaders})).orderId,bought.orderId);
  const own=await call('/orders/'+bought.orderId);assert.equal(own.promotion.id,second.id);assert.equal(own.shippingCents,0);
  assert.equal((await counts(second.id)).reservedUses,1);
  const secondSession=[...edge.sessions.values()].find(s=>s.client_reference_id===bought.orderId);
  assert.equal((await deliverWebhook(h,secret,edge.pay(secondSession.id))).response.status,200);
  let partiallyRefunded=await order(h,bought.orderId);
  partiallyRefunded=await h.command('shipment.prepare',{orderId:partiallyRefunded.id,revision:partiallyRefunded.revision,reference:'synthetic-stall-813'});
  partiallyRefunded=await h.command('shipment.approve',{orderId:partiallyRefunded.id,revision:partiallyRefunded.revision});
  partiallyRefunded=await h.command('refund.prepare',{orderId:partiallyRefunded.id,revision:partiallyRefunded.revision,kind:'goodwill',amountCents:500,reason:'Partial refund preserves the shipping budget'});
  edge.loseNextRefundResponse();
  await h.command('refund.approve',{orderId:partiallyRefunded.id,revision:partiallyRefunded.revision},{status:503});
  const pendingReport=await h.api(reportPath(second.id));
  assert.equal(pendingReport.totals.pendingRefundCents,500);assert.equal(pendingReport.totals.refundedCents,0);assert.equal(pendingReport.totals.netPaidCents,2450);
  partiallyRefunded=await h.command('order.reconcile',{orderId:partiallyRefunded.id});
  const partialReport=await h.api(reportPath(second.id));
  assert.equal(partialReport.totals.pendingRefundCents,0);assert.equal(partialReport.totals.refundedCents,500);assert.equal(partialReport.totals.netPaidCents,1950);assert.equal(partialReport.totals.committedDiscountCents,625);

  const history=(await h.api(headless+'/admin/deliveries?subscriptionId='+subscription.id)).deliveries;
  const qualified=history.filter(e=>e.eventId==='promotion.qualified.'+first.orderId),redeemed=history.filter(e=>e.eventId==='promotion.redeemed.'+first.orderId);
  assert.equal(qualified.length,1);assert.equal(redeemed.length,1);
  assert.ok(history.some(e=>e.eventId.startsWith('promotion.changed.'+promotion.id+'.')));
  const notice=redeemed[0];await h.api(headless+'/admin/deliveries/'+notice.id+'/send',{});
  await h.api(headless+'/admin/deliveries/'+notice.id+'/replay',{});
  assert.equal(received.length,2);assert.equal(received[0].body,received[1].body);
  const event=JSON.parse(received[0].body);assert.deepEqual(Object.keys(event).sort(),['id','kind','occurredAt','resourceId']);
  assert.equal(event.resourceId,promotion.id);
  const signature=received[0].headers['stall-signature'],stamp=signature.match(/t=(\d+)/)[1],mac=signature.match(/v1=([a-f0-9]+)/)[1];
  assert.equal(mac,createHmac('sha256',subscription.signingSecret).update(stamp+'.'+received[0].body).digest('hex'));
  for(const privateValue of [input.code,firstInput.customerEmail,secret,app.token,subscription.signingSecret])assert.ok(!received[0].body.includes(privateValue));
  assert.ok(!JSON.stringify(await h.api(base)).includes(input.code));
 } finally {await h.close();await pier.close()}
});
test('unpaid checkouts hold promotion budget only until Stripe reports they can no longer be paid',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1331',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);
  await h.command('shipping.configure',{shippingCents:625});
  const create=(code,maxTotalUses)=>h.api('/api/stall/promotions',{code,startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3*86400000).toISOString(),minimumBasketCents:0,maxUsesPerCustomer:1,maxTotalUses,maxShippingDiscountCents:625*maxTotalUses});
  const promotion=await create('SYNTHETIC-STALL-1332',3),lines=[{sku:'MUG-BLUE',quantity:1}];
  const held=async()=>(await h.api('/api/stall/promotions')).promotions.find(p=>p.id===promotion.id).reservedUses;
  const buy=(n,client=n,promotionCode='SYNTHETIC-STALL-1332')=>h.request('/api/stall/checkout',{method:'POST',as:'',headers:{'cf-connecting-ip':'203.0.113.'+client},body:{lines,customerEmail:`synthetic-stall-1333-${n}@example.test`,promotionCode,expectedTotalCents:2450,idempotencyKey:randomUUID()}});
  const quote=()=>h.api('/api/stall/promotions/quote',{lines,customerEmail:'synthetic-stall-1334@example.test',promotionCode:'SYNTHETIC-STALL-1332'},{as:''});
  const sweep=async()=>assert.equal((await (await h.mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'* * * * *'})).outcome,'ok');
  const expiring=await (await buy(1)).json();
  assert.equal((await buy(2)).status,200);
  edge.refuseNextCheckout();
  assert.equal((await buy(3)).status,503);
  assert.equal(await held(),3);assert.equal((await quote()).reason,'TOTAL_LIMIT');
  await sweep();
  assert.equal(await held(),3,'Stripe may still take these payments');
  await h.db.prepare("UPDATE st_orders SET value_json=json_set(value_json,'$.createdAt',?),revision=lower(hex(randomblob(16)))").bind(new Date(Date.now()-26*3600000).toISOString()).run();
  edge.expire([...edge.sessions.values()].find(s=>s.client_reference_id===expiring.orderId).id);
  await sweep();
  assert.equal(await held(),1,'an expired and a never-created checkout release their holds; one Stripe still reports open keeps it');
  assert.equal((await quote()).applicable,true);
  await create('SYNTHETIC-STALL-1335',1000);
  let refused;
  for(let n=10;n<200&&!refused;n++){const response=await buy(n,9,'SYNTHETIC-STALL-1335');if(response.status!==200)refused=response}
  assert.equal(refused?.status,429);assert.equal((await refused.json()).error.code,'RATE_LIMIT');
  assert.equal((await buy(200,10,'SYNTHETIC-STALL-1335')).status,200,'another client still checks out');
 } finally {await h.close();await pier.close()}
});
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

test('stock is reserved only for the delivery ZIP code the shopper was quoted',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1311',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);
  await h.command('shipping.place',{kind:'delivery',value:{zipPrefixes:['100'],feeCents:500,minimumCents:0,instructions:'synthetic-stall-1312'}});
  const lines=[{sku:'MUG-BLUE',quantity:1}],quote=postalCode=>h.api('/api/stall/shipping/quote',{lines,postalCode},{as:''});
  assert.ok(!(await quote('90210')).services.some(service=>service.kind==='delivery'));
  const local=(await quote('10001')).services.find(service=>service.kind==='delivery');
  const buy=async()=>{const {orderId}=await h.api('/api/stall/checkout',{customerEmail:'synthetic-stall-1313@example.test',lines,shipping:{service:local.code,postalCode:'10001',quote:local.quote},expectedTotalCents:2950,idempotencyKey:randomUUID()},{as:''});return [...edge.sessions.values()].find(s=>s.client_reference_id===orderId)};
  const address=postal_code=>({line1:'synthetic-stall-1314',line2:null,city:'New York',state:'NY',postal_code,country:'US'});
  const elsewhere=await buy(),held=await deliverWebhook(h,secret,edge.pay(elsewhere.id,address('90210')));
  assert.equal(held.response.status,409);assert.equal(held.value.error.code,'DESTINATION_CHANGED');
  const paid=await order(h,elsewhere.client_reference_id);
  assert.equal(paid.status,'paid');assert.equal(paid.reservation,undefined);assert.equal(paid.shippingDetails.address.postal_code,'90210');
  assert.equal((await h.command('order.reconcile',{orderId:paid.id},{status:409})).error.code,'DESTINATION_CHANGED');
  const reviewed=await buy();
  assert.equal((await deliverWebhook(h,secret,edge.pay(reviewed.id,address('10001-2345')))).value.status,'reserved');
 }finally {await h.close();await pier.close();}
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

test('functional staff grants isolate workflows, customer records and stale prepared authority',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-502',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 try {
  const sku='MUG-BLUE'
  await publish(h,sku,'Hand-thrown serving bowl',3000)
  const people={}
  for(const [i,role] of ['catalog','fulfillment','customer_support','marketing','finance','administrator'].entries()) {
   const cookie=await h.signIn(`synthetic-stall-${510+i}@example.test`),person=(await h.api('/auth/session',undefined,{as:cookie})).operator
   people[role]={cookie,...person}
   await h.command('staff.configure',{actorId:person.id,staffRole:role,refundLimitCents:1500})
  }
  const bought=await purchase(h,edge,{skus:[sku],quantities:[1],expectedTotalCents:3000,email:'synthetic-stall-520@example.test'})
  await deliverWebhook(h,secret,edge.pay(bought.session.id))
  let current=await order(h,bought.orderId)
  current=await h.command('order.note.add',{orderId:current.id,revision:current.revision,text:'Keep this instruction inside the staff desk'})
  for(const [role,person] of Object.entries(people)) {
   const snapshot=await h.api('/api/stall/state',undefined,{as:person.cookie})
   assert.equal(snapshot.actor.staffRole,role)
   assert.equal(snapshot.orders.length,['fulfillment','customer_support','finance','administrator'].includes(role)?1:0)
   assert.equal(snapshot.products.length,['catalog','marketing','administrator'].includes(role)?1:0)
   assert.deepEqual(snapshot.audit,[])
   assert.equal(snapshot.connectionDetails,undefined)
   assert.ok(!JSON.stringify(snapshot).includes('synthetic-stall-501'))
   assert.ok(!JSON.stringify(snapshot).includes('requestDigest'))
   if(role==='finance')assert.ok(!JSON.stringify(snapshot).includes('Keep this instruction'))
   await h.api('/api/stall/exports/records',undefined,{as:person.cookie,status:403})
   await h.api('/api/stall/portability/exports',{}, {as:person.cookie,status:403})
   await h.api('/api/stall/staff',undefined,{as:person.cookie,status:403})
  }
  const product=(await state(h)).products[0]
  const draft=await h.command('product.prepare',{sku,revision:product.revision,name:'Serving bowl',unitCents:3000,description:'Stoneware',active:true},{as:people.catalog.cookie})
  await h.command('product.approve',{sku,revision:draft.revision},{as:people.catalog.cookie})
  await h.command('product.prepare',{sku,revision:(await state(h)).products[0].revision,name:'Forbidden',unitCents:1,active:true},{as:people.marketing.cookie,status:403})
  await h.command('order.note.add',{orderId:current.id,revision:current.revision,text:'Packing reviewed'},{as:people.fulfillment.cookie})
  current=await order(h,current.id)
  await h.command('order.tag.add',{orderId:current.id,revision:current.revision,tag:'support reviewed'},{as:people.customer_support.cookie})
  current=await order(h,current.id)
  await h.command('order.manual',{}, {as:people.customer_support.cookie,status:403})
  await h.command('shipment.prepare',{orderId:current.id,revision:current.revision,reference:'synthetic-stall-530'},{as:people.finance.cookie,status:403})
  const shipment=await h.command('shipment.prepare',{orderId:current.id,revision:current.revision,reference:'synthetic-stall-530'},{as:people.fulfillment.cookie})
  await h.command('staff.configure',{actorId:people.fulfillment.id,staffRole:'marketing',refundLimitCents:0})
  await h.command('shipment.approve',{orderId:current.id,revision:shipment.revision},{as:people.fulfillment.cookie,status:403})
  await h.api('/api/stall/orders',undefined,{as:people.fulfillment.cookie,status:403})
  current=await h.command('shipment.approve',{orderId:current.id,revision:shipment.revision})
  const refund=await h.command('refund.prepare',{orderId:current.id,revision:current.revision,kind:'goodwill',amountCents:1000,reason:'Service adjustment'},{as:people.finance.cookie})
  assert.equal((await h.command('refund.approve',{orderId:current.id,revision:refund.revision},{as:people.finance.cookie,status:403})).error.code,'SEPARATE_APPROVAL')
  assert.equal(edge.refunds.size,0)
  await h.command('staff.configure',{actorId:people.finance.id,staffRole:['finance','catalog']},{status:400})
  await h.command('staff.configure',{actorId:people.finance.id,staffRole:'finance',separateApproval:false})
  assert.equal((await h.command('refund.approve',{orderId:current.id,revision:refund.revision},{as:people.finance.cookie,status:403})).error.code,'REFUND_LIMIT')
  assert.equal(edge.refunds.size,0)
  await h.command('staff.configure',{actorId:people.finance.id,staffRole:'finance',refundLimitCents:500,separateApproval:false})
  await h.command('refund.approve',{orderId:current.id,revision:refund.revision},{as:people.finance.cookie,status:403})
  await h.command('staff.configure',{actorId:people.finance.id,staffRole:'finance',refundLimitCents:1500,separateApproval:false})
  const approved=await h.command('refund.approve',{orderId:current.id,revision:refund.revision},{as:people.finance.cookie})
  assert.equal(approved.refunds.at(-1).status,'succeeded');assert.equal(approved.notes,undefined);assert.equal(edge.refunds.size,1)
  const recorded=await h.command('order.manual',{idempotencyKey:randomUUID(),customerEmail:'synthetic-stall-541@example.test',name:'Sam Flores',address:{line1:'12 Cedar Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'},lines:[{sku,quantity:1}],expectedTotalCents:3000,method:'cash',receivedOn:'2026-10-21',amountCents:3000,reference:'synthetic-stall-542'},{as:people.finance.cookie})
  assert.equal(recorded.status,'reserved');assert.equal(recorded.payment.source,'staff');assert.equal(recorded.payment.intentId,undefined);assert.equal(recorded.manualPayment.reference,undefined)
  await h.command('search.synonyms',{groups:[]},{as:people.marketing.cookie})
  await h.command('shop.configure',{timeZone:'America/Chicago'},{as:people.administrator.cookie})
  const csv='Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\nsynthetic-stall-540,Serving plate,Stoneware,synthetic-stall-540,18.00,FALSE\n'
  const preview=await h.api('/api/stall/imports/preview',{csv},{as:people.catalog.cookie})
  const imported=await h.api('/api/stall/imports/apply',{csv,fingerprint:preview.fingerprint},{as:people.catalog.cookie});assert.equal(imported.state,'completed')
  await h.api('/api/stall/imports/'+imported.id,undefined,{as:people.customer_support.cookie,status:403})
  await h.api('/api/stall/imports/'+imported.id+'/undo',{}, {as:people.catalog.cookie})
  const preparedBulk=await h.api('/api/stall/imports/preview',{csv},{as:people.catalog.cookie})
  await h.command('staff.configure',{actorId:people.catalog.id,staffRole:null})
  await h.api('/api/stall/imports/apply',{csv,fingerprint:preparedBulk.fingerprint},{as:people.catalog.cookie,status:403})
  await h.api('/api/stall/state',undefined,{as:people.catalog.cookie,status:403})
  const customer=await h.signIn('synthetic-stall-520@example.test'),other=await h.signIn('synthetic-stall-521@example.test')
  const owned=await h.api('/api/stall/customer/orders',undefined,{as:customer})
  assert.deepEqual(owned.orders.map(o=>o.id),[current.id]);assert.ok(!JSON.stringify(owned).includes('instruction'))
  assert.deepEqual((await h.api('/api/stall/customer/orders',undefined,{as:other})).orders,[])
  await h.api('/api/stall/orders?customer=synthetic',undefined,{as:customer,status:403})
 } finally { await h.close();await pier.close() }
})

test('headless storefront scopes bind independent customers, one purchase and signed filtered event replay',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex'),deliveries=[]
 let revokeDuringStock
 const h=await installation({bindings:{...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-701',STRIPE_WEBHOOK_SECRET:secret},outboundService:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]})
  if(url.hostname==='hooks.synthetic-stall-702.com'){deliveries.push({body:await request.text(),headers:Object.fromEntries(request.headers)});return new Response(null,{status:204})}
  if(url.origin===pier.origin&&request.method==='GET'&&revokeDuringStock){const revoke=revokeDuringStock;revokeDuringStock=undefined;await revoke()}
  return edge.handle(request)
 }})
 try {
  const base='/api/stall/v1',origin='https://shop.synthetic-stall-703.com'
  const customer=await h.signIn('synthetic-stall-704@example.test'),foreign=await h.signIn('synthetic-stall-705@example.test')
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450)
  await h.api(base+'/admin/apps',{label:'Forbidden',origin,scopes:['catalog:read']},{as:customer,status:403})
  const app=await h.api(base+'/admin/apps',{label:'Custom storefront',origin,scopes:['catalog:read','cart:write','checkout:write','customer:read','orders:read']})
  const limited=await h.api(base+'/admin/apps',{label:'Public catalog',origin,scopes:['catalog:read']})
  const headers={authorization:`Bearer ${app.token}`,origin}
  const call=(path,body,opts={})=>h.api(base+path,body,{as:customer,headers,...opts})
  await h.api(base+'/catalog',undefined,{as:'',headers})
  await h.api(base+'/customer',undefined,{as:'',headers,status:401})
  await h.api(base+'/orders',undefined,{as:customer,headers:{authorization:`Bearer ${limited.token}`,origin},status:403})
  await h.api(base+'/catalog',undefined,{as:'',headers:{...headers,origin:'https://foreign.synthetic-stall-706.com'},status:403})
  await h.api('/api/stall/state',undefined,{as:'',headers,status:401})
  const key=randomUUID(),cart=await call('/carts',{lines:[{sku:'MUG-BLUE',quantity:1}]},{headers:{...headers,'idempotency-key':key}})
  assert.equal((await call('/carts',{lines:[{sku:'MUG-BLUE',quantity:1}]},{headers:{...headers,'idempotency-key':key}})).id,cart.id)
  await call('/carts/'+cart.id,undefined,{as:foreign,status:404})
  await call('/carts/'+cart.id,{revision:'synthetic-stall-707',lines:[{sku:'MUG-BLUE',quantity:2}]},{method:'PUT',status:409})
  const quoted=await call('/carts/'+cart.id+'/quote',{postalCode:'78702'})
  assert.ok(quoted.services.length)
  const checkoutKey=randomUUID(),input={cartId:cart.id,expectedTotalCents:2450}
  const bought=await call('/checkout',input,{headers:{...headers,'idempotency-key':checkoutKey}})
  assert.equal((await call('/checkout',input,{headers:{...headers,'idempotency-key':checkoutKey}})).orderId,bought.orderId)
  await call('/checkout',input,{headers:{...headers,'idempotency-key':randomUUID()},status:409})
  assert.equal(edge.sessions.size,1)
  const consent='Send minimal Stall event identifiers to this endpoint'
  await h.api(base+'/admin/subscriptions',{appId:app.id,endpoint:'https://127.0.0.1/events',kinds:['order'],consent},{status:400})
  const sub=await h.api(base+'/admin/subscriptions',{appId:app.id,endpoint:'https://hooks.synthetic-stall-702.com/events',kinds:['order'],consent})
  const paid=edge.pay([...edge.sessions.keys()][0]),first=await deliverWebhook(h,secret,paid)
  assert.equal(first.response.status,200)
  assert.equal((await deliverWebhook(h,secret,paid,{id:first.id})).response.status,200)
  assert.equal((await deliverWebhook(h,secret,{...paid,payment_status:'unpaid'})).response.status,200)
  const own=await call('/orders/'+bought.orderId)
  assert.equal(own.status,'reserved');assert.equal(own.totalCents,2450)
  for(const forbidden of ['requestDigest','checkoutKey','notes','tags','intentId','customerEmail'])assert.ok(!(forbidden in own))
  assert.deepEqual((await call('/orders')).orders.map(o=>o.id),[bought.orderId])
  await call('/orders/'+bought.orderId,undefined,{as:foreign,status:404})
  await call('/checkout/confirm',{orderId:bought.orderId})
  assert.equal((await pier.api('/api/pier/state')).orders.length,1)
  const history=await h.api(base+'/admin/deliveries?subscriptionId='+sub.id)
  assert.ok(history.deliveries.length);assert.ok(history.deliveries.every(d=>d.kind==='order'))
  const pending=history.deliveries[0]
  const sent=await h.api(base+'/admin/deliveries/'+pending.id+'/send',{})
  assert.equal(sent.status,'delivered')
  const received=deliveries[0],signature=received.headers['stall-signature'],stamp=signature.match(/t=(\d+)/)[1],mac=signature.match(/v1=([a-f0-9]+)/)[1]
  const expected=body=>createHmac('sha256',sub.signingSecret).update(stamp+'.'+body).digest('hex')
  assert.equal(mac,expected(received.body));assert.notEqual(mac,expected(received.body+' '))
  for(const value of [secret,app.token,sub.signingSecret,'synthetic-stall-704@example.test','notes','tags'])assert.ok(!received.body.includes(value))
  const replay=await h.api(base+'/admin/deliveries/'+pending.id+'/replay',{})
  assert.equal(replay.eventId,sent.eventId);assert.equal(deliveries.length,2);assert.equal(deliveries[1].body,received.body)
  assert.equal((await pier.api('/api/pier/state')).orders.length,1);assert.equal(edge.sessions.size,1)
  const signals=await h.api(base+'/admin/subscriptions',{appId:app.id,endpoint:'https://hooks.synthetic-stall-702.com/signals',kinds:['stock','return','customer'],consent})
  await call('/catalog')
  const stockCount=(await h.api(base+'/admin/deliveries?subscriptionId='+signals.id+'&kind=stock')).deliveries.length
  assert.ok(stockCount)
  await call('/catalog');assert.equal((await h.api(base+'/admin/deliveries?subscriptionId='+signals.id+'&kind=stock')).deliveries.length,stockCount)
  await h.api('/api/stall/customer-requests',{orderId:bought.orderId,kind:'return'},{as:customer})
  await h.api('/api/stall/customer-requests',{orderId:bought.orderId,kind:'return'},{as:customer})
  assert.equal((await h.api(base+'/admin/deliveries?subscriptionId='+signals.id+'&kind=return')).deliveries.length,1)
  const third=await h.signIn('synthetic-stall-709@example.test');await call('/customer',undefined,{as:third})
  assert.equal((await h.api(base+'/admin/deliveries?subscriptionId='+signals.id+'&kind=customer')).deliveries.length,1)
  const prepared=await call('/carts',{lines:[{sku:'MUG-BLUE',quantity:1}]},{headers:{...headers,'idempotency-key':randomUUID()}})
  await h.api(base+'/admin/apps/'+app.id+'/revoke',{})
  await call('/checkout',{cartId:prepared.id,expectedTotalCents:2450},{headers:{...headers,'idempotency-key':randomUUID()},status:401})
  await call('/orders',undefined,{status:401})
  assert.equal(edge.sessions.size,1)
  await h.api(base+'/admin/deliveries/'+pending.id+'/replay',{},{status:403})
  const raced=await h.api(base+'/admin/apps',{label:'Revocation during pricing',origin,scopes:['cart:write','checkout:write']})
  const racedHeaders={origin,authorization:`Bearer ${raced.token}`}
  const racedCart=await h.api(base+'/carts',{lines:[{sku:'MUG-BLUE',quantity:1}]},{as:customer,headers:{...racedHeaders,'idempotency-key':randomUUID()}})
  revokeDuringStock=()=>h.api(base+'/admin/apps/'+raced.id+'/revoke',{})
  await h.api(base+'/checkout',{cartId:racedCart.id,expectedTotalCents:2450},{as:customer,headers:{...racedHeaders,'idempotency-key':randomUUID()},status:409})
  assert.equal(revokeDuringStock,undefined);assert.equal(edge.sessions.size,1)
  const stored=JSON.stringify(await h.api(base+'/admin/apps'))
  assert.ok(!stored.includes(app.token));assert.ok(!stored.includes(sub.signingSecret))
 } finally {await h.close();await pier.close()}
})

test('native carts retain guest and account custody, exact checkout review and required field snapshots across retry',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward}),secret=randomBytes(32).toString('hex')
 const bindings={...pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-1101',STRIPE_WEBHOOK_SECRET:secret},h=await installation({bindings,outboundService:edge.handle})
 let destination
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);await publish(h,'TOWEL-NAT','Natural linen towel',1800)
  const address='synthetic-stall-1102@example.test',alice=await h.signIn(address),bob=await h.signIn('synthetic-stall-1103@example.test')
  let definition=await h.api('/api/stall/checkout-fields')
  await h.api('/api/stall/checkout-fields',{revision:definition.revision,fields:[{key:'discovery',label:'How did you hear about us?',type:'choice',required:true,choices:['Friend','Search']},{key:'date',label:'Preferred date',type:'date',required:false},{key:'wrap',label:'Gift wrap',type:'text',required:false}]},{as:alice,status:403})
  definition=await h.api('/api/stall/checkout-fields',{revision:definition.revision,fields:[{key:'discovery',label:'How did you hear about us?',type:'choice',required:true,choices:['Friend','Search']},{key:'date',label:'Preferred date',type:'date',required:false},{key:'wrap',label:'Gift wrap',type:'text',required:false}]})
  const opened=await h.request('/api/stall/cart',{as:''}),cookie=opened.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.equal((await opened.json()).cart,null)
  const shopper={address:{name:'synthetic-stall-1104',line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'},note:'synthetic-stall-1105 order note',giftMessage:'synthetic-stall-1106 gift message',giftReceipt:true}
  let cart=(await h.api('/api/stall/cart',{customerEmail:address,lines:[{sku:'MUG-BLUE',quantity:1},{sku:'TOWEL-NAT',quantity:2}],shopper},{as:cookie})).cart
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:cookie})).cart,cart,'a refresh retains the guest basket')
  await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:'',status:404})
  const before=structuredClone(cart)
  await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:cookie,status:400})
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:cookie})).cart,before,'missing required fields preserve the basket')
  await h.api('/api/stall/checkout',{customerEmail:address,lines:cart.value.lines,idempotencyKey:randomUUID()},{as:'',status:400})
  assert.equal(edge.sessions.size,0,'the older public checkout cannot bypass a required native field')
  cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,shopper:{...shopper,answers:{discovery:'Friend',date:'2026-12-01',wrap:'Paper'}}},{as:cookie})).cart
  const signed=alice+'; '+cookie
  assert.equal((await h.api('/api/stall/cart',undefined,{as:signed})).cart,null,'sign-in alone does not silently claim a guest capability')
  await h.api('/api/stall/cart/claim',{cartId:cart.id,revision:cart.revision,confirm:true},{as:bob+'; '+cookie,status:403})
  cart=(await h.api('/api/stall/cart/claim',{cartId:cart.id,revision:cart.revision,confirm:true},{as:signed})).cart
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice})).cart,cart)
  assert.equal((await h.api('/api/stall/cart',undefined,{as:cookie})).cart,null,'the guest cookie loses custody after explicit verified handoff')
  await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:bob,status:404})
  await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,customerEmail:'synthetic-stall-1103@example.test'},{as:alice,status:403})
  await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice,headers:{origin:'https://synthetic-stall-1107.test'},status:403})
  let review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice})
  assert.deepEqual([review.review.subtotalCents,review.review.discountCents,review.review.shippingCents,review.review.payableCents],[6050,0,0,6050]);assert.equal(review.review.taxStatus,'no_tax_recorded');assert.equal(review.review.giftCardsStatus,'not_available')
  let mug=(await h.api('/api/stall/state')).products.find(p=>p.id==='MUG-BLUE')
  mug=await h.command('product.prepare',{sku:mug.id,revision:mug.revision,name:mug.value.name,description:mug.value.description,unitCents:2500,active:true});await h.command('product.approve',{sku:mug.id,revision:mug.revision})
  await h.api('/api/stall/cart/checkout',{cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken},{as:alice,status:409})
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice})).cart,cart,'material price changes neither spend nor destroy the basket')
  const ca={...cart.value.shopper,address:{...shopper.address,city:'Vancouver',state:'BC',postal_code:'V6B 1A1',country:'CA'}}
  cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,shopper:ca},{as:alice})).cart
  await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice,status:400});assert.equal((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice})).cart.value.shopper.address.country,'CA')
  cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,shopper:{...cart.value.shopper,address:shopper.address}},{as:alice})).cart
  const towel=(await h.api('/api/stall/state')).products.find(p=>p.id==='TOWEL-NAT')
  let changed=await h.command('product.prepare',{sku:towel.id,revision:towel.revision,...towel.value,active:false});changed=await h.command('product.approve',{sku:towel.id,revision:changed.revision})
  await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice,status:409})
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice})).cart,cart,'unpublished stock leaves the basket intact')
  changed=await h.command('product.prepare',{sku:towel.id,revision:changed.revision,name:towel.value.name,description:towel.value.description,unitCents:towel.value.unitCents,active:true});await h.command('product.approve',{sku:towel.id,revision:changed.revision})
  review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice});assert.equal(review.review.payableCents,6100)
  edge.loseNextCheckoutResponse()
  const intent={cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken}
  await h.api('/api/stall/cart/checkout',intent,{as:alice,status:503});assert.equal(edge.sessions.size,1)
  mug=(await h.api('/api/stall/state')).products.find(p=>p.id==='MUG-BLUE')
  mug=await h.command('product.prepare',{sku:mug.id,revision:mug.revision,name:mug.value.name,description:mug.value.description,unitCents:2550,active:true});await h.command('product.approve',{sku:mug.id,revision:mug.revision})
  const bought=await h.api('/api/stall/cart/checkout',intent,{as:alice});assert.equal(edge.sessions.size,1,'retry after a lost Stripe response recovers the original reviewed checkout despite later catalog changes')
  assert.equal((await h.api('/api/stall/cart/checkout',intent,{as:alice})).orderId,bought.orderId)
  const session=[...edge.sessions.values()][0];assert.equal(session.amount_total,6100)
  await deliverWebhook(h,secret,edge.pay(session.id))
  const order=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId)
  assert.equal(order.shopper.note,shopper.note);assert.equal(order.shopper.giftMessage,shopper.giftMessage);assert.equal(order.shopper.giftReceipt,true);assert.equal(order.shopper.answers.discovery,'Friend')
  assert.equal((await h.api('/api/stall/exports/records')).orders.find(o=>o.id===order.id).shopper.answers.discovery,'Friend')
  const report=await h.api('/api/stall/checkout-fields/report?field=discovery');assert.deepEqual(report.groups.map(g=>[g.answer,g.orderCount,g.paidCents]),[['Friend',1,6100]])
  await h.api('/api/stall/checkout-fields/report?field=discovery',undefined,{as:alice,status:403})
  await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value},{as:alice,status:409})
  const guestCart=(await h.api('/api/stall/cart',{customerEmail:'synthetic-stall-1108@example.test',lines:[{sku:'MUG-BLUE',quantity:1}],shopper:{...shopper,answers:{discovery:'Search'}}},{as:cookie})).cart
  const guestReview=await h.api('/api/stall/cart/review',{cartId:guestCart.id,revision:guestCart.revision},{as:cookie})
  const guestBought=await h.api('/api/stall/cart/checkout',{cartId:guestCart.id,revision:guestCart.revision,reviewToken:guestReview.reviewToken},{as:cookie})
  assert.notEqual(guestBought.orderId,bought.orderId);assert.equal((await h.api('/api/stall/account',undefined,{as:alice})).orders.length,1)
  const guestAccount=await h.signIn('synthetic-stall-1108@example.test')
  await h.api('/api/stall/account/guest-order-link',{orderId:guestBought.orderId},{as:guestAccount,status:409})
  const orderLink=await h.api('/api/stall/account/guest-order-link',{orderId:bought.orderId},{as:alice})
  assert.equal((await h.api('/api/stall/guest-order',undefined,{as:'',headers:{'x-stall-order-token':orderLink.token}})).order.id,bought.orderId)
  const exported=await h.api('/api/stall/exports/records'),saved=await archive(h)
  assert.ok(!JSON.stringify(saved).includes(cookie.split('=')[1]),'a guest cart capability never travels')
  assert.equal(JSON.stringify(exported).includes(orderLink.token),false)
  assert.equal(JSON.stringify(saved).includes(orderLink.token),false)
  destination=await installation({bindings,outboundService:edge.handle});await restore(destination,saved)
  assert.deepEqual((await destination.api('/api/stall/exports/records')).nativeCart,exported.nativeCart)
  await destination.api('/api/stall/cart?cartId='+guestCart.id,undefined,{as:cookie,status:404})
  await destination.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice,status:404})
  const reverified=await destination.signIn(address)
  assert.equal((await destination.api('/api/stall/cart?cartId='+cart.id,undefined,{as:reverified})).cart.locked,true)
  await destination.api('/api/stall/cart/checkout',intent,{as:reverified,status:409})
  assert.equal(edge.sessions.size,2,'restored cart history grants no spending or replay authority')
  let shipped=(await h.api('/api/stall/state')).orders.find(o=>o.id===bought.orderId)
  shipped=await h.command('shipment.prepare',{orderId:shipped.id,revision:shipped.revision,reference:'synthetic-stall-1109'});await h.command('shipment.approve',{orderId:shipped.id,revision:shipped.revision})
  assert.equal((await h.api('/api/stall/guest-order',undefined,{as:'',headers:{'x-stall-order-token':orderLink.token}})).order.status,'shipped','ordinary fulfillment does not invalidate an order link')
  await h.command('customer.erase',{email:address,confirm:'ERASE'})
  await h.api('/api/stall/guest-order',undefined,{as:'',headers:{'x-stall-order-token':orderLink.token},status:404})
  await h.api('/api/stall/cart/reorder',{orderId:bought.orderId,guestToken:orderLink.token},{as:'',status:404})
  assert.equal((await h.api('/api/stall/cart',undefined,{as:alice})).cart,null)
  const erased=await h.api('/api/stall/exports/records')
  assert.equal(erased.orders.find(o=>o.id===bought.orderId).shopper,undefined)
  assert.ok(!JSON.stringify(await archive(h)).includes(address))
 } finally {await destination?.close();await h.close();await pier.close()}
})

test('verified account reorder names current price and stock changes without spending before a new checkout',async()=>{
 const skus=['synthetic-stall-1201','synthetic-stall-1202','synthetic-stall-1203'],stock=volumeStock([...skus,'synthetic-stall-1212']),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex')
 const bindings={PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-1204',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-1205',STRIPE_WEBHOOK_SECRET:secret,SESSION_SECRET:randomBytes(32).toString('hex')}
 const h=await installation({bindings,outboundService:edge.handle});let destination
 try {
  let details={options:[{name:'Size',values:['S','M','L']}],variants:skus.map((sku,i)=>({sku,options:{Size:['S','M','L'][i]},unitCents:[1000,2000,3000][i]})),personalization:[{key:'name',label:'Name',type:'text',maxLength:20,addOnCents:200}]}
  let product
  const save=async()=>{product=await h.command('product.prepare',{sku:'synthetic-stall-1200',...(product?{revision:product.revision}:{}),name:'Personalized linen',description:'Reorder fixture',unitCents:1000,active:true,details});product=await h.command('product.approve',{sku:product.id,revision:product.revision})}
  await save()
  const email='synthetic-stall-1206@example.test',alice=await h.signIn(email),bob=await h.signIn('synthetic-stall-1207@example.test')
  const lines=[{sku:skus[0],quantity:2,personalization:{name:'Mira'}},{sku:skus[1],quantity:1},{sku:skus[2],quantity:1}]
  const first=await h.api('/api/stall/checkout',{customerEmail:email,lines,idempotencyKey:randomUUID(),expectedTotalCents:7400},{as:''})
  const session=[...edge.sessions.values()][0];await deliverWebhook(h,secret,edge.pay(session.id))
  const second=await purchase(h,edge,{skus:[skus[2]],email});await deliverWebhook(h,secret,edge.pay(second.session.id))
  const history=(await h.api('/api/stall/account',undefined,{as:alice})).orders
  assert.deepEqual(new Set(history.map(o=>o.id)),new Set([first.orderId,second.orderId]))
  assert.ok(history[0].createdAt>=history[1].createdAt)
  assert.ok(history.every(o=>o.status==='reserved'&&Number.isSafeInteger(o.totalCents)))
  assert.deepEqual(history.find(o=>o.id===first.orderId).lines.map(l=>[l.sku,l.quantity]),lines.map(l=>[l.sku,l.quantity]))
  const original=structuredClone(await order(h,first.orderId)),beforeCarts=(await h.api('/api/stall/exports/records')).nativeCart.carts.length
  const base='/api/stall/cart/reorder',body={orderId:first.orderId}
  await h.api(base,body,{as:'',status:401});await h.api(base,body,{as:bob,status:404})
  await h.api(base,body,{as:alice,headers:{origin:'https://synthetic-stall-1208.test'},status:403})
  const grant=await h.api('/api/stall/agent-token',{})
  await h.api(base,body,{as:alice,headers:{authorization:'Bearer '+grant.token},status:401})
  await h.api(base,{...body,customerEmail:email},{as:alice,status:400})
  assert.equal((await h.api('/api/stall/exports/records')).nativeCart.carts.length,beforeCarts)
  const existing=(await h.api('/api/stall/cart',{lines:[{sku:skus[2],quantity:2}]},{as:alice})).cart
  details={...details,variants:details.variants.map((v,i)=>({...v,...(i===0?{unitCents:1500}:{})}))};await save();stock.setAvailable(skus[1],'0')
  const effects=[edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await state(h)).orders.length]
  const result=await h.api(base,body,{as:alice}),cart=result.cart
  assert.equal(result.requiresCheckoutReview,true);assert.equal(cart.locked,false);assert.equal(cart.orderId,null)
  assert.deepEqual(cart.value.lines,[lines[0],lines[2]])
  assert.deepEqual(result.priceChanges,[{sku:skus[0],previousUnitCents:1200,currentUnitCents:1700}])
  assert.equal(result.omissions[0].sku,skus[1]);assert.match(result.omissions[0].reason,/stock/)
  assert.equal(cart.value.shopper.address.postal_code,'78702');assert.equal(cart.value.shopper.address.country,'US')
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice})).cart,cart,'reorder explanation survives refresh')
  assert.deepEqual((await h.api('/api/stall/cart?cartId='+existing.id,undefined,{as:alice})).cart,existing,'a reorder does not overwrite another basket')
  assert.deepEqual([edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await state(h)).orders.length],effects,'reorder creates no payment, hold, reservation or order')
  await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:bob,status:404})
  await h.api('/api/stall/cart/checkout',{cartId:cart.id,revision:cart.revision,reviewToken:'synthetic-stall-1209'},{as:alice,status:409})
  const review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:alice});assert.equal(review.review.payableCents,6400)
  const bought=await h.api('/api/stall/cart/checkout',{cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken},{as:alice})
  const newSession=[...edge.sessions.values()].find(s=>s.client_reference_id===bought.orderId)
  assert.notEqual(bought.orderId,first.orderId);assert.notEqual(newSession.id,session.id)
  await deliverWebhook(h,secret,edge.pay(newSession.id));assert.equal((await order(h,bought.orderId)).totalCents,6400)
  assert.deepEqual(await order(h,first.orderId),original,'new checkout never rewrites the historical order')
  const linkDoor='/api/stall/account/guest-order-link',guestDoor='/api/stall/guest-order'
  await h.api(linkDoor,body,{as:'',status:401});await h.api(linkDoor,body,{as:bob,status:404})
  await h.api(linkDoor,{...body,customerEmail:email},{as:alice,status:400})
  await h.api(linkDoor,body,{as:alice,headers:{origin:'https://synthetic-stall-1210.test'},status:403})
  await h.api(linkDoor,body,{as:alice,headers:{authorization:'Bearer '+grant.token},status:401})
  const guestRead=token=>h.api(guestDoor,undefined,{as:'',headers:{'x-stall-order-token':token}})
  const guestRejected=token=>h.api(guestDoor,undefined,{as:'',headers:{'x-stall-order-token':token},status:404})
  const link=await h.api(linkDoor,body,{as:alice})
  const receipt=await guestRead(link.token)
  assert.equal(receipt.order.id,first.orderId);assert.equal(receipt.order.totalCents,7400)
  assert.equal('customerEmail' in receipt.order,false);assert.equal('payment' in receipt.order,false)
  await h.api(guestDoor,undefined,{as:'',status:404})
  await h.api(guestDoor+'?token='+link.token,undefined,{as:'',status:404})
  await guestRejected(link.token.slice(0,-1)+(link.token.endsWith('0')?'1':'0'))
  await h.api(base,{orderId:second.orderId,guestToken:link.token},{as:'',status:404})
  await h.api(base,{...body,guestToken:link.token},{as:'',headers:{origin:'https://synthetic-stall-1210.test'},status:403})
  const guestEffects=[edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await state(h)).orders.length]
  const guestResponse=await h.request(base,{method:'POST',as:bob,body:{...body,guestToken:link.token}})
  assert.equal(guestResponse.status,200)
  const guestCookie=guestResponse.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),guest=(await guestResponse.json()).cart
  assert.notEqual(guest.id,cart.id);assert.deepEqual(guest.value.lines,cart.value.lines)
  assert.deepEqual(guest.value.reorder,cart.value.reorder);assert.deepEqual(guest.value.shopper,cart.value.shopper)
  assert.equal(guest.locked,false);assert.equal(guest.orderId,null)
  assert.equal((await h.api('/api/stall/cart?cartId='+guest.id,undefined,{as:guestCookie})).cart.id,guest.id)
  assert.equal((await h.api('/api/stall/cart?cartId='+guest.id,undefined,{as:bob+'; '+guestCookie})).cart.id,guest.id,'only the same browser capability selects the guest cart while signed in')
  await h.api('/api/stall/cart?cartId='+guest.id,undefined,{as:bob,status:404})
  await h.api('/api/stall/cart?cartId='+guest.id,undefined,{as:'',status:404})
  await h.api('/api/stall/cart/checkout',{cartId:guest.id,revision:guest.revision,reviewToken:'synthetic-stall-1211'},{as:guestCookie,status:409})
  assert.deepEqual([edge.sessions.size,edge.pierCalls.length,stock.orders.size,(await state(h)).orders.length],guestEffects)
  const guestReview=await h.api('/api/stall/cart/review',{cartId:guest.id,revision:guest.revision},{as:guestCookie})
  assert.equal(guestReview.review.payableCents,6400)
  await h.api(linkDoor,body,{as:bob,method:'DELETE',status:404})
  await h.api(linkDoor,body,{as:alice,method:'DELETE'})
  await guestRejected(link.token);await h.api(base,{...body,guestToken:link.token},{as:guestCookie,status:404})
  const short=await h.api(linkDoor,{...body,expiresInSeconds:1},{as:alice})
  await new Promise(resolve=>setTimeout(resolve,1100))
  await guestRejected(short.token);await h.api(base,{...body,guestToken:short.token},{as:guestCookie,status:404})
  const restoredLink=await h.api(linkDoor,body,{as:alice})
  const replaced=await h.api(linkDoor,body,{as:alice})
  await guestRejected(restoredLink.token)
  await guestRead(replaced.token)
  // Current personalization and publication changes leave named omissions,
  // never silently copy an invalid old answer or create an unreviewed charge.
  details={...details,personalization:[{...details.personalization[0],maxLength:2}],variants:details.variants.map((v,i)=>({...v,...(i===2?{archived:true}:{})}))};await save()
  const unavailable=await h.api(base,body,{as:alice})
  assert.deepEqual(unavailable.cart.value.lines,[]);assert.equal(unavailable.omissions.length,3)
  assert.match(unavailable.omissions.find(o=>o.sku===skus[0]).reason,/characters/)
  assert.match(unavailable.omissions.find(o=>o.sku===skus[2]).reason,/archived|unpublished/)
  assert.equal(edge.sessions.size,3)
  const fileSku='synthetic-stall-1212'
  let fileProduct=await h.command('product.prepare',{sku:fileSku,name:'Printed linen',description:'Private personalization fixture',unitCents:1000,active:true,details:{personalization:[{key:'art',label:'Artwork',type:'file',required:true,fileTypes:['png'],maxBytes:1000}]}})
  await h.command('product.approve',{sku:fileSku,revision:fileProduct.revision})
  const upload=await sendFile(h,'/api/stall/personalization/upload?sku='+fileSku+'&field=art&name=synthetic-stall-1213.png',png(),'image/png',{as:''})
  assert.equal(upload.status,200)
  const file=await upload.json()
  // Published stock is supplied by the existing external stock boundary.
  stock.setAvailable(fileSku,'10')
  const fileOrder=await h.api('/api/stall/checkout',{customerEmail:email,lines:[{sku:fileSku,quantity:1,personalization:{art:file.fileId}}],idempotencyKey:randomUUID(),expectedTotalCents:1000},{as:''})
  const fileSession=[...edge.sessions.values()].find(s=>s.client_reference_id===fileOrder.orderId)
  await deliverWebhook(h,secret,edge.pay(fileSession.id))
  const fileLink=await h.api(linkDoor,{orderId:fileOrder.orderId},{as:alice})
  assert.equal(JSON.stringify(await guestRead(fileLink.token)).includes(file.fileId),false)
  const fileEffects=[edge.sessions.size,edge.pierCalls.length,stock.orders.size]
  for(const options of [{as:alice,payload:{orderId:fileOrder.orderId}},{as:guestCookie,payload:{orderId:fileOrder.orderId,guestToken:fileLink.token}}]) {
   const refused=await h.api(base,options.payload,{as:options.as})
   assert.deepEqual(refused.cart.value.lines,[])
   assert.match(refused.omissions[0].reason,/Upload.*again/)
   assert.equal(JSON.stringify(refused).includes(file.fileId),false)
  }
  assert.deepEqual([edge.sessions.size,edge.pierCalls.length,stock.orders.size],fileEffects)
  const exported=await archive(h)
  assert.equal(JSON.stringify(exported).includes(replaced.token),false)
  const linkDigest=createHash('sha256').update(bindings.SESSION_SECRET+'\nguest-order\n'+replaced.token).digest('hex')
  assert.equal(JSON.stringify(exported).includes(linkDigest),false,'private link authority is excluded even when restoring with the same installation secret')
  destination=await installation({bindings,outboundService:edge.handle});await restore(destination,exported)
  await destination.api(guestDoor,undefined,{as:'',headers:{'x-stall-order-token':replaced.token},status:404})
  await destination.api(base,{...body,guestToken:replaced.token},{as:'',status:404})
  await destination.api('/api/stall/cart?cartId='+cart.id,undefined,{as:alice,status:404})
  const reverified=await destination.signIn(email)
  const restored=(await destination.api('/api/stall/cart?cartId='+cart.id,undefined,{as:reverified})).cart
  assert.deepEqual(restored.value.reorder,cart.value.reorder);assert.equal(restored.locked,true)
  await destination.command('customer.erase',{email,confirm:'ERASE'},{status:409})
  assert.equal((await destination.api('/api/stall/cart?cartId='+cart.id,undefined,{as:reverified})).cart.id,cart.id,'pending commercial effects retain the existing erasure fence')
 }finally{await destination?.close();await h.close()}
})

test('AI-005: an agent proposes cited merchandising and a human publishes only selected exact changes', async () => {
 const { merchandisingFixture, merchSku, merchVariant } = await import('./merch-proposal-fixture.mjs');
 const stock=volumeStock([merchVariant]); let unavailable=false;
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-903',PIER_CUSTOMER_ID:'shop'},outboundService:request=>unavailable?Response.json({error:{code:'OFFLINE'}},{status:503}):stock.forward(request)});
 try {
  const f=await merchandisingFixture(h), proposal=await h.command('merch.prepare',f.input,f.agent);
  assert.equal(proposal.preparedBy,`agent:${f.grant.id}`);
  assert.equal(proposal.changes.length,8);
  assert.equal(proposal.questions.length,3);
  assert.equal(proposal.unsupported.length,3);
  assert.equal(JSON.stringify(proposal.sources).includes('costCents'),false);
  assert.ok(proposal.sources.some(source=>source.id===`variant:${merchVariant}:Color`&&source.value==='Clay'));
  for(const change of proposal.changes) assert.ok(change.citations.every(id=>proposal.sources.some(source=>source.id===id)));
  assert.equal((await state(h)).products.find(p=>p.id===merchSku).value.name,'Studio mug','preparation has no publication effect');
  const selected=['2','3','4','5','6','7','8'], payload={id:proposal.id,revision:proposal.revision,selected};
  const preview=await h.api('/api/stall/merchandising/preview',payload);
  assert.equal(preview.product.name,'Studio mug');
  assert.equal(preview.feed.connected,false);
  assert.equal(preview.feed.valid,true);
  assert.deepEqual(preview.feed.errors,[]);
  assert.deepEqual(preview.feed.items.map(item=>[item.id,item.price,item.attributes.Color]),[[merchVariant,'26.00 USD','Clay']]);
  assert.equal(preview.feed.items[0].availability,'in_stock');
  assert.equal(preview.feed.items[0].inventoryEvidence.available,'10000');
  stock.setAvailable(merchVariant,'0');
  const soldOut=await h.api('/api/stall/merchandising/preview',payload);
  assert.equal(soldOut.feed.items[0].availability,'out_of_stock','validation reads the stock authority instead of trusting agent requests');
  stock.setAvailable(merchVariant,'10000');
  unavailable=true;
  const refusedFeed=await h.api('/api/stall/merchandising/preview',payload);
  assert.equal(refusedFeed.feed.valid,false);
  assert.ok(refusedFeed.feed.errors.some(error=>error.includes('PIER_OFFLINE')));
  assert.ok(refusedFeed.feed.items.every(item=>!('availability' in item)),'a failed observation does not reuse earlier stock');
  unavailable=false;
  const attempts=await Promise.all([0,1].map(()=>h.request('/api/stall/commands',{method:'POST',body:{type:'merch.approve',payload}})));
  assert.deepEqual(attempts.map(response=>response.status).sort(),[200,409],'one exact approval wins concurrent publication');
  const published=(await attempts.find(response=>response.status===200).json()).result;
  const saved=(await state(h)).products.find(p=>p.id===merchSku);
  assert.deepEqual([saved.value.name,saved.value.description,saved.value.details.attributes[0].value,saved.value.details.seo.title],['Studio mug','Hand-thrown mug · Matte glaze','Matte glaze','Studio mug · Matte glaze']);
  assert.equal(saved.value.details.media[0].alt,'Side view of Studio mug · Studio mug');
  assert.deepEqual((await state(h)).merchandising.collections[0].value.skus,[merchSku]);
  assert.deepEqual(published.selected,selected);
  assert.equal(published.approval.revision,proposal.revision);
  const catalogue=await h.api('/api/stall/catalogue',undefined,{as:''});
  assert.equal(catalogue.products[0].description,preview.product.description);
  assert.equal(catalogue.products[0].media[0].alt,preview.product.details.media[0].alt);
  await h.command('merch.approve',payload,{status:409});
  assert.equal((await state(h)).audit.filter(event=>event.action==='merch.published').length,1);
 } finally { await h.close() }
});

test('AI-005: unsupported claims, stale sources and revoked authority cannot publish merchandising', async () => {
 const { merchandisingFixture, merchSku, merchVariant } = await import('./merch-proposal-fixture.mjs');
 const stock=volumeStock([merchVariant]), h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-904',PIER_CUSTOMER_ID:'shop'},outboundService:stock.forward});
 try {
  const f=await merchandisingFixture(h), p=await h.command('merch.prepare',f.input,f.agent), approval={id:p.id,revision:p.revision,selected:['2']};
  for(const changes of [
   [{field:'description',value:'Certified food-safe with 500 five-star reviews and 100 available',citations:['description']}],
   [{field:'inventory',value:'100',citations:['sku']}],
   [{field:'certification',value:'Certified',citations:['name']}],
   [{field:'reviews',value:'Five stars',citations:['name']}],
   [{field:'alt',target:f.media.id,value:'Studio mug',citations:['name']}],
   [{field:'seoTitle',value:'Unproven fact',citations:['missing']}],
  ]) assert.equal((await h.command('merch.prepare',{...f.input,changes},{...f.agent,status:400})).error.code,'UNSUPPORTED_CLAIM');
  const member=await h.signIn('synthetic-stall-905@example.test');
  for(const opts of [{as:'',status:401},{as:member,status:403},{...f.agent,status:403},{headers:{origin:'https://synthetic-stall-906.test'},status:403}]) await h.command('merch.approve',approval,opts);
  await h.api(`/api/stall/merchandising?sku=${merchSku}`,undefined,{as:'',status:401});
  await h.api(`/api/stall/merchandising?sku=${merchSku}`,undefined,{as:member,status:403});
  await h.command('merch.prepare',f.input,{status:403});
  await h.api('/api/stall/exports/records',undefined,{...f.agent,status:403});
  const admin=await h.signIn('synthetic-stall-907@example.test','admin');
  let revised=await h.command('product.prepare',{...f.product.value,description:'Merchant corrected the description',revision:f.product.revision});
  await h.command('product.approve',{sku:merchSku,revision:revised.revision});
  assert.equal((await h.command('merch.approve',approval,{as:admin,status:409})).error.code,'SOURCE_CHANGED');
  await h.api('/api/stall/merchandising/preview',approval,{status:409});
  const source=await h.api(`/api/stall/merchandising?sku=${merchSku}`,undefined,f.agent);
  const next=await h.command('merch.prepare',{sku:merchSku,revision:source.revision,changes:[{field:'seoTitle',value:'Studio mug',citations:['name']}]},f.agent);
  const collection=(await state(h)).merchandising.collections[0];
  await h.command('collection.save',{...collection.value,title:'New collection title',revision:collection.revision});
  assert.equal((await h.command('merch.approve',{id:next.id,revision:next.revision,selected:['1']},{status:409})).error.code,'SOURCE_CHANGED');
  await h.api('/api/stall/agent-token/revoke',{grantId:f.grant.id});
  await h.api(`/api/stall/merchandising?sku=${merchSku}`,undefined,{...f.agent,status:401});
  await h.command('merch.prepare',f.input,{...f.agent,status:401});
  assert.equal((await state(h)).audit.filter(event=>event.action==='merch.published').length,0);
 } finally { await h.close() }
});

test('merchant checkout links preload native carts, preserve reviewed discounts and channel, and refuse stale sale authority',async()=>{
 const stock=volumeStock(['MUG-BLUE','TOWEL-NAT']),edge=stripeEdge({forward:stock.forward,livemode:true}),secret=randomBytes(32).toString('hex')
 const bindings={PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-3200',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-3201',STRIPE_WEBHOOK_SECRET:secret},h=await installation({bindings,outboundService:edge.handle})
 let destination
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);await publish(h,'TOWEL-NAT','Natural linen towel',1800)
  await h.command('shipping.configure',{shippingCents:625})
  await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-3202',startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),minimumBasketCents:2500,maxUsesPerCustomer:3,maxTotalUses:5,maxShippingDiscountCents:3125})
  const base='/api/stall/buy-links',lines=[{sku:'MUG-BLUE',quantity:2},{sku:'TOWEL-NAT',quantity:1}],payload={label:'Maker gift set',lines,promotionCode:'SYNTHETIC-STALL-3202'},customer=await h.signIn('synthetic-stall-3203@example.test')
  await h.api(base,payload,{as:'',status:401});await h.api(base,payload,{as:customer,status:403})
  await h.api(base,payload,{headers:{origin:'https://synthetic-stall-3204.test'},status:403})
  const agent=await h.api('/api/stall/agent-token',{});await h.api(base,payload,{headers:{authorization:'Bearer '+agent.token},status:403})
  const link=await h.api(base,payload),path=base+'/'+link.id
  assert.equal(link.url,h.origin+'/shop?buy='+link.id)
  const preview=await h.api(path,undefined,{as:''})
  assert.deepEqual(preview,{id:link.id,label:'Maker gift set',lines:[{sku:'MUG-BLUE',name:'Blue ceramic mug',quantity:2,unitCents:2450},{sku:'TOWEL-NAT',name:'Natural linen towel',quantity:1,unitCents:1800}],promotionCode:'SYNTHETIC-STALL-3202'})
  assert.ok(!JSON.stringify(link).includes('synthetic-stall-3201'))
  assert.equal((await h.api('/api/stall/state')).orders.length,0,'preview never spends or creates an order')
  await h.api(path+'/cart',{},{as:'',headers:{origin:'https://synthetic-stall-3204.test'},status:403})
  const start=await h.request(path+'/cart',{method:'POST',as:'',body:{}}),cookie=start.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.equal(start.status,200)
  let cart=(await start.json()).cart
  assert.deepEqual(cart.value.lines,lines);assert.equal(cart.value.promotionCode,payload.promotionCode)
  await h.api('/api/stall/cart?cartId='+cart.id,undefined,{as:customer,status:404})
  await h.api('/api/stall/cart',{...cart.value},{as:cookie,status:400})
  const shopper={address:{name:'synthetic-stall-3205',line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'}}
  cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,customerEmail:'synthetic-stall-3206@example.test',shopper},{as:cookie})).cart
  const review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:cookie})
  assert.deepEqual([review.review.subtotalCents,review.review.discountCents,review.review.shippingCents,review.review.totalCents],[6700,625,625,6700])
  const intent={cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken}
  edge.loseNextCheckoutResponse();await h.api('/api/stall/cart/checkout',intent,{as:cookie,status:503})
  const bought=await h.api('/api/stall/cart/checkout',intent,{as:cookie})
  assert.equal((await h.api('/api/stall/cart/checkout',intent,{as:cookie})).orderId,bought.orderId);assert.equal(edge.sessions.size,1)
  const session=[...edge.sessions.values()][0];assert.equal(session.amount_total,6700)
  await deliverWebhook(h,secret,edge.pay(session.id));await deliverWebhook(h,secret,edge.pay(session.id))
  const attributed=await h.api('/api/stall/orders?channel=checkout_link')
  assert.deepEqual(attributed.orders.map(o=>o.id),[bought.orderId]);assert.equal(attributed.orders[0].channel,'checkout_link');assert.equal(attributed.orders[0].status,'reserved')
  assert.equal((await h.api('/api/stall/orders?channel=online')).total,0)
  const native=[...stock.orders.values()]
  assert.equal(native.length,1);assert.deepEqual(native[0].lines.map(l=>[l.quantity,l.reserved]),[['2','2'],['1','1']])
  const exported=await h.api('/api/stall/exports/records');assert.deepEqual(exported.buyLinks[0].value,payload);assert.equal(exported.orders.find(o=>o.id===bought.orderId).channel,'checkout_link')
  const saved=await archive(h);destination=await installation({bindings,outboundService:edge.handle});await restore(destination,saved)
  await destination.api(path,undefined,{as:'',status:404});assert.equal(edge.sessions.size,1,'restored public links grant no fresh sale authority')
  const waiting=await h.api(path+'/cart',{},{as:cookie})
  await h.api(path+'/revoke',{revision:link.revision},{as:customer,status:403})
  await h.api(path+'/revoke',{revision:'synthetic-stall-3209'},{status:409});assert.equal((await h.api(path,undefined,{as:''})).id,link.id)
  await h.api(path+'/revoke',{revision:link.revision})
  await h.api(path,undefined,{as:'',status:404});await h.api(path+'/cart',{},{as:cookie,status:404})
  await h.api('/api/stall/cart/review',{cartId:waiting.cart.id,revision:waiting.cart.revision},{as:cookie,status:404})
  const sold=await h.api(base,{label:'Sold out towel',lines:[{sku:'TOWEL-NAT',quantity:1}]})
  stock.setAvailable('TOWEL-NAT','0')
  await h.api(base+'/'+sold.id,undefined,{as:'',status:409});await h.api(base+'/'+sold.id+'/cart',{},{as:cookie,status:409})
  const unavailable=await h.api(base,{label:'Current mug',lines:[{sku:'MUG-BLUE',quantity:1}]})
  let mug=(await h.api('/api/stall/state')).products.find(p=>p.id==='MUG-BLUE')
  mug=await h.command('product.prepare',{sku:mug.id,revision:mug.revision,name:mug.value.name,description:mug.value.description,unitCents:mug.value.unitCents,active:false});await h.command('product.approve',{sku:mug.id,revision:mug.revision})
  await h.api(base+'/'+unavailable.id,undefined,{as:'',status:409});await h.api(base+'/'+unavailable.id+'/cart',{},{as:cookie,status:409})
 }finally{await destination?.close();await h.close()}
})

test('Buy Button, product card and collection embeds restrict exact origins and recheck native stock and publication',async()=>{
 const stock=volumeStock(['TEE-S','TEE-M','HAT-1']),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-3220',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-3221',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle})
 try {
  let tee=await h.command('product.prepare',{sku:'TEE',name:'Linen tee',description:'A linen tee',unitCents:2500,active:true,details:{handle:'linen-tee',options:[{name:'Size',values:['S','M']}],variants:[{sku:'TEE-S',options:{Size:'S'},unitCents:2500},{sku:'TEE-M',options:{Size:'M'},unitCents:2700}]}})
  await h.command('product.approve',{sku:'TEE',revision:tee.revision});await publish(h,'HAT-1','Wool hat',1800)
  await h.command('collection.save',{handle:'gifts',title:'Gifts',description:'Maker gifts',kind:'manual',skus:['TEE','HAT-1']})
  const base='/api/stall/buy-links',origin='https://allowed.synthetic-stall-3222.test',allowedOrigins=[origin],widgets=[]
  for(const [kind,selection] of [['buy_button',{lines:[{sku:'TEE-S',quantity:2}]}],['product_card',{productSku:'TEE'}],['collection',{collection:'gifts'}]]) {
   await h.api(base,{kind,label:'Maker gifts',...selection,allowedOrigins:[]},{status:400})
   await h.api(base,{kind,label:'Maker gifts',...selection,allowedOrigins:[origin+'/path']},{status:400})
   const widget=await h.api(base,{kind,label:'Maker gifts',...selection,allowedOrigins});widgets.push(widget)
   assert.equal(widget.embed,`<script src="${h.origin}${base}/${widget.id}.js" defer></script>`)
   const script=await h.request(base+'/'+widget.id+'.js',{as:''});assert.match(script.headers.get('content-type'),/javascript/);const code=await script.text()
   assert.ok(code.includes("credentials:'omit'"));assert.ok(!code.includes('synthetic-stall-3221'))
   const path=base+'/'+widget.id+'/widget'
   for(const candidate of [h.origin,'https://child.allowed.synthetic-stall-3222.test','https://allowed.synthetic-stall-3222.test.evil.test','null']) {
    const refused=await h.request(path,{as:'',headers:{origin:candidate}});assert.equal(refused.status,403);assert.equal(refused.headers.get('access-control-allow-origin'),null)
   }
   const response=await h.request(path,{as:'',headers:{origin}});assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),null)
   const view=await response.json(),expected=kind==='buy_button'?['TEE-S']:kind==='product_card'?['TEE-S','TEE-M']:['TEE-S','TEE-M','HAT-1']
   assert.deepEqual(view.items.map(i=>i.sku).sort(),expected.sort());assert.equal(view.items.find(i=>i.sku==='TEE-S').unitCents,2500)
   await h.api(base+'/'+widget.id+'?sku=synthetic-stall-unknown',undefined,{as:'',status:409})
   const selectionQuery='?sku=TEE-S&quantity=2',cartPath=base+'/'+widget.id+'/cart'+selectionQuery
   const opened=await h.request(cartPath,{method:'POST',as:'',body:{}}),cookie=opened.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
   let cart=(await opened.json()).cart;assert.deepEqual(cart.value.lines,[{sku:'TEE-S',quantity:2}]);assert.equal(cart.value.source.channel,'buy_button')
   cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,customerEmail:`synthetic-stall-${kind}@example.test`,shopper:{address:{name:'Taylor Maker',line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'}}},{as:cookie})).cart
   const review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:cookie});assert.equal(review.review.totalCents,5000)
   const bought=await h.api('/api/stall/cart/checkout',{cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken},{as:cookie})
   const session=[...edge.sessions.values()].find(s=>s.client_reference_id===bought.orderId);await deliverWebhook(h,secret,edge.pay(session.id))
  }
  assert.equal((await h.api('/api/stall/orders?channel=buy_button')).total,3);assert.equal(stock.orders.size,3)
  const link=await h.api(base,{label:'Two sizes',lines:[{sku:'TEE-S',quantity:2},{sku:'TEE-M',quantity:1}]})
  assert.deepEqual((await h.api(base+'/'+link.id,undefined,{as:''})).lines.map(l=>[l.sku,l.quantity,l.unitCents]),[['TEE-M',1,2700],['TEE-S',2,2500]])
  tee=(await h.api('/api/stall/state')).products.find(p=>p.id==='TEE')
  tee=await h.command('product.prepare',{sku:tee.id,revision:tee.revision,...tee.value,details:{...tee.value.details,variants:tee.value.details.variants.map(v=>v.sku==='TEE-S'?{...v,unitCents:2600}:v)}});await h.command('product.approve',{sku:tee.id,revision:tee.revision})
  assert.equal((await h.api(base+'/'+widgets[1].id+'/widget',undefined,{as:'',headers:{origin}})).items.find(i=>i.sku==='TEE-S').unitCents,2600)
  assert.equal((await h.api(base+'/'+widgets[1].id+'?sku=TEE-S',undefined,{as:''})).lines[0].unitCents,2600)
  stock.setAvailable('TEE-S','0')
  const path=base+'/'+widgets[0].id
  assert.equal((await h.api(path+'/widget',undefined,{as:'',headers:{origin}})).items[0].available,'0')
  await h.api(path+'/cart?sku=TEE-S&quantity=1',{},{as:'',status:409})
  tee=(await h.api('/api/stall/state')).products.find(p=>p.id==='TEE')
  tee=await h.command('product.prepare',{sku:tee.id,revision:tee.revision,...tee.value,active:false});await h.command('product.approve',{sku:tee.id,revision:tee.revision})
  assert.deepEqual((await h.api(path+'/widget',undefined,{as:'',headers:{origin}})).items,[])
  await h.api(path+'?sku=TEE-S',undefined,{as:'',status:409})
  assert.equal(edge.sessions.size,3,'unpublished and sold-out widgets create no payment work')
 }finally{await h.close()}
})

test('checkout links retain explicit guest tax consent and reserve promotions against tax-inclusive payments',async()=>{
 const stock=volumeStock(['TEE-S','TEE-M']),edge=stripeEdge({forward:stock.forward}),tax=taxEdge(),secret=randomBytes(32).toString('hex')
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'synthetic-stall-3230',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'synthetic-stall-806',STRIPE_WEBHOOK_SECRET:secret},outboundService:request=>{const url=new URL(request.url);return url.hostname==='api.stripe.com'&&(url.pathname.startsWith('/v1/tax/')||url.pathname==='/v1/account')?tax.handle(request):edge.handle(request)}})
 try {
  await publish(h,'TEE-S','Small tee',2500);await publish(h,'TEE-M','Medium tee',2700);await h.command('shipping.configure',{shippingCents:625})
  const promotion=await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-3231',startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),minimumBasketCents:2500,maxUsesPerCustomer:2,maxTotalUses:2,maxShippingDiscountCents:1250})
  const config=await h.api('/api/stall/tax/configuration'),address={line1:'1 Maker Lane',city:'Austin',state:'TX',postal_code:'78702',country:'US'}
  await h.api('/api/stall/tax/configuration',{revision:config.revision,value:{shipFrom:address,categories:['TEE-S','TEE-M'].map(sku=>({sku,taxCode:'txcd_99999999'})),thresholds:[]}})
  const mode=await h.api('/api/stall/tax/commerce?review=1');await h.api('/api/stall/tax/commerce',{revision:mode.revision,enabled:true,consent:mode.consent})
  const link=await h.api('/api/stall/buy-links',{label:'Two sizes',lines:[{sku:'TEE-S',quantity:2},{sku:'TEE-M',quantity:1}],promotionCode:'SYNTHETIC-STALL-3231'})
  const {visitor}=await import('./analytics-fixture.mjs'),analytics=visitor(h);await analytics.consent();await analytics.event('visit','/shop?buy='+link.id+'&utm_source=newsletter&utm_medium=email')
  const opened=await h.request('/api/stall/buy-links/'+link.id+'/cart',{method:'POST',as:analytics.cookie(),body:{}}),cookie=analytics.cookie()+'; '+opened.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  let cart=(await opened.json()).cart
  const shipping=await h.api('/api/stall/shipping/quote',{lines:cart.value.lines,postalCode:'78702'},{as:cookie}),service=shipping.services[0],chosen={service:service.code,postalCode:'78702',quote:service.quote}
  const input={id:randomUUID(),destination:address,customerEmail:'synthetic-stall-3232@example.test',lines:cart.value.lines,shipping:chosen,promotionCode:'SYNTHETIC-STALL-3231'}
  await h.api('/api/stall/tax/quote',input,{as:cookie,status:400});assert.equal(tax.calculations.size,0)
  const quote=await h.api('/api/stall/tax/quote',{...input,consent:(await h.api('/api/stall/tax/mode',undefined,{as:cookie})).shopperConsent},{as:cookie})
  assert.deepEqual([quote.taxCents,quote.totalCents],[637,8337])
  cart=(await h.api('/api/stall/cart',{cartId:cart.id,revision:cart.revision,...cart.value,customerEmail:input.customerEmail,shopper:{address:{name:'Taylor Maker',...address}},shipping:chosen,taxQuoteId:quote.quoteId,taxTotalCents:quote.totalCents},{as:cookie})).cart
  const review=await h.api('/api/stall/cart/review',{cartId:cart.id,revision:cart.revision},{as:cookie});assert.deepEqual([review.review.subtotalCents,review.review.discountCents,review.review.taxCents,review.review.totalCents],[7700,625,637,8337])
  const intent={cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken},bought=await h.api('/api/stall/cart/checkout',intent,{as:cookie})
  assert.equal((await h.api('/api/stall/cart/checkout',intent,{as:cookie})).orderId,bought.orderId);assert.equal(edge.sessions.size,1)
  const session=[...edge.sessions.values()][0];assert.equal(session.amount_total,8337);await deliverWebhook(h,secret,edge.pay(session.id))
  const order=(await h.api('/api/stall/orders?channel=checkout_link')).orders[0];assert.equal(order.tax.taxCents,637);assert.equal(order.promotion.discountCents,625);assert.equal(order.status,'reserved')
  const sales=await h.api('/api/stall/analytics/report?from=2020-01-01&to=2030-12-31&channel=checkout_link'),testPayment=sales.excludedTestOrders[0];assert.equal(sales.excludedTestOrders.length,1);assert.equal(testPayment.test,true);assert.deepEqual([testPayment.grossSalesCents,testPayment.netSalesCents,testPayment.discountsCents,testPayment.shippingCollectedCents,testPayment.taxCents,testPayment.netCollectedCents],[7700,7700,625,0,637,8337]);assert.equal(sales.totals.paidOrders,0);assert.equal(sales.totals.sessions,null);assert.equal(sales.totals.conversionRate,null);assert.equal(testPayment.references.taxTransaction,order.tax.transactionId)
  const report=await h.api('/api/stall/promotions/report?promotionId='+promotion.id);assert.equal(report.totals.paidUses,1);assert.equal(report.totals.committedDiscountCents,625)
 }finally{await h.close()}
})

test('first-party analytics attributes consented sessions and verified orders without replayed, bot or invented visits',async()=>{
 const {analyticsFixture,visitor,analyticsWindow}=await import('./analytics-fixture.mjs'),f=await analyticsFixture(),{h}=f
 try {
  const v=visitor(h),empty=await v.event()
  assert.equal(empty.captured,false);assert.equal(empty.reason,'consent_limited_unknown')
  let report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.totals.sessions,null);assert.equal(report.totals.conversionRate,null)
  await v.consent()
  const firstId=randomUUID(),first={id:firstId,kind:'visit',path:'/shop?utm_source=newsletter&utm_medium=email&utm_campaign=autumn&utm_content=hero&email=private@example.test',referrer:'https://mail.example.test/inbox?private=secret'}
  assert.equal((await v.call('/api/stall/analytics/events',first,{headers:{'user-agent':'synthetic-stall-desktop'}})).captured,true)
  assert.equal((await v.call('/api/stall/analytics/events',first)).reason,'duplicate')
  await v.event('product_view','/shop/blue-ceramic-mug',{sku:'MUG-BLUE'})
  await v.event('add_to_cart','/shop',{sku:'MUG-BLUE'})
  const email=await f.buy(v)
  assert.equal(email.order.analytics.source,'newsletter');assert.equal(email.order.analytics.medium,'email');assert.equal(email.order.analytics.campaign,'autumn')
  const search=await v.event('visit','/shop/towels',{referrer:'https://www.google.com/search?q=private'},{headers:{'user-agent':'synthetic-stall-iPhone Mobile'}})
  assert.equal(search.captured,true)
  const retained=visitor(h,v.cookie().split('; ').filter(c=>!c.startsWith('stall_analytics_session=')).join('; '))
  assert.equal((await retained.event('visit','/shop')).captured,true)
  const direct=await f.buy(retained,{lines:[{sku:'TOWEL-NAT',quantity:3}]})
  assert.equal(direct.order.analytics.source,'www.google.com');assert.equal(direct.order.analytics.medium,'organic')
  await deliverWebhook(h,f.secret,direct.session)
  await retained.call('/api/stall/checkout',direct.payload)
  await f.buy(visitor(h),{pay:false})
  const unobserved=await f.buy(visitor(h),{extra:{analytics:{source:'fabricated',sessionId:'synthetic-stall-935'}}});assert.equal(unobserved.order.analytics,undefined)
  const testVisitor=visitor(h);await testVisitor.consent();await testVisitor.event('visit','/shop?utm_source=test-campaign&utm_medium=email');f.edge.testNextCheckout();const testPayment=await f.buy(testVisitor);assert.equal(testPayment.order.analyticsExcluded,'test')
  const bot=visitor(h);await bot.consent();assert.equal((await bot.event('visit','/shop',{}, {headers:{'user-agent':'Googlebot'}})).captured,false)
  report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.excludedTestOrders.length,1);assert.equal(report.excludedTestOrders[0].id,testPayment.order.id);assert.equal(report.excludedTestOrders[0].test,true);assert.equal(report.traffic.source.some(row=>row.value==='test-campaign'),false)
  assert.equal(report.totals.sessions,3);assert.equal(report.totals.paidOrders,3);assert.equal(report.totals.conversionOrders,2);assert.equal(report.totals.conversionRate,2/3)
  assert.deepEqual(report.funnel,{visits:3,productViews:1,addToCart:1,checkouts:2,payments:2})
  const emailSource=report.traffic.source.find(r=>r.value==='newsletter'),organic=report.traffic.source.find(r=>r.value==='www.google.com')
  assert.deepEqual(emailSource,{value:'newsletter',sessions:1,paidOrders:1,netSalesCents:2000,conversionRate:1})
  assert.deepEqual(organic,{value:'www.google.com',sessions:2,paidOrders:1,netSalesCents:1500,conversionRate:0.5})
  assert.equal(report.traffic.campaign.find(r=>r.value==='autumn').sessions,1)
  assert.equal(report.traffic.content.find(r=>r.value==='hero').paidOrders,1)
  assert.equal(report.traffic.referrer.find(r=>r.value==='mail.example.test').paidOrders,1)
  assert.equal(report.traffic.landingPage.find(r=>r.value==='/shop').paidOrders,2)
  assert.equal(report.traffic.device.find(r=>r.value==='mobile').sessions,1)
  assert.equal(report.traffic.location.find(r=>r.value==='US').sessions,3)
  assert.ok(!JSON.stringify(report).includes('private@example.test'));assert.ok(!JSON.stringify(report).includes('private=secret'))
  await retained.consent(false)
  assert.equal((await retained.event()).captured,false)
  report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.totals.sessions,null);assert.equal(report.totals.conversionRate,null);assert.equal(report.totals.paidOrders,3)
  assert.equal(report.traffic.source.find(r=>r.value.startsWith('Unknown')).netSalesCents,5500)
  const expired=visitor(h);await expired.consent();await expired.event('visit','/shop?utm_source=ancient&utm_medium=email')
  const capability=Object.fromEntries(expired.cookie().split('; ').map(c=>c.split('='))).stall_analytics_visitor,hash=createHash('sha256').update(capability).digest('hex')
  await h.db.prepare("UPDATE st_analytics_visitors SET value_json=json_set(value_json,'$.lastNonDirect.attributedAt','2020-01-01T00:00:00.000Z') WHERE id_hash=?").bind(hash).run()
  await h.db.prepare("UPDATE st_analytics_sessions SET started_at='2020-01-01T00:00:00.000Z',last_at='2020-01-01T00:00:00.000Z' WHERE visitor_hash=?").bind(hash).run()
  await expired.event('visit','/shop')
  const afterExpiry=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(afterExpiry.traffic.source.find(r=>r.value==='direct').sessions,1);assert.equal(afterExpiry.traffic.source.some(r=>r.value==='ancient'),false)

 }finally{await f.close()}
})

test('sales reports reconcile refunds, ranked products, historical imports, exact costs and CSV drilldowns',async()=>{
 const {analyticsFixture,visitor,analyticsWindow}=await import('./analytics-fixture.mjs'),f=await analyticsFixture(),{h}=f
 try {
  const v=visitor(h);await v.consent();await v.event('visit','/shop?utm_source=newsletter&utm_medium=email&utm_campaign=autumn')
  const mug=await f.buy(v),towel=await f.buy(v,{lines:[{sku:'TOWEL-NAT',quantity:3}]})
  await f.refund(mug.order.id)
  let report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.deepEqual([report.totals.grossSalesCents,report.totals.refundsCents,report.totals.netSalesCents,report.totals.shippingCollectedCents,report.totals.netCollectedCents],[3500,1000,2500,400,2900])
  assert.equal(report.totals.conversionRate,2);assert.equal(report.funnel.checkouts,1);assert.equal(report.funnel.payments,1)
  assert.equal(report.totals.itemCostCents,null);assert.equal(report.totals.taxCents,null);assert.equal(report.totals.giftLiabilityCents,null);assert.equal(report.totals.contributionMarginCents,null)
  assert.deepEqual(report.bestSellers.variants.map(r=>[r.sku,r.unitsSold,r.unitsRefunded,r.netSalesCents]),[['TOWEL-NAT',3,0,1500],['MUG-BLUE',2,1,1000]])
  assert.deepEqual(report.bestSellers.products.map(r=>[r.productSku,r.unitsSold,r.netSalesCents]),[['TOWEL-NAT',3,1500],['MUG-BLUE',2,1000]])
  const mugRow=report.orders.find(o=>o.id===mug.order.id)
  assert.equal(mugRow.references.processor,mug.session.payment_intent);assert.equal(mugRow.references.processorRefunds.length,1);assert.deepEqual(mugRow.references.accounting,[])
  const costs='/api/stall/analytics/costs';await h.api(costs,{enabled:true})
  for(const [id,itemCostCents,feesCents] of [[mug.order.id,400,60],[towel.order.id,300,45]])await h.api(costs,{orderId:id,orderRevision:(await f.order(id)).revision,itemCostCents,shippingCostCents:100,feesCents,giftLiabilityCents:0})
  report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.totals.contributionMarginCents,1895);assert.equal(report.totals.itemCostCents,700);assert.equal(report.totals.feesCents,105)
  await h.api(costs,{orderId:mug.order.id,orderRevision:'synthetic-stall-stale',itemCostCents:0,shippingCostCents:0,feesCents:0},{status:409})
  const filtered=await h.api('/api/stall/analytics/report'+analyticsWindow+'&variant=MUG-BLUE&customer=synthetic-stall-928&channel=online')
  assert.deepEqual(filtered.orders.map(o=>o.id),[mug.order.id]);assert.equal(filtered.totals.netSalesCents,1000)
  const csv=await h.request('/api/stall/analytics/report.csv'+analyticsWindow),text=await csv.text();assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/)
  assert.ok(text.includes(mug.order.id));assert.ok(text.includes(towel.order.id));assert.ok(text.includes(mug.session.payment_intent))
  const input={schema:'stall-analytics-history-v1',source:'synthetic-stall-928-history',rows:[{sourceId:'synthetic-stall-929',createdAt:'2024-06-15T12:00:00Z',channel:'historical',lines:[{sku:'HAT',productSku:'HAT',name:'=SUM(A1)',quantity:4,unitCents:250}],shippingCents:100,taxCents:0,discountCents:0,totalCents:1100,refundsCents:0,processorReference:'synthetic-stall-930',accountingReference:'synthetic-stall-931'}]}
  const preview=await h.api('/api/stall/analytics/history',input)
  assert.equal((await h.api('/api/stall/analytics/report'+analyticsWindow)).totals.paidOrders,2)
  await h.api('/api/stall/analytics/history/apply',{previewId:preview.previewId,reviewed:false},{status:400})
  await h.api('/api/stall/analytics/history/apply',{previewId:preview.previewId,reviewed:true})
  assert.equal((await h.api('/api/stall/analytics/history/apply',{previewId:preview.previewId,reviewed:true})).replayed,true)
  const again=await h.api('/api/stall/analytics/history',input);await h.api('/api/stall/analytics/history/apply',{previewId:again.previewId,reviewed:true})
  report=await h.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.totals.paidOrders,3);assert.equal(report.totals.conversionOrders,2);assert.equal(report.totals.sessions,1);assert.equal(report.totals.netSalesCents,3500)
  assert.deepEqual(report.bestSellers.products.map(r=>r.productSku),['HAT','TOWEL-NAT','MUG-BLUE'])
  const ranked=await h.api('/api/stall/analytics/report'+analyticsWindow+'&rank=netSales');assert.equal(ranked.bestSellers.products[0].productSku,'TOWEL-NAT');assert.equal(ranked.bestSellers.variants[0].sku,'TOWEL-NAT')
  assert.equal(report.channels.find(r=>r.value==='online').netCollectedCents,2900);assert.equal(report.channels.find(r=>r.value==='historical').netCollectedCents,1100);assert.equal(report.dates.find(r=>r.value==='2024-06-15').netCollectedCents,1100)
  const historicalCsv=readCsv(await (await h.request('/api/stall/analytics/report.csv'+analyticsWindow)).text());assert.ok(historicalCsv.some(r=>r.record==='bestseller'&&r.name==="'=SUM(A1)"),'CSV neutralizes formula-shaped imported names')
  assert.equal(report.orders.filter(o=>o.historical).length,1);assert.deepEqual(report.orders.find(o=>o.historical).references.accounting,['synthetic-stall-931'])
  assert.equal((await h.api('/api/stall/analytics/report?from=2024-06-15&to=2024-06-15')).totals.netCollectedCents,1100)
  assert.equal((await h.api('/api/stall/analytics/report?from=2024-06-16&to=2024-06-16')).orders.length,0)
  await h.api('/api/stall/analytics/history',{...input,rows:[{...input.rows[0],sourceId:mug.order.id}]},{status:409})
  await h.api(costs,{enabled:false});report=await h.api('/api/stall/analytics/report'+analyticsWindow);assert.equal(report.totals.contributionMarginCents,null);assert.equal(report.totals.itemCostCents,null)
  const variants=await analyticsFixture({variantProducts:true})
  try {
   const shopper=visitor(variants.h);await shopper.consent();await shopper.event('visit');await shopper.event('product_view','/shop/studio',{sku:'MUG-BLUE'})
   const bought=await variants.buy(shopper,{lines:[{sku:'MUG-BLUE',quantity:2},{sku:'TOWEL-NAT',quantity:3}]});await variants.refund(bought.order.id)
   const grouped=await variants.h.api('/api/stall/analytics/report'+analyticsWindow)
   assert.deepEqual(grouped.bestSellers.products.map(r=>[r.productSku,r.unitsSold,r.unitsRefunded,r.netUnits,r.netSalesCents]),[['STUDIO',5,1,4,2500]])
   assert.deepEqual(grouped.bestSellers.variants.map(r=>[r.productSku,r.sku,r.unitsSold,r.unitsRefunded,r.netSalesCents]),[['STUDIO','TOWEL-NAT',3,0,1500],['STUDIO','MUG-BLUE',2,1,1000]])
   assert.equal((await variants.h.api('/api/stall/analytics/report'+analyticsWindow+'&product=STUDIO')).totals.conversionRate,1)
   const history={schema:'stall-analytics-history-v1',source:'synthetic-stall-936',rows:[{sourceId:'synthetic-stall-937',createdAt:'2024-01-10T12:00:00Z',channel:'historical',lines:[{sku:'HIST',productSku:'HIST',name:'Imported two items',quantity:2,unitCents:1000}],shippingCents:200,taxCents:100,discountCents:0,totalCents:2300,refundsCents:1150}]}
   await variants.h.api('/api/stall/analytics/history',history,{status:400})
   const exact=await variants.h.api('/api/stall/analytics/history',{...history,rows:[{...history.rows[0],refundTaxCents:50,refundShippingCents:100,lines:[{...history.rows[0].lines[0],refundedCents:1000,refundedQuantity:1}]}]})
   await variants.h.api('/api/stall/analytics/history/apply',{previewId:exact.previewId,reviewed:true})
   const original=await variants.h.api('/api/stall/analytics/report?from=2024-01-10&to=2024-01-10')
   assert.deepEqual([original.totals.grossSalesCents,original.totals.netSalesCents,original.totals.shippingCollectedCents,original.totals.taxCents,original.totals.refundsCents,original.totals.netCollectedCents],[2000,1000,100,50,1150,1150])
   assert.equal(original.bestSellers.variants[0].unitsRefunded,1)

  }finally{await variants.close()}

 }finally{await f.close()}
})

test('analytics reports refuse foreign authority and restore historical observation without visitor or cost authority',async()=>{
 const {analyticsFixture,visitor,analyticsWindow}=await import('./analytics-fixture.mjs'),f=await analyticsFixture(),{h}=f
 let fresh
 try {
  const v=visitor(h);await v.consent();await v.event('visit','/shop?utm_source=receipt&utm_medium=email');const purchase=await f.buy(v)
  const member=await h.signIn('synthetic-stall-932@example.test'),admin=await h.signIn('synthetic-stall-933@example.test','admin'),agent=await h.api('/api/stall/agent-token',{})
  for(const path of ['/api/stall/analytics/report'+analyticsWindow,'/api/stall/analytics/report.csv'+analyticsWindow,'/api/stall/analytics/costs','/api/stall/analytics/history']) {
   await h.api(path,undefined,{as:'',status:401});await h.api(path,undefined,{as:member,status:403});await h.api(path,undefined,{headers:{authorization:'Bearer '+agent.token},status:403});await h.api(path,undefined,{headers:{origin:'https://foreign.example.test'},status:403})
   assert.equal((await h.request(path,{as:admin})).status,path.endsWith('/history')?403:200)
  }
  for(const path of ['/api/stall/analytics/costs','/api/stall/analytics/history','/api/stall/analytics/history/apply']) {
   await h.api(path,{enabled:true},{as:'',status:401});await h.api(path,{enabled:true},{as:member,status:403});await h.api(path,{enabled:true},{headers:{authorization:'Bearer '+agent.token},status:403});await h.api(path,{enabled:true},{headers:{origin:'https://foreign.example.test'},status:403})
  }
  const operator=(await h.api('/auth/session',undefined,{as:admin})).operator;await h.command('staff.configure',{actorId:operator.id,staffRole:'finance',refundLimitCents:0})
  await h.api('/api/stall/analytics/report'+analyticsWindow,undefined,{as:admin,status:403})
  await v.call('/api/stall/analytics/events',{id:randomUUID(),kind:'visit',path:'/shop',orderId:purchase.order.id},{status:400})
  await h.api('/api/stall/analytics/costs',{enabled:true})
  await h.api('/api/stall/analytics/costs',{orderId:purchase.order.id,orderRevision:(await f.order(purchase.order.id)).revision,itemCostCents:100,shippingCostCents:20,feesCents:30})
  const records=await h.api('/api/stall/exports/records');assert.equal(records.analytics.costs.records.length,1);assert.equal(records.orders.find(o=>o.id===purchase.order.id).analytics.source,'receipt')
  const history=await h.api('/api/stall/analytics/history',{schema:'stall-analytics-history-v1',source:'synthetic-stall-938',rows:[{sourceId:'synthetic-stall-939',createdAt:'2024-01-10T12:00:00Z',channel:'historical',lines:[{sku:'HIST',productSku:'HIST',name:'Historical item',quantity:1,unitCents:100}],shippingCents:0,taxCents:0,discountCents:0,totalCents:100,refundsCents:0}]})
  await h.api('/api/stall/analytics/history/apply',{previewId:history.previewId,reviewed:true})
  const bundle=await archive(h)
  fresh=await installation({bindings:{...f.pier.bindings,STRIPE_SECRET_KEY:'synthetic-stall-934',STRIPE_WEBHOOK_SECRET:f.secret},outboundService:f.edge.handle})
  await restore(fresh,bundle)
  const restored=visitor(fresh,v.cookie());assert.equal((await restored.event()).captured,false)
  const report=await fresh.api('/api/stall/analytics/report'+analyticsWindow)
  assert.equal(report.totals.paidOrders,2);assert.equal(report.totals.conversionOrders,0);assert.equal(report.totals.sessions,null);assert.equal(report.costConsent,false);assert.equal(report.orders.filter(o=>o.historical).length,1)
  await fresh.api('/api/stall/analytics/history/apply',{previewId:history.previewId,reviewed:true},{status:404})
 }finally{await fresh?.close();await f.close()}
})

test('promotion rules price code and automatic product, variant, collection, order, quantity rewards, spend rewards and bounded shipping through checkout quotes',async()=>{
 const {taxCommerceInstallation}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h}=kit
 const address='synthetic-stall-4100'+'@'+'example.test',base='/api/stall/promotions',lines=[{sku:'MUG-BLUE',quantity:2},{sku:'TOWEL-NAT',quantity:1}]
 try {
  await h.command('collection.save',{handle:'synthetic-stall-mugs',title:'Mugs',description:'Selected mugs',kind:'manual',skus:['MUG-BLUE'],published:true})
  const cases=[
   {type:'product',targets:{products:['MUG-BLUE']},valueType:'percentage',value:1000,discount:200,line:[200,0]},
   {type:'product',targets:{variants:['MUG-BLUE']},valueType:'amount',value:333,discount:333,line:[333,0]},
   {type:'product',targets:{collections:['synthetic-stall-mugs']},valueType:'amount',value:101,discount:101,line:[101,0]},
   {type:'product',targets:{collections:['synthetic-stall-mugs']},valueType:'percentage',value:1250,discount:250,line:[250,0]},
   {type:'order',valueType:'amount',value:333,discount:333,line:[266,67]},
   {type:'order',valueType:'percentage',value:1000,discount:250,line:[200,50]},
   {type:'buy_get',targets:{products:['MUG-BLUE']},buy:{products:['MUG-BLUE']},buyQuantity:1,getQuantity:1,maxApplications:1,valueType:'free',discount:1000,line:[1000,0]},
   {type:'buy_get',targets:{products:['TOWEL-NAT']},buy:{products:['MUG-BLUE']},buySpendCents:2000,getQuantity:1,valueType:'percentage',value:5000,discount:250,line:[0,250]},
   {type:'buy_get',targets:{products:['TOWEL-NAT']},buy:{products:['MUG-BLUE']},buySpendCents:2000,getQuantity:1,valueType:'amount',value:123,discount:123,line:[0,123]},
   {type:'free_shipping',minimumBasketCents:5000,minimumQuantity:3,countries:['US'],zones:['787'],maximumRateCents:200,lines:[{sku:'MUG-BLUE',quantity:6}],discount:200,line:[0]},
  ]
  let n=0
  for(const method of ['code','automatic'])for(const item of cases){
   const code='SYNTHETIC-STALL-4101-'+n++,{discount,line,lines:basket,minimumBasketCents,...rule}=item
   const input={...(method==='code'?{code}:{}),startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:minimumBasketCents??1,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{...rule,method}},saved=await h.api(base,input)
   const body={customerEmail:address,lines:basket??lines,shipping:{postalCode:'78702'},...(method==='code'?{promotionCode:code}:{})},quote=await h.api(base+'/quote',body,{as:''})
   assert.equal(quote.applicable,true,JSON.stringify({method,rule,quote}));assert.equal(quote.discountCents,discount);assert.equal(quote.totalCents,item.type==='free_shipping'?6000:2700-discount)
   assert.deepEqual(quote.lineDiscounts.map(l=>l.discountCents),line);assert.equal(quote.promotion.components[0].revision,saved.revision)
   const refused=await h.api(base+'/quote',{...body,lines:[{sku:'TOWEL-NAT',quantity:1}],...(item.type==='order'?{customerEmail:address}:{} )},{as:''})
   if(item.type!=='order')assert.equal(refused.applicable,false,JSON.stringify({rule,refused}))
   await h.api(base+'/revoke',saved)
  }
  const shipping=await h.api(base,{code:'SYNTHETIC-STALL-4102',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{type:'free_shipping',minimumQuantity:3,countries:['US'],zones:['787'],maximumRateCents:200}})
  const shipQuote=extra=>h.api(base+'/quote',{customerEmail:address,lines,shipping:{postalCode:'78702'},promotionCode:'SYNTHETIC-STALL-4102',...extra},{as:''})
  assert.equal((await shipQuote({shipping:{postalCode:'90210'}})).reason,'SHIPPING_ZONE');assert.equal((await shipQuote({destination:{country:'CA'}})).reason,'COUNTRY')
  await h.api(base,{...shipping,code:'SYNTHETIC-STALL-4102',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{type:'free_shipping',maximumRateCents:199}})
  assert.equal((await shipQuote({})).reason,'SHIPPING_RATE')
  await h.api(base+'/revoke',(await h.api(base)).promotions.find(p=>p.id===shipping.id))
  const importInput={rows:[{email:address,name:'Eligible shopper',tags:['synthetic-stall-vip']}]},preview=await h.api('/api/stall/customers/import/preview',importInput)
  const directory=await h.api('/api/stall/customers/import/apply',{...importInput,fingerprint:preview.fingerprint}),profile=directory.customers.find(c=>c.emails.includes(address))
  const segmented=await h.api('/api/stall/customers',{type:'segment.save',segment:{name:'VIP',tag:'synthetic-stall-vip',minimumSpentCents:0,minimumOrders:0}}),segment=segmented.segments[0]
  const restricted=await h.api(base,{code:'SYNTHETIC-STALL-4103',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{type:'order',valueType:'amount',value:100,segmentIds:[segment.id]}})
  const restrictedInput={customerEmail:address,lines,promotionCode:'SYNTHETIC-STALL-4103'}
  assert.equal((await h.api(base+'/quote',restrictedInput,{as:''})).reason,'CUSTOMER_ELIGIBILITY')
  const customer=await h.signIn(address)
  assert.equal((await h.api(base+'/quote',restrictedInput,{as:customer})).discountCents,100)
  await h.api('/api/stall/customers',{type:'profile.save',id:profile.id,revision:profile.revision,name:'Eligible shopper',tags:[]})
  assert.equal((await h.api(base+'/quote',restrictedInput,{as:customer})).reason,'CUSTOMER_ELIGIBILITY')
  await h.api(base+'/revoke',restricted)
  const denied=await h.api(base,{code:'SYNTHETIC-STALL-4104',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{type:'order',valueType:'amount',value:100}})
  const automatic=await h.api(base,{startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999,rule:{method:'automatic',type:'product',valueType:'percentage',value:1000,targets:{products:['MUG-BLUE']}}})
  assert.equal((await h.api(base+'/quote',{customerEmail:address,lines,promotionCode:'SYNTHETIC-STALL-4104'},{as:''})).reason,'COMBINATION')
  await h.api(base+'/revoke',automatic);await h.api(base+'/revoke',denied)

 }finally{await kit.close()}
})

test('combined discount purchases bind net tax, odd-cent line refunds, single-use races and campaign events without duplicating paid totals',async()=>{
 const {taxCommerceInstallation}=await import('./tax-commerce.mjs'),kit=await taxCommerceInstallation(),{h}=kit,base='/api/stall/promotions',address='synthetic-stall-4200'+'@'+'example.test'
 const common={startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:10,maxTotalUses:20,maxShippingDiscountCents:99999},combines={product:true,order:true,shipping:true}
 try {
  const product=await h.api(base,{...common,code:'SYNTHETIC-STALL-4201',rule:{type:'product',targets:{products:['MUG-BLUE']},valueType:'percentage',value:1000,combines}})
  const orderPromo=await h.api(base,{...common,rule:{method:'automatic',type:'order',valueType:'amount',value:333,combines}})
  const quote=await kit.quote({customerEmail:address,promotionCode:'SYNTHETIC-STALL-4201'})
  assert.equal(quote.result.taxCents,144);assert.equal(quote.result.totalCents,2311)
  const sale=await kit.buy(quote),o=sale.order
  assert.equal(o.totalCents,2311);assert.equal(sale.session.amount_total,2311);assert.equal(o.promotion.discountCents,533);assert.equal(o.shippingCents,200)
  assert.deepEqual(o.promotion.lineDiscounts,[{sku:'MUG-BLUE',discountCents:461},{sku:'TOWEL-NAT',discountCents:72}]);assert.deepEqual(o.tax.lines.map(l=>[l.amount,l.taxCents]),[[1539,127],[428,0]])
  const stockOrder=(await kit.pier.api('/api/pier/state')).orders.find(p=>p.id===o.reservation.id)
  assert.equal(Number(stockOrder.total),19.67);assert.equal(stockOrder.channelPayment.amount,'19.67');assert.deepEqual(stockOrder.lines.filter(l=>l.itemId===o.lines[0].itemId).map(l=>[Number(l.quantity),Number(l.price)]).sort(),[[1,7.69],[1,7.7]].sort())
  await kit.ship(o.id)
  const first=await kit.refund(o.id),refund=first.refunds.at(-1)
  assert.equal(refund.amountCents,834);assert.equal(refund.taxAllocation.lines[0].amount,770);assert.equal(refund.taxAllocation.taxCents,64);assert.ok(refund.taxReversalId)
  const second=await kit.refund(o.id),last=second.refunds.at(-1)
  assert.equal(last.amountCents,832);assert.equal(last.taxAllocation.lines[0].amount,769);assert.equal(last.taxAllocation.taxCents,63)
  const report=await h.api(base+'/campaign-report')
  assert.deepEqual(report.totals,{orders:1,paidOrders:1,subtotalCents:2500,discountCents:533,lineDiscountCents:533,shippingCents:200,taxCents:144,totalCents:2311,refundedCents:1666,refundedTaxCents:127,netPaidCents:645})
  assert.deepEqual(report.allocations.map(a=>[a.promotionId,a.uses,a.discountCents]).sort(),[[product.id,1,200],[orderPromo.id,1,333]].sort())
  assert.equal(report.events.filter(e=>e.id.startsWith('promotion.qualified.')).length,2);assert.equal(report.events.filter(e=>e.id.startsWith('promotion.redeemed.')).length,2);assert.equal(report.events.filter(e=>e.id.startsWith('promotion.reversed.')).length,4)
  const repeated=await h.command('refund.approve',{orderId:second.id,revision:second.revision,refundId:last.id});assert.equal(repeated.refunds.length,2)
  assert.deepEqual((await h.api(base+'/campaign-report')).totals,report.totals)
  const member=await h.signIn(address)
  await h.api(base+'/campaign-report',undefined,{as:member,status:403});await h.api(base+'/codes',{...product,count:2},{as:member,status:403})
  await h.api(base+'/revoke',orderPromo)
  const batch=await h.api(base+'/codes',{...product,count:3});assert.equal(batch.codes.length,3);assert.equal(new Set(batch.codes.map(c=>c.code)).size,3);assert.equal(readCsv(batch.csv).length,3)
  const code=batch.codes[0].code
  const attempts=await Promise.all([1,2].map(n=>kit.quote({customerEmail:'synthetic-stall-4202-'+n+'@'+'example.test',promotionCode:code})))
  const race=await Promise.all(attempts.map(async q=>{try{return {status:200,result:await kit.buy(q,{pay:false})}}catch(error){assert.match(String(error),/Promotion availability|single-use/);return {status:409}}}))
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await h.api(base+'/quote',{customerEmail:address,lines:[{sku:'MUG-BLUE',quantity:1}],promotionCode:code},{as:''})).reason,'CODE_USED')
  const usage=await h.api(base+'/codes?promotionId='+product.id);assert.deepEqual(usage.codes.map(c=>c.uses).sort(),[0,0,1]);assert.ok(!JSON.stringify(usage).includes(code))
  assert.equal((await h.api(base+'/quote',{customerEmail:address,lines:[{sku:'MUG-BLUE',quantity:1}],promotionCode:'SYNTHETIC-STALL-4201,'+batch.codes[1].code},{as:''})).reason,'COMBINATION')
 }finally{await kit.close()}
})
