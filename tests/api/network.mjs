import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
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
  calls.push({path:url.pathname,method:request.method});
  if(request.method==='GET') {
   if(url.pathname==='/v1/balance') return Response.json({object:'balance'});
   const id=decodeURIComponent(url.pathname.split('/').at(-1));
   const value=sessions.get(id)??refunds.get(id);
   return value?Response.json(value):Response.json({error:'missing'},{status:404});
  }
  const key=request.headers.get('idempotency-key'),form=new URLSearchParams(await request.text());
  assert.ok(key);
  if(writes.has(key)) { const saved=writes.get(key);assert.equal(saved.body,form.toString());return Response.json(saved.value); }
  let value;
  if(url.pathname==='/v1/checkout/sessions') {
   assert.equal(form.get('mode'),'payment');
   assert.equal(form.get('shipping_address_collection[allowed_countries][0]'),'US');
   assert.ok(![...form.keys()].some(k=>/card|payment_method_data/.test(k)));
   let total=0;
   for(let i=0;form.has(`line_items[${i}][quantity]`);i++) {
    assert.equal(form.get(`line_items[${i}][price_data][currency]`),'usd');
    total+=Number(form.get(`line_items[${i}][quantity]`))*Number(form.get(`line_items[${i}][price_data][unit_amount]`));
   }
   const id='cs_test_'+randomUUID().replaceAll('-','');
   value={id,object:'checkout.session',mode:'payment',client_reference_id:form.get('client_reference_id'),metadata:{stall_order_id:form.get('metadata[stall_order_id]')},amount_total:total,currency:'usd',status:'open',payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+id};
   sessions.set(id,value);
  } else if(url.pathname==='/v1/refunds') {
   const intent=form.get('payment_intent'),amount=Number(form.get('amount'));
   const paid=[...sessions.values()].find(s=>s.payment_intent===intent);
   assert.ok(paid);
   const existing=[...refunds.values()].filter(r=>r.payment_intent===intent&&r.status!=='failed').reduce((n,r)=>n+r.amount,0);
   assert.ok(existing+amount<=paid.amount_total);
   const id='re_'+randomUUID().replaceAll('-','');
   value={id,object:'refund',payment_intent:intent,amount,currency:'usd',metadata:{stall_order_id:form.get('metadata[stall_order_id]'),stall_refund_id:form.get('metadata[stall_refund_id]')},status:'succeeded'};
   refunds.set(id,value);
  } else assert.fail('Unexpected Stripe API request '+url.pathname);
  writes.set(key,{body:form.toString(),value});
  if(url.pathname==='/v1/checkout/sessions'&&loseCheckoutResponse) {loseCheckoutResponse=false;return Response.json({error:'response lost'},{status:503});}
  if(url.pathname==='/v1/refunds'&&loseRefundResponse) {loseRefundResponse=false;return Response.json({error:'response lost'},{status:503});}
  return Response.json(value);
 }
 function pay(id) {
  const s=sessions.get(id);assert.ok(s);
  Object.assign(s,{status:'complete',payment_status:'paid',payment_intent:'pi_'+randomUUID().replaceAll('-',''),collected_information:{shipping_details:{name:'Test Customer',address:{line1:'1 Maker Lane',line2:null,city:'Austin',state:'TX',postal_code:'78702',country:'US'}}}});
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
