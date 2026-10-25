import assert from 'node:assert/strict'
// Stripe's HTTP boundary only. Calculations have no top-level metadata;
// original-intent correlation lives on calculation line items.
export function taxEdge() {
 const calculations=new Map(),transactions=new Map(),calls=[]
 let fault=null,ready=true,registered=true,malformed=false
 const edge={calculations,transactions,calls,transactionTime:1791000000,set fault(value){fault=value},set ready(value){ready=value},set registered(value){registered=value},set malformed(value){malformed=value},async handle(request) {
  const url=new URL(request.url);assert.equal(url.origin,'https://api.stripe.com')
  calls.push({path:url.pathname,method:request.method})
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-stall-806')
  if(fault==='credential')return Response.json({error:'synthetic-stall-key-refused'},{status:403})
  if(fault==='offline')return Response.json({error:'synthetic-stall-provider-failure'},{status:503})
  if(url.pathname==='/v1/account')return Response.json({id:'acct_syntheticstall806',country:'US'})
  if(url.pathname==='/v1/tax/settings')return Response.json({status:ready?'active':'pending',head_office:{address:ready?{line1:'synthetic-stall-head-office'}:{}},defaults:{tax_code:ready?'txcd_99999999':null}})
  if(url.pathname==='/v1/tax/registrations')return Response.json({object:'list',has_more:false,data:registered?['TX','CA'].map(state=>({id:'synthetic-stall-registration-'+state,status:'active',country:'US',country_options:{us:{state}}})):[]})
  if(url.pathname.startsWith('/v1/tax/transactions')) {
   if(request.method==='GET') {
    const id=url.pathname.split('/')[4],value=transactions.get(id)
    if(!value)return Response.json({error:'missing'},{status:404})
    return Response.json(url.pathname.endsWith('/line_items')?{object:'list',has_more:false,data:value.line_items.data}:value)
   }
   const form=new URLSearchParams(await request.text()),sale=url.pathname.endsWith('/create_from_calculation')
   const original=sale?calculations.get(form.get('calculation')):transactions.get(form.get('original_transaction'))
   assert.ok(original,'tax writes reference original provider evidence')
   const id='tax_'+String(transactions.size+1),items=sale?original.items.map(({tax_breakdown,...item},index)=>({...item,id:'tax_li_'+(transactions.size+1)+'x'+index})):[]
   if(!sale)for(let i=0;form.has(`line_items[${i}][amount]`);i++) {
    const field=key=>form.get(`line_items[${i}][${key}]`),source=original.line_items.data.find(item=>item.id===field('original_line_item'))
    assert.ok(source);items.push({...source,id:'tax_li_'+(transactions.size+1)+'x'+i,amount:Number(field('amount')),amount_tax:Number(field('amount_tax')),quantity:Number(field('quantity')??1),reference:field('reference'),reversal:{original_line_item:source.id}})
   }
   const {tax_breakdown,...saleShipping}=sale?original.calculation.shipping_cost:{}
   const value={id,object:'tax.transaction',livemode:false,currency:'usd',type:sale?'transaction':'reversal',reference:form.get('reference'),tax_date:edge.transactionTime,posted_at:edge.transactionTime,created:edge.transactionTime,customer_details:sale?original.calculation.customer_details:original.customer_details,ship_from_details:sale?original.calculation.ship_from_details:original.ship_from_details,line_items:{object:'list',has_more:false,data:items},...(sale?{calculation:original.calculation.id,shipping_cost:saleShipping}:{reversal:{original_transaction:original.id},shipping_cost:{amount:Number(form.get('shipping_cost[amount]')??0),amount_tax:Number(form.get('shipping_cost[amount_tax]')??0)}})}
   transactions.set(id,value)
   if(fault===(sale?'lost-sale':'lost-reversal')) {fault=null;return Response.json({error:'synthetic-stall-lost-response'},{status:503})}
   return Response.json(value)
  }
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
   items.push({id:'tax_li_'+i,object:'tax.calculation_line_item',livemode:false,reference:field('reference'),amount,quantity:Number(field('quantity')),tax_code:code,tax_behavior:'exclusive',metadata:{stall_tax_preview_id:form.get(`line_items[${i}][metadata][stall_tax_preview_id]`),stall_tax_intent:form.get(`line_items[${i}][metadata][stall_tax_intent]`),stall_quote_id:form.get(`line_items[${i}][metadata][stall_quote_id]`),stall_intent:form.get(`line_items[${i}][metadata][stall_intent]`)}})
  }
  // Test-only address-dependent rates distinguish the same ZIP's streets.
  const rate=destination.state==='CA'?8.25:destination.line1==='2 synthetic-stall-street'?7.5:6.25,tax=Math.round(taxable*rate/100)
  const calculation={id,object:'tax.calculation',livemode:false,currency:'usd',customer_details:{address:destination,address_source:'shipping'},ship_from_details:{address:shipFrom},shipping_cost:{amount:Number(form.get('shipping_cost[amount]')),tax_behavior:'exclusive'},expires_at:1900000000,amount_total:subtotal+tax,tax_amount_exclusive:malformed?tax+1:tax,tax_amount_inclusive:0,tax_breakdown:[{amount:tax,inclusive:false,taxable_amount:taxable,tax_rate_details:{country:'US',state:destination.state,percentage_decimal:String(rate),tax_type:'sales_tax'},taxability_reason:'standard_rated'}]}
  if(form.has('expand[]')) {
   const exempt=form.get('customer_details[taxability_override]')==='customer_exempt'
   if(exempt)calculation.customer_details.taxability_override='customer_exempt'
   const rates=destination.state==='CA'?[['state','California',6],['county','Los Angeles County',0.25],['city','Los Angeles',1],['district','County transportation district',1]]:[['state','Texas',6.25],['county','Travis County',0.5],['city','Austin',destination.line1==='2 synthetic-stall-street'?2:1],['district','Capital transit district',0.5]]
   const details=(amount,nonTaxable=false)=>rates.map(([level,name,percent])=>({amount:exempt||nonTaxable?0:Math.round(amount*percent/100),inclusive:false,taxable_amount:exempt||nonTaxable?0:amount,taxability_reason:exempt?'customer_exempt':nonTaxable?'not_subject_to_tax':'standard_rated',jurisdiction:{level,display_name:name,country:'US',state:destination.state},tax_rate_details:{country:'US',state:destination.state,percentage_decimal:String(percent),tax_type:'sales_tax'}}))
   for(const item of items){item.tax_breakdown=details(item.amount,item.tax_code==='txcd_00000000');item.amount_tax=item.tax_breakdown.reduce((n,b)=>n+b.amount,0)}
   calculation.shipping_cost.tax_breakdown=details(calculation.shipping_cost.amount);calculation.shipping_cost.amount_tax=calculation.shipping_cost.tax_breakdown.reduce((n,b)=>n+b.amount,0)
   calculation.tax_amount_exclusive=items.reduce((n,item)=>n+item.amount_tax,calculation.shipping_cost.amount_tax);calculation.amount_total=subtotal+calculation.tax_amount_exclusive
   calculation.tax_breakdown=rates.map((_,i)=>({...items[0].tax_breakdown[i],amount:items.reduce((n,item)=>n+item.tax_breakdown[i].amount,calculation.shipping_cost.tax_breakdown[i].amount),taxable_amount:items.reduce((n,item)=>n+item.tax_breakdown[i].taxable_amount,calculation.shipping_cost.tax_breakdown[i].taxable_amount)}))
  }
  calculations.set(id,{calculation,items})
  if(fault==='lost'){fault=null;return Response.json({error:'synthetic-stall-lost-response'},{status:503})}
  return Response.json(calculation)
 }}
 return edge
}
