import assert from 'node:assert/strict'
// Stripe's HTTP boundary only. Calculations have no top-level metadata;
// original-intent correlation lives on calculation line items.
export function taxEdge() {
 const calculations=new Map(),calls=[]
 let fault=null,ready=true,registered=true,malformed=false
 const edge={calculations,calls,set fault(value){fault=value},set ready(value){ready=value},set registered(value){registered=value},set malformed(value){malformed=value},async handle(request) {
  const url=new URL(request.url);assert.equal(url.origin,'https://api.stripe.com')
  calls.push({path:url.pathname,method:request.method})
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-stall-806')
  if(fault==='credential')return Response.json({error:'synthetic-stall-key-refused'},{status:403})
  if(fault==='offline')return Response.json({error:'synthetic-stall-provider-failure'},{status:503})
  if(url.pathname==='/v1/account')return Response.json({id:'acct_syntheticstall806',country:'US'})
  if(url.pathname==='/v1/tax/settings')return Response.json({status:ready?'active':'pending',head_office:{address:ready?{line1:'synthetic-stall-head-office'}:{}},defaults:{tax_code:ready?'txcd_99999999':null}})
  if(url.pathname==='/v1/tax/registrations')return Response.json({object:'list',has_more:false,data:registered?['TX','CA'].map(state=>({id:'synthetic-stall-registration-'+state,status:'active',country:'US',country_options:{us:{state}}})):[]})
  if(request.method==='GET') {
   const id=url.pathname.split('/')[4],value=calculations.get(id)
   if(!value)return Response.json({error:'missing'},{status:404})
   if(url.pathname.endsWith('/line_items'))return Response.json({object:'list',has_more:false,data:value.items})
   return Response.json(value.calculation)
  }
  assert.equal(url.pathname,'/v1/tax/calculations');assert.ok(request.headers.get('idempotency-key'))
  const form=new URLSearchParams(await request.text());assert.ok(![...form.keys()].some(key=>key.startsWith('metadata[')))
  assert.equal(form.get('currency'),'usd');assert.equal(form.get('customer_details[address_source]'),'shipping')
  const address=prefix=>Object.fromEntries(['line1','line2','city','state','postal_code','country'].flatMap(key=>form.has(prefix+`[${key}]`)?[[key,form.get(prefix+`[${key}]`)]]:[]))
  const destination=address('customer_details[address]'),shipFrom=address('ship_from_details[address]')
  assert.ok(destination.line1&&shipFrom.line1)
  const id='taxcalc_'+String(calculations.size+1),items=[]
  let subtotal=Number(form.get('shipping_cost[amount]')),taxable=subtotal
  for(let i=0;form.has(`line_items[${i}][amount]`);i++) {
   const field=key=>form.get(`line_items[${i}][${key}]`),amount=Number(field('amount')),code=field('tax_code')
   assert.equal(field('tax_behavior'),'exclusive');assert.match(code,/^txcd_\d{8}$/)
   subtotal+=amount;if(code!=='txcd_00000000')taxable+=amount
   items.push({id:'tax_li_'+i,object:'tax.calculation_line_item',livemode:false,reference:field('reference'),amount,quantity:Number(field('quantity')),tax_code:code,tax_behavior:'exclusive',metadata:{stall_tax_preview_id:form.get(`line_items[${i}][metadata][stall_tax_preview_id]`),stall_tax_intent:form.get(`line_items[${i}][metadata][stall_tax_intent]`)}})
  }
  // Test-only address-dependent rates distinguish the same ZIP's streets.
  const rate=destination.state==='CA'?8.25:destination.line1==='2 synthetic-stall-street'?7.5:6.25,tax=Math.round(taxable*rate/100)
  const calculation={id,object:'tax.calculation',livemode:false,currency:'usd',customer_details:{address:destination,address_source:'shipping'},ship_from_details:{address:shipFrom},shipping_cost:{amount:Number(form.get('shipping_cost[amount]')),tax_behavior:'exclusive'},expires_at:1900000000,amount_total:subtotal+tax,tax_amount_exclusive:malformed?tax+1:tax,tax_amount_inclusive:0,tax_breakdown:[{amount:tax,inclusive:false,taxable_amount:taxable,tax_rate_details:{country:'US',state:destination.state,percentage_decimal:String(rate),tax_type:'sales_tax'},taxability_reason:'standard_rated'}]}
  calculations.set(id,{calculation,items})
  if(fault==='lost'){fault=null;return Response.json({error:'synthetic-stall-lost-response'},{status:503})}
  return Response.json(calculation)
 }}
 return edge
}
