import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { installation,archive,restore } from './harness.mjs';
import { stripeEdge,deliverWebhook } from './network.mjs';
import { volumeStock } from './volume-stock.mjs';
const state=h=>h.api('/api/stall/state');
const flat=cents=>({type:'flat',cents});
const quote=(h,lines,postalCode,opts={})=>h.api('/api/stall/shipping/quote',{lines:lines.map(([sku,quantity=1])=>({sku,quantity})),...(postalCode?{postalCode}:{})},{as:'',...opts});
const money=(result,code)=>result.services.find(service=>service.code===code)?.cents;

test('SHIP-004: profiles price mixed baskets per service, refuse unserved lines before payment, and bulk reassignment invalidates open quotes while paid orders keep their profile revision and charge',async()=>{
 const stock=volumeStock(['TEE','DESK-A','DESK-B','STICKERS','CHAIR','MUG','BOOK']),edge=stripeEdge({forward:stock.forward}),secret=randomBytes(32).toString('hex');
 const h=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
 let destination;
 try {
  const put=async(sku,name,unitCents,weightGrams)=>{const draft=await h.command('product.prepare',{sku,name,description:'',unitCents,active:true,details:{weightGrams}});return h.command('product.approve',{sku,revision:draft.revision})};
  await put('TEE','Linen tee',2500,200);await put('DESK-A','Oak desk',30000,20000);await put('DESK-B','Pine desk',28000,18000);await put('STICKERS','Sticker pack',500,20);
  await put('CHAIR','Armchair',40000,9000);await put('MUG','Ceramic mug',1500,300);await put('BOOK','Hardcover book',4000,800);
  const profile=async(id,value,revision)=>h.command('shipping.profile.save',{id,value,...(revision?{revision}:{})});
  const saved={};
  saved.general=await profile('general',{name:'General',services:[{code:'ups-ground',name:'UPS Ground',rate:flat(600)},{code:'usps-priority',name:'USPS Priority',rate:flat(600)}]},'unsaved');
  saved.oversized=await profile('oversized',{name:'Oversized',shipFrom:'Warehouse',zones:[{name:'East coast',zipPrefixes:['0','1','2','3']}],services:[{code:'ups-ground',name:'UPS Ground',rate:flat(2500)}]});
  saved.stickers=await profile('stickers',{name:'Free-shipping stickers',services:[{code:'ups-ground',name:'UPS Ground',rate:{type:'free'}},{code:'usps-priority',name:'USPS Priority',rate:{type:'free'}}]});
  saved.furniture=await profile('furniture',{name:'Furniture',services:[]});
  const assign=async(rows,extra={})=>{const review=await h.command('shipping.assign',{assignments:rows.map(([sku,profile])=>({sku,profile})),...extra});return h.command('shipping.assign',{assignments:rows.map(([sku,profile])=>({sku,profile})),fingerprint:review.fingerprint})};
  await assign([['DESK-A','oversized'],['DESK-B','oversized'],['STICKERS','stickers'],['CHAIR','furniture']]);

  // One general and one oversized item to a US ZIP: a single UPS Ground option at exactly $31.00.
  let mixed=await quote(h,[['TEE'],['DESK-A']],'10001');
  assert.deepEqual(mixed.services.map(service=>[service.code,service.cents]),[['ups-ground',3100]]);
  assert.equal((await quote(h,[['TEE'],['DESK-A'],['STICKERS']],'10001')).services[0].cents,3100,'a free-shipping item leaves the charge unchanged');
  assert.deepEqual((await quote(h,[['TEE']],'10001')).services.map(service=>[service.code,service.cents]),[['ups-ground',600],['usps-priority',600]]);

  // A pickup place and a local-delivery area open the other two modes.
  await h.command('shipping.place',{kind:'pickup',value:{name:'Studio',address:'1 Main St, New York NY',hours:'Sat 10–4',instructions:'Ring the bell'}});
  await h.command('shipping.place',{kind:'delivery',value:{zipPrefixes:['100'],feeCents:1500,minimumCents:5000,instructions:'Delivered Saturday'}});
  const furniture=await quote(h,[['TEE'],['DESK-A'],['STICKERS'],['CHAIR']],'10001');
  assert.deepEqual(furniture.services.map(service=>service.kind).sort(),['delivery','pickup'],'shipped services disappear; pickup and local delivery remain');
  assert.ok(furniture.notes.some(note=>note.includes('Armchair')&&note.includes('picked up or delivered locally')),'the cause names the item');
  assert.equal(money(furniture,'pickup'),0);assert.equal(money(furniture,'local-delivery'),1500);
  assert.match(furniture.services.find(service=>service.kind==='pickup').detail,/1 Main St/);
  assert.ok((await quote(h,[['TEE']],'90210')).notes.some(note=>note.includes('outside the local delivery area')));
  assert.ok((await quote(h,[['MUG']],'10001')).notes.some(note=>note.includes('$')&&note.includes('local delivery')),'the amount still needed to qualify is stated');

  // The oversized profile does not serve this ZIP: the line is named, checkout refuses before any payment, the rest of the basket still quotes.
  const far=await quote(h,[['TEE'],['DESK-A']],'99501');
  assert.deepEqual(far.unserved.map(line=>line.name),['Oak desk']);assert.ok(far.notes.some(note=>note.includes('Oak desk')));
  assert.ok(!far.services.some(service=>service.kind==='ship'));
  const sessions=edge.sessions.size;
  const refused=await h.api('/api/stall/checkout',{customerEmail:'far@example.test',lines:[{sku:'TEE',quantity:1},{sku:'DESK-A',quantity:1}],shipping:{service:'ups-ground',postalCode:'99501'},idempotencyKey:randomUUID()},{as:'',status:409});
  assert.equal(refused.error.code,'SHIPPING_UNSERVED');assert.match(refused.error.message,/Oak desk/);assert.equal(edge.sessions.size,sessions,'nothing is created at the provider');
  assert.equal(money(await quote(h,[['TEE']],'99501'),'ups-ground'),600,'the remaining basket still ships there');
  await h.api('/api/stall/checkout',{customerEmail:'x@example.test',lines:[{sku:'TEE',quantity:1}],idempotencyKey:randomUUID()},{as:'',status:409});
  await h.api('/api/stall/checkout',{customerEmail:'x@example.test',lines:[{sku:'TEE',quantity:1}],shipping:{service:'ups-ground',postalCode:'1000'},idempotencyKey:randomUUID()},{as:'',status:400});

  // A paid order keeps the profile revisions and the quoted charge it was sold under.
  const open=mixed.services[0];
  const paidOrder=await h.api('/api/stall/checkout',{customerEmail:'buyer@example.test',lines:[{sku:'TEE',quantity:1},{sku:'DESK-A',quantity:1}],shipping:{service:'ups-ground',postalCode:'10001',quote:open.quote},expectedTotalCents:2500+30000+3100,idempotencyKey:randomUUID()},{as:''});
  const session=[...edge.sessions.values()].find(entry=>entry.client_reference_id===paidOrder.orderId);
  assert.equal(session.total_details.amount_shipping,3100);
  const delivered=await deliverWebhook(h,secret,edge.pay(session.id));assert.equal(delivered.value.status,'reserved');
  const original=(await state(h)).orders.find(entry=>entry.id===paidOrder.orderId);
  assert.equal(original.shippingCents,3100);assert.equal(original.shipping.service.code,'ups-ground');assert.equal(original.shipping.postalCode,'10001');
  assert.deepEqual(original.shipping.profiles.map(entry=>[entry.id,entry.revision]).sort(),[['general',saved.general.revision],['oversized',saved.oversized.revision]]);

  // Editing a profile invalidates open quotes.
  const edited=await profile('oversized',{...saved.oversized.value,services:[{code:'ups-ground',name:'UPS Ground',rate:flat(2600)}]},saved.oversized.revision);
  await h.api('/api/stall/checkout',{customerEmail:'late@example.test',lines:[{sku:'TEE',quantity:1},{sku:'DESK-A',quantity:1}],shipping:{service:'ups-ground',postalCode:'10001',quote:open.quote},idempotencyKey:randomUUID()},{as:'',status:409});
  mixed=await quote(h,[['TEE'],['DESK-A']],'10001');assert.equal(money(mixed,'ups-ground'),3200);assert.notEqual(mixed.services[0].quote,open.quote);
  await profile('oversized',edited.value,saved.oversized.revision).catch(()=>{});
  await h.command('shipping.profile.save',{id:'oversized',value:edited.value,revision:saved.oversized.revision},{status:409});
  saved.oversized=edited;

  // Bulk reassignment through the grid door and the catalog CSV: reviewed first, applied only with the reviewed fingerprint.
  const before=await quote(h,[['TEE'],['DESK-A'],['DESK-B']],'10001');assert.equal(money(before,'ups-ground'),3200);
  const grid=await h.command('shipping.assign',{assignments:[{sku:'DESK-A',profile:'general'}]});
  assert.deepEqual(grid.changes.map(change=>[change.sku,change.from,change.to]),[['DESK-A','oversized','general']]);
  assert.equal((await state(h)).shipping.assignments['DESK-A'],'oversized','a review changes nothing');
  await h.command('shipping.assign',{assignments:[{sku:'DESK-A',profile:'general'}],fingerprint:'0'.repeat(64)},{status:409});
  await h.command('shipping.assign',{assignments:[{sku:'DESK-A',profile:'general'}],fingerprint:grid.fingerprint});
  await h.api('/api/stall/checkout',{customerEmail:'late@example.test',lines:[{sku:'TEE',quantity:1},{sku:'DESK-A',quantity:1}],shipping:{service:'ups-ground',postalCode:'10001',quote:mixed.services[0].quote},idempotencyKey:randomUUID()},{as:'',status:409});
  assert.equal(money(await quote(h,[['TEE'],['DESK-A']],'10001'),'ups-ground'),600,'the new quote changes');
  const csv='SKU,Shipping Profile\nDESK-B,general\nCHAIR,furniture\n';
  const csvReview=await h.command('shipping.assign',{csv});
  assert.deepEqual(csvReview.changes.map(change=>change.sku),['DESK-B']);assert.equal(csvReview.unchanged,1);
  await h.command('shipping.assign',{csv:'SKU,Profile\nDESK-B,general\n'},{status:400});
  await h.command('shipping.assign',{csv:'SKU,Shipping Profile\nNOPE,general\n'},{status:400});
  await h.command('shipping.assign',{csv:'SKU,Shipping Profile\nDESK-B,missing\n'},{status:400});
  await h.command('shipping.assign',{csv,fingerprint:csvReview.fingerprint});
  assert.equal(money(await quote(h,[['TEE'],['DESK-A'],['DESK-B']],'10001'),'ups-ground'),600);
  const after=(await state(h)).orders.find(entry=>entry.id===paidOrder.orderId);
  assert.equal(after.shippingCents,3100);assert.deepEqual(after.shipping.profiles,original.shipping.profiles,'the paid order still shows its original profile revisions');

  // Weight, price, handling and surcharge rates; profiles in use cannot be removed; roles and strict fields.
  await profile('media',{name:'Media mail',services:[{code:'media',name:'Media mail',rate:{type:'weight',tiers:[{upToGrams:500,cents:400},{upToGrams:2000,cents:900}]},handlingCents:100,surchargeCents:50}]});
  await profile('books',{name:'Books',services:[{code:'media',name:'Media mail',rate:{type:'price',tiers:[{upToCents:5000,cents:500},{upToCents:20000,cents:0}]}}]});
  await assign([['MUG','media'],['BOOK','books']]);
  assert.equal(money(await quote(h,[['MUG',3]],'10001'),'media'),900+100+150,'900 g falls in the second weight band, plus handling and 3 surcharges');
  assert.equal(money(await quote(h,[['MUG',1]],'10001'),'media'),400+100+50);
  assert.equal(money(await quote(h,[['BOOK',1]],'10001'),'media'),500);assert.equal(money(await quote(h,[['BOOK',5]],'10001'),'media'),0);assert.equal(money(await quote(h,[['BOOK',6]],'10001'),'media'),undefined,'above the last price band the service is not offered');
  assert.equal(money(await quote(h,[['MUG',1],['BOOK',1]],'10001'),'media'),550+500,'each profile prices its own items in the shared service');
  assert.equal((await quote(h,[['MUG',1],['TEE',1]],'10001')).services.filter(service=>service.kind==='ship').length,0,'a service only one profile offers is not offered');
  const live=(await state(h)).shipping.profiles.find(entry=>entry.id==='media');
  await h.command('shipping.profile.delete',{id:'media',revision:live.revision},{status:409});
  const member=await h.signIn('shipping-member@example.test');
  await h.command('shipping.profile.save',{id:'extra',value:{name:'Extra',services:[{code:'x',name:'X',rate:flat(100)}]}},{as:member,status:403});
  for(const bad of [{name:'Bad',services:[{code:'pickup',name:'X',rate:flat(1)}]},{name:'Bad',services:[{code:'a',name:'A',rate:flat(1)},{code:'a',name:'B',rate:flat(1)}]},{name:'Bad',services:[{code:'a',name:'A',rate:{type:'weight',tiers:[{upToGrams:500,cents:1},{upToGrams:400,cents:2}]}}]},{name:'Bad',zones:[{name:'Z',zipPrefixes:['abc']}],services:[{code:'a',name:'A',rate:flat(1)}]},{name:'Bad',services:[],pickup:false,delivery:false},{name:'Bad',services:[{code:'a',name:'A',rate:flat(1),secret:1}]},{name:'general',services:[{code:'a',name:'A',rate:flat(1)}]}])
   await h.command('shipping.profile.save',{id:'bad',value:bad},{status:bad.name==='general'?409:400});
  await h.command('shipping.profile.delete',{id:'general',revision:saved.general.revision},{status:409});

  // A pickup order is paid without collecting a shipping address; a shop may hold 99 custom profiles and no more.
  const pick=await h.api('/api/stall/checkout',{customerEmail:'pickup@example.test',lines:[{sku:'TEE',quantity:1}],shipping:{service:'pickup',postalCode:'10001'},idempotencyKey:randomUUID()},{as:''});
  const pickSession=[...edge.sessions.values()].find(entry=>entry.client_reference_id===pick.orderId);assert.equal(pickSession.shipping_address_collection,null,'pickup collects no shipping address');assert.deepEqual(session.shipping_address_collection,{allowed_countries:['US']});
  const pickup=(await state(h)).orders.find(entry=>entry.id===pick.orderId);
  assert.equal(pickup.shippingCents,0);assert.equal(pickup.shipping.service.kind,'pickup');assert.equal(pickup.shipping.place.name,'Studio');
  for(let i=0;i<99-5;i++) await profile(`custom-${i}`,{name:`Custom ${i}`,services:[{code:'x',name:'X',rate:flat(100)}]});
  assert.equal((await state(h)).shipping.profiles.length,100);
  await h.command('shipping.profile.save',{id:'one-too-many',value:{name:'One too many',services:[{code:'x',name:'X',rate:flat(100)}]}},{status:409});

  // Profiles, places and assignments travel in the archive and the business export.
  const records=await h.api('/api/stall/exports/records');
  assert.ok(records.shipping.profiles.length>=100&&records.shipping.assignments.STICKERS==='stickers'&&records.shipping.places.pickup.value.name==='Studio');
  destination=await installation({bindings:{PIER_ORIGIN:'https://stock.example.test',PIER_SESSION:'test-stock-network-edge',PIER_CUSTOMER_ID:'shop',STRIPE_SECRET_KEY:'test-network-edge',STRIPE_WEBHOOK_SECRET:secret},outboundService:edge.handle});
  await restore(destination,await archive(h));
  const restored=(await state(destination)).shipping;
  assert.equal(restored.profiles.length,100);assert.equal(restored.assignments.STICKERS,'stickers');assert.equal(restored.places.delivery.value.feeCents,1500);
  assert.equal(money(await quote(destination,[['TEE'],['STICKERS']],'10001'),'ups-ground'),600);
 }finally{if(destination)await destination.close();await h.close()}
});
