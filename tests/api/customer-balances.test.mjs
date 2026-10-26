import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { installation,archive,restore } from './harness.mjs';

test('reviewed native balance commands are exact, replay-safe and visible only to the independently proven mailbox',async()=>{
 const h=await installation(),base='/api/stall/customer-balances',own='/api/stall/account/balances';
 try {
  const email='synthetic-stall-1501@example.test',foreign='synthetic-stall-1502@example.test';
  const read=()=>h.api(base+'?email='+encodeURIComponent(email));
  const issue={commandId:randomUUID(),type:'issue',email:'  SYNTHETIC-STALL-1501@EXAMPLE.TEST  ',kind:'gift',amountCents:5007,currency:'usd',revision:(await read()).revision,reason:'synthetic-stall-1503',confirmed:true};
  await h.api(own,undefined,{as:'',status:401});
  await h.api(base,issue,{as:'',status:401});
  await h.api(base,issue,{headers:{origin:'https://synthetic-stall-1504.test'},status:403});
  const malformed=await h.mf.dispatchFetch(h.origin+base,{method:'POST',headers:{origin:h.origin,cookie:h.cookie,'content-type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
  for(const body of [[],null,{...issue,confirmed:false},{...issue,amountCents:5.5},{...issue,amountCents:-5},{...issue,currency:'cad'},{...issue,importedBalanceCents:999}])await h.api(base,body,{status:400});
  assert.equal((await read()).giftCents,0);
  const messages=h.messages.length;
  const results=await Promise.all([h.api(base,issue),h.api(base,issue)]);
  let current=await read();
  assert.equal(current.giftCents,5007);assert.equal(current.creditCents,0);assert.equal(current.ledger.length,1);
  assert.equal(results[0].receipt.entryId,results[1].receipt.entryId);
  assert.equal((await h.api(base,issue)).receipt.replayed,true);
  await h.api(base,{...issue,amountCents:5008},{status:409});
  await h.api(base,{...issue,commandId:randomUUID()},{status:409});
  const originalRevision=current.revision;
  current=await h.api(base,{...issue,email,commandId:randomUUID(),kind:'credit',revision:current.revision,amountCents:309});
  const adjustment={...issue,email,commandId:randomUUID(),type:'adjust',amountCents:-107,revision:originalRevision,reason:'synthetic-stall-1505'};
  await h.api(base,adjustment,{status:409});
  await h.api(base,{...adjustment,revision:current.revision,amountCents:107},{status:400});
  await h.api(base,{...adjustment,revision:current.revision,amountCents:-5008},{status:400});
  const approved={...adjustment,revision:current.revision};
  current=await h.api(base,approved);
  assert.equal(current.giftCents,4900);assert.equal(current.creditCents,309);
  assert.equal(current.ledger.length,3);assert.equal(current.ledger.find(entry=>entry.commandId===approved.commandId).amountCents,-107);
  assert.equal((await h.api(base,approved)).receipt.replayed,true);
  assert.equal((await read()).giftCents,4900);
  assert.equal(h.messages.length,messages,'balance changes never send outbound email');

  const other=await h.signIn(foreign);
  assert.equal((await h.api(own,undefined,{as:other})).giftCents,0);
  await h.api(base,issue,{as:other,status:403});
  await h.api(base+'?email='+email,undefined,{as:other,status:403});
  await h.api(own+'?email='+email,undefined,{as:other,status:400});
  await h.api(own,issue,{as:other,status:405});
  const grant=await h.api('/api/stall/agent-token',{}),headers={authorization:'Bearer '+grant.token};
  await h.api(base,{...issue,commandId:randomUUID(),revision:current.revision},{as:'',headers,status:403});
  await h.api(base+'?email='+email,undefined,{as:'',headers,status:403});
  await h.api(own,undefined,{as:'',headers,status:401});

  const unproven=await h.signIn('synthetic-stall-1506@example.test');
  await h.api('/auth/email',{email},{as:unproven});
  await h.api(own,undefined,{as:unproven,status:403});
  await h.api('/auth/magic-link',{email,returnTo:'/order'},{as:'',status:202});
  const message=h.messages.findLast(value=>JSON.stringify(value.to).includes(email));
  const link=new URL(message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]);
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:link.searchParams.get('token')}});
  assert.equal(confirmed.status,303);
  const proven=confirmed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const mine=await h.api(own,undefined,{as:proven});
  assert.equal(mine.email,email);assert.equal(mine.giftCents,4900);assert.equal(mine.creditCents,309);
  assert.equal(mine.ledger.length,3);assert.ok(mine.ledger.some(entry=>entry.reason===approved.reason));
  assert.ok(mine.ledger.every(entry=>!('actor_id' in entry)&&!('request_hash' in entry)));
  await h.api(own,undefined,{as:unproven,status:403});
  await h.api(own,undefined,{as:proven,headers:{origin:'https://synthetic-stall-1507.test'},status:403});
  assert.deepEqual((await h.api(own,undefined,{as:other})).ledger,[]);

  // A metadata merge never transfers mailbox custody or balance value.
  const rows=[{email,name:'synthetic-stall-1508'},{email:foreign,name:'synthetic-stall-1508'}];
  const preview=await h.api('/api/stall/customers/import/preview',{rows});
  let directory=await h.api('/api/stall/customers/import/apply',{rows,fingerprint:preview.fingerprint});
  const source=directory.customers.find(customer=>customer.emails.includes(email)),target=directory.customers.find(customer=>customer.emails.includes(foreign));
  directory=await h.api('/api/stall/customers',{type:'merge',id:source.id,revision:source.revision,targetId:target.id,targetRevision:target.revision});
  assert.ok(directory.customers.some(customer=>customer.emails.includes(email)&&customer.emails.includes(foreign)));
  assert.equal((await h.api(own,undefined,{as:proven})).giftCents,4900);
  assert.deepEqual((await h.api(own,undefined,{as:other})).ledger,[]);
  const exported=await h.api('/api/stall/exports/records');
  assert.equal(exported.customerBalances.ledger.length,3);
  const transferred=await installation();
  try {
   await restore(transferred,await archive(h));
   await transferred.api(own,undefined,{as:proven,status:401});
   const destinationOwner=await transferred.signIn(email);
   const preserved=await transferred.api(own,undefined,{as:destinationOwner});
   assert.equal(preserved.giftCents,4900);assert.equal(preserved.creditCents,309);
   assert.deepEqual((await transferred.api(own,undefined,{as:await transferred.signIn(foreign)})).ledger,[]);
  }finally{await transferred.close()}
  await h.command('customer.erase',{email,confirm:'ERASE'});
  assert.equal((await h.api(own,undefined,{as:proven})).giftCents,0);
  await h.api(base,issue,{status:409});
  const erased=await h.api('/api/stall/exports/records');
  assert.equal(erased.customerBalances.ledger.length,3);
  assert.deepEqual(erased.customerBalances.details,[]);
  assert.ok(erased.customerBalances.accounts.every(account=>account.email!==email));
 } finally {await h.close()}
});
