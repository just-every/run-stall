import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installation } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge,publish,purchase } from './network.mjs';
// A shop on the owner's computer: Stripe cannot reach it, so it connects Stripe
// without a webhook secret and confirms each payment by asking Stripe.
test('a local shop connects Stripe from the page alone and confirms payments by asking Stripe',async()=>{
 const pier=await pierInstallation(),edge=stripeEdge({forward:pier.forward});
 const h=await installation({entry:resolve('tests/api/dev-worker.ts'),origin:'http://localhost',bindings:{...pier.bindings,AUTH_LOCAL:'true'},outboundService:edge.handle});
 try {
  await publish(h,'MUG-BLUE','Blue ceramic mug',2450);
  assert.equal((await h.api('/api/stall/catalogue',undefined,{as:''})).checkoutReady,false);
  assert.equal((await h.api('/api/stall/state')).connections.webhook,false,'payment confirmations wait for the Stripe key');
  // An invented signing secret is refused, never accepted silently.
  await h.command('connection.stripe',{secretKey:'sk_test_localshop',webhookSecret:'whsec_invented0000000000000000000000'},{status:400});
  await h.command('connection.stripe',{secretKey:'sk_test_localshop'});
  const state=await h.api('/api/stall/state');
  assert.deepEqual([state.connections.stripe,state.connections.webhook,state.connectionDetails.stripe.local,state.connectionDetails.stripe.webhook],[true,true,true,false]);
  assert.equal((await h.api('/api/stall/catalogue',undefined,{as:''})).checkoutReady,true);
  // The customer's return asks Stripe: unpaid stays waiting, paid is confirmed and reserved in Pier, priced.
  const first=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[2]});
  assert.deepEqual(await h.api('/api/stall/checkout/confirm',{orderId:first.orderId},{as:''}),{status:'awaiting_payment'});
  edge.pay(first.session.id);
  assert.deepEqual(await h.api('/api/stall/checkout/confirm',{orderId:first.orderId},{as:''}),{status:'paid'});
  const reserved=(await h.api('/api/stall/state')).orders.find(o=>o.id===first.orderId);
  assert.equal(reserved.status,'reserved');
  let stock=await pier.api('/api/pier/state');
  const priced=stock.orders.find(o=>o.id===reserved.reservation.id);
  assert.deepEqual([priced.pricingStatus,priced.lines[0].price,Number(priced.total)],['priced','24.5',49]);
  // A customer who never comes back is confirmed by the minute's scheduled check.
  const second=await purchase(h,edge,{skus:['MUG-BLUE'],quantities:[1]});
  edge.pay(second.session.id);
  const run=await (await h.mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'* * * * *'});
  assert.equal(run.outcome,'ok');
  assert.equal((await h.api('/api/stall/state')).orders.find(o=>o.id===second.orderId).status,'reserved');
  stock=await pier.api('/api/pier/state');
  assert.equal(stock.orders.length,2);
 } finally { await h.close(); await pier.close() }
});
