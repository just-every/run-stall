import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
// Only Stripe is simulated. Pier requests are forwarded to the real fixture Worker.
export function stripeEdge({forward}={}) {
 const sessions=new Map(),refunds=new Map(),writes=new Map();
 let loseCheckoutResponse=false,loseRefundResponse=false,losePierType=null;
 const pierCalls=[];
 const calls=[];
 async function handle(request) {
  const url=new URL(request.url);
  if(url.hostname!=='api.stripe.com') {
   const command=url.pathname==='/api/pier/commands'&&request.method==='POST'?await request.clone().json():null;
   if(command) pierCalls.push({type:command.type,commandId:command.commandId});
   if(forward) {
    const response=await forward(request);
    if(command?.type===losePierType&&response.ok) {losePierType=null;return Response.json({error:'response lost'},{status:503});}
    return response;
   }
   const headers=Object.fromEntries([...request.headers].filter(([name])=>!['connection','transfer-encoding','content-length','host','expect'].includes(name)));
   const response=await fetch(request.url,{method:request.method,headers,...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()})});
   if(command?.type===losePierType&&response.ok) {losePierType=null;return Response.json({error:'response lost'},{status:503});}
   return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});
  }
  assert.match(request.headers.get('authorization'),/^Bearer /);
  calls.push({path:url.pathname,method:request.method,query:url.search});
  if(request.method==='GET') {
   if(url.pathname==='/v1/balance') return Response.json({object:'balance',available:[],pending:[]});
   if(['/v1/checkout/sessions','/v1/refunds'].includes(url.pathname)) {
    let values=[...(url.pathname==='/v1/refunds'?refunds:sessions).values()].reverse();
    if(url.searchParams.has('payment_intent'))values=values.filter(value=>value.payment_intent===url.searchParams.get('payment_intent'));
    if(url.searchParams.has('created[gte]'))values=values.filter(value=>value.created>=Number(url.searchParams.get('created[gte]')));
    if(url.searchParams.has('starting_after')){const at=values.findIndex(value=>value.id===url.searchParams.get('starting_after'));assert.ok(at>=0);values=values.slice(at+1);}
    const limit=Number(url.searchParams.get('limit')??10);
    return Response.json({object:'list',has_more:values.length>limit,data:values.slice(0,limit)});
   }
   const id=decodeURIComponent(url.pathname.split('/').at(-1));
   const value=sessions.get(id)??refunds.get(id);
   return value?Response.json(value):Response.json({error:'missing'},{status:404});
  }
  const key=request.headers.get('idempotency-key'),form=new URLSearchParams(await request.text());
  assert.ok(![...form.keys()].some(k=>/application_fee|transfer_data|on_behalf_of/.test(k)),'Stall must not add an author fee or route money to an author account');
  assert.ok(key);
  if(writes.has(key)) { const saved=writes.get(key);assert.equal(saved.body,form.toString());return Response.json(saved.value); }
  let value;
  if(url.pathname==='/v1/checkout/sessions') {
   assert.equal(form.get('mode'),'payment');
   // A free pickup collects no shipping address; every shipped order collects a US one.
   assert.ok(form.get('shipping_address_collection[allowed_countries][0]')==='US'||!form.has('shipping_options[0][shipping_rate_data][fixed_amount][amount]'));
   assert.ok(![...form.keys()].some(k=>/card|payment_method_data/.test(k)));
   let total=0;
   for(let i=0;form.has(`line_items[${i}][quantity]`);i++) {
    assert.equal(form.get(`line_items[${i}][price_data][currency]`),'usd');
    total+=Number(form.get(`line_items[${i}][quantity]`))*Number(form.get(`line_items[${i}][price_data][unit_amount]`));
   }
   total+=Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')??0);
   const id='cs_test_'+randomUUID().replaceAll('-','');
   value={id,created:Math.floor(Date.now()/1000),object:'checkout.session',mode:'payment',shipping_address_collection:form.has('shipping_address_collection[allowed_countries][0]')?{allowed_countries:['US']}:null,client_reference_id:form.get('client_reference_id'),metadata:{stall_order_id:form.get('metadata[stall_order_id]')},amount_total:total,total_details:{amount_shipping:Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')??0)},currency:'usd',status:'open',payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+id};
   sessions.set(id,value);
  } else if(url.pathname==='/v1/refunds') {
   const intent=form.get('payment_intent'),amount=Number(form.get('amount'));
   const paid=[...sessions.values()].find(s=>s.payment_intent===intent);
   assert.ok(paid);
   const existing=[...refunds.values()].filter(r=>r.payment_intent===intent&&r.status!=='failed').reduce((n,r)=>n+r.amount,0);
   assert.ok(existing+amount<=paid.amount_total);
   const id='re_'+randomUUID().replaceAll('-','');
   value={id,created:Math.floor(Date.now()/1000),object:'refund',payment_intent:intent,amount,currency:'usd',metadata:{stall_order_id:form.get('metadata[stall_order_id]'),stall_refund_id:form.get('metadata[stall_refund_id]')},status:'succeeded'};
   refunds.set(id,value);
  } else assert.fail('Unexpected Stripe API request '+url.pathname);
  writes.set(key,{body:form.toString(),value});
  if(url.pathname==='/v1/checkout/sessions'&&loseCheckoutResponse) {loseCheckoutResponse=false;return Response.json({error:'response lost'},{status:503});}
  if(url.pathname==='/v1/refunds'&&loseRefundResponse) {loseRefundResponse=false;return Response.json({error:'response lost'},{status:503});}
  return Response.json(value);
 }
 function pay(id,address={line1:'1 Maker Lane',line2:null,city:'Austin',state:'TX',postal_code:'78702',country:'US'}) {
  const s=sessions.get(id);assert.ok(s);
  Object.assign(s,{status:'complete',payment_status:'paid',payment_intent:'pi_'+randomUUID().replaceAll('-',''),collected_information:{shipping_details:{name:'Test Customer',address}}});
  return s;
 }
 return {handle,sessions,refunds,calls,pierCalls,pay,loseNextPierResponse(type){losePierType=type;},loseNextCheckoutResponse(){loseCheckoutResponse=true;},loseNextRefundResponse(){loseRefundResponse=true;}};
}
export async function deliverWebhook(h,secret,session,{id='evt_'+randomUUID().replaceAll('-',''),timestamp=Math.floor(Date.now()/1000),type='checkout.session.completed',signatureBody,bodySuffix=''}={}) {
 const event={id,object:'event',type,data:{object:session}},body=JSON.stringify(event)+bodySuffix;
 const signature=createHmac('sha256',secret).update(`${timestamp}.${signatureBody??body}`).digest('hex');
 const response=await h.mf.dispatchFetch(h.origin+'/api/stall/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body});
 return {response,value:await response.json(),id};
}
export async function publish(h,sku,name,unitCents) {
 let value=await h.command('product.prepare',{sku,name,description:'Made in Australia',unitCents,active:true});
 return h.command('product.approve',{sku,revision:value.revision});
}
export async function purchase(h,edge,{skus=['MUG-BLUE','TOWEL-NAT'],email='customer@example.test',quantities=[1,1],key=randomUUID(),expectedTotalCents}={}) {
 const value=await h.api('/api/stall/checkout',{customerEmail:email,lines:skus.map((sku,i)=>({sku,quantity:quantities[i]})),idempotencyKey:key,...(expectedTotalCents!==undefined?{expectedTotalCents}:{})},{as:''});
 const session=[...edge.sessions.values()].find(s=>s.client_reference_id===value.orderId);
 assert.ok(session);
 return {...value,session,key};
}
/** Send raw bytes to a door that takes a file body (the harness's request helper sends JSON). */
export function sendFile(h,path,bytes,type,{as=h.cookie,origin=h.origin,method='POST'}={}) {
 return h.mf.dispatchFetch(h.origin+path,{method,redirect:'manual',headers:{host:new URL(h.origin).host,'content-type':type,...(origin?{origin}:{}),...(as?{cookie:as}:{})},body:bytes});
}
export const png=(size=64,fill=1)=>Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(size,fill)]);
export const pdf=(size=64)=>Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(size,32)]);
/** A valid solid-colour PNG, for journeys whose screenshots should show real pictures. */
export function solidPng(width,height,[red,green,blue]) {
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(zlib.crc32(body));return Buffer.concat([length,body,crc])};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const row=Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:width},()=>[red,green,blue]).flat())]);
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),chunk('IEND',Buffer.alloc(0))]);
}
