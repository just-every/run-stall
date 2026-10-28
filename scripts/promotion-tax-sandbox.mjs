// Opt-in test-mode provider journey. Payment stays on the Stripe edge fake;
// Stripe Tax alone receives the explicit test addresses and net line amounts.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { taxCommerceInstallation } from '../tests/api/tax-commerce.mjs'
const key=process.env.STRIPE_SECRET_KEY
if(!/^(?:sk|rk)_test_/.test(key??''))throw Error('A held Stripe test-mode key is required')
const calls=[],tax={async handle(request){const url=new URL(request.url),headers=Object.fromEntries([...request.headers].filter(([name])=>!['connection','transfer-encoding','content-length','host','expect'].includes(name))),response=await fetch(request.url,{method:request.method,headers,...(request.method==='GET'?{}:{body:await request.arrayBuffer()})}),bytes=await response.arrayBuffer();calls.push({method:request.method,path:url.pathname,status:response.status,requestId:response.headers.get('request-id')});return new Response(bytes,{status:response.status,headers:Object.fromEntries(response.headers)})}}
const shipFrom={line1:'354 Oyster Point Blvd',city:'South San Francisco',state:'CA',postal_code:'94080',country:'US'},destination={line1:'400 Spring Street',city:'Los Angeles',state:'CA',postal_code:'90013',country:'US'}
const kit=await taxCommerceInstallation({tax,key,shipFrom,thresholdState:'CA'}),{h}=kit,receipt={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:'Stripe Tax test only; payments use the network-edge fake',cases:[]}
try{
 await h.command('collection.save',{handle:'synthetic-stall-sandbox-mugs',title:'Mugs',description:'Test collection',kind:'manual',skus:['MUG-BLUE']})
 const cases=[
  {type:'product',targets:{skus:['MUG-BLUE']},benefit:{kind:'percentage',value:10},amounts:[1800,500]},
  {type:'product',targets:{products:['MUG-BLUE']},benefit:{kind:'amount',value:333},amounts:[1667,500]},
  {type:'product',targets:{collections:['synthetic-stall-sandbox-mugs']},benefit:{kind:'percentage',value:25},amounts:[1500,500]},
  {type:'product',targets:{collections:['synthetic-stall-sandbox-mugs']},benefit:{kind:'amount',value:101},amounts:[1899,500]},
  {type:'order',benefit:{kind:'amount',value:101},amounts:[1919,480]},
  {type:'order',benefit:{kind:'percentage',value:10},amounts:[1800,450]},
  {type:'buy_get',targets:{skus:['MUG-BLUE']},buy:{targets:{skus:['MUG-BLUE']},quantity:1,getQuantity:1,maxUses:1},benefit:{kind:'percentage',value:100},amounts:[1000,500]},
  {type:'buy_get',targets:{skus:['TOWEL-NAT']},buy:{targets:{skus:['MUG-BLUE']},spendCents:2000,getQuantity:1,maxUses:1},benefit:{kind:'amount',value:250},amounts:[2000,250]},
  {type:'shipping',minimum:5000,lines:[{sku:'MUG-BLUE',quantity:5},{sku:'TOWEL-NAT',quantity:1}],amounts:[5000,500]},
 ]
 let n=0
 for(const mode of ['code','automatic'])for(const entry of cases){
  const {amounts,minimum=0,lines,...rule}=entry,code='SYNTHETIC-STALL-SANDBOX-'+(++n),promotion=await h.api('/api/stall/promotions',{code,rule:{mode,...rule},startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:minimum,maxUsesPerCustomer:100,maxTotalUses:100,maxDiscountCents:100000})
  const quote=await kit.quote({destination,...(lines?{lines}:{}),...(mode==='code'?{promotionCode:code}:{})})
  const review=await h.api('/api/stall/promotions/quote',{lines:quote.input.lines,customerEmail:quote.input.customerEmail,shipping:quote.input.shipping,...(mode==='code'?{promotionCode:code}:{})},{as:''})
  const expectedShipping=entry.type==='shipping'?0:200,net=amounts.reduce((n,v)=>n+v,expectedShipping)
  assert.equal(review.totalCents,net);assert.equal(quote.result.totalCents,net+quote.result.taxCents);assert.ok(quote.result.taxCents>0)
  const facts={mode,type:entry.type,calculationId:quote.result.calculationId,lineAmountsCents:amounts,shippingCents:expectedShipping,taxCents:quote.result.taxCents,totalCents:quote.result.totalCents}
  if(n===5){const sale=await kit.buy(quote);assert.equal(sale.session.amount_total,quote.result.totalCents);assert.deepEqual(sale.order.tax.lines.map(l=>l.amount),[1919,480]);assert.ok(sale.order.tax.transactionId);await kit.ship(sale.order.id);const refunded=await kit.refund(sale.order.id),refund=refunded.refunds.at(-1);assert.equal(refund.taxAllocation.lines[0].amount,960);assert.equal(refund.amountCents,960+refund.taxAllocation.taxCents);assert.ok(refund.taxReversalId);const report=await h.api('/api/stall/promotions/report?promotionId='+promotion.id);assert.equal(report.campaign.totals.taxCents,sale.order.tax.taxCents);assert.equal(report.campaign.totals.refundTaxCents,refund.taxAllocation.taxCents);facts.sale={transactionId:sale.order.tax.transactionId,refundId:refund.taxReversalId,refundedCents:refund.amountCents,refundTaxCents:refund.taxAllocation.taxCents}}
  receipt.cases.push(facts);await h.api('/api/stall/promotions/revoke',promotion)
 }
 receipt.providerCalls=calls;assert.ok(calls.every(c=>c.status===200));console.log(JSON.stringify(receipt,null,2))
}catch(error){console.error(JSON.stringify({providerCalls:calls}));throw error}finally{await kit.close()}
