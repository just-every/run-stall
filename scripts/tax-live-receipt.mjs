// Sandbox receipt for TAX-001: drives the real Worker through the owner preview, a taxed test-mode sale and a
// partial line refund while the Stripe Tax calls reach the actual Stripe test API. Payment stays on the local
// Stripe fake. Run with the held US test key injected as STRIPE_SECRET_KEY; only ids are printed, never a key.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readCsv } from '../tests/api/csv-reader.mjs'
import { taxCommerceInstallation } from '../tests/api/tax-commerce.mjs'

const key=process.env.STRIPE_SECRET_KEY
if(!/^(?:sk|rk)_test_/.test(key??''))throw Error('Set STRIPE_SECRET_KEY to a Stripe test-mode key')
const requests=[]
const tax={async handle(request) {
 const url=new URL(request.url)
 const headers=Object.fromEntries([...request.headers].filter(([name])=>!['connection','transfer-encoding','content-length','host','expect'].includes(name)))
 const response=await fetch(request.url,{method:request.method,headers,...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()})})
 const body=await response.arrayBuffer()
 requests.push({method:request.method,path:url.pathname,status:response.status,requestId:response.headers.get('request-id')})
 return new Response(body,{status:response.status,headers:Object.fromEntries(response.headers)})
}}
const shipFrom={line1:'354 Oyster Point Blvd',city:'South San Francisco',state:'CA',postal_code:'94080',country:'US'}
const sanFrancisco={line1:'510 Townsend Street',city:'San Francisco',state:'CA',postal_code:'94103',country:'US'}
const losAngeles={line1:'400 Spring Street',city:'Los Angeles',state:'CA',postal_code:'90013',country:'US'}
const seattle={line1:'400 Broad Street',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}
const redwoodCity={line1:'2250 Middlefield Road',city:'Redwood City',state:'CA',postal_code:'94063',country:'US'}
const fairOaks={line1:'2800 Fair Oaks Avenue',city:'Redwood City',state:'CA',postal_code:'94063',country:'US'}
const kit=await taxCommerceInstallation({tax,key,shipFrom,thresholdState:'CA'}),{h}=kit
const receipt={}
try {
 const readiness=await h.api('/api/stall/tax/readiness');assert.ok(['CA','WA'].every(state=>readiness.states.includes(state)),'the US account has active California and Washington registrations')
 receipt.registeredStates=readiness.states;receipt.accountId=readiness.boundary.accountId
 const boundary=await h.api('/api/stall/tax/boundary')
 const preview=await h.api('/api/stall/tax/preview',{id:randomUUID(),consent:boundary.consent,destination:sanFrancisco,shipFrom,lines:[{reference:'synthetic-stall-taxable',unitCents:1000,quantity:2,taxCode:'txcd_99999999'},{reference:'synthetic-stall-exempt',unitCents:500,quantity:1,taxCode:'txcd_00000000'}],shippingCents:200})
 assert.equal(preview.previewOnly,true);assert.ok(preview.taxCents>0)
 receipt.preview={calculationId:preview.providerId??preview.calculationId,taxCents:preview.taxCents,totalCents:preview.totalCents,jurisdictions:preview.breakdown?.length}
 const [first,second]=[await kit.quote({destination:redwoodCity}),await kit.quote({destination:fairOaks})]
 assert.notEqual(first.result.taxCents,second.result.taxCents,'two addresses in one ZIP code are charged their own address-level rate')
 receipt.sameZip=[first,second].map(q=>({zip:q.input.destination.postal_code,street:q.input.destination.line1,calculationId:q.result.calculationId,taxCents:q.result.taxCents,jurisdictions:q.result.jurisdictions.length}))
 const washington=await kit.buy(await kit.quote({destination:seattle}));assert.ok(washington.order.tax.transactionId&&washington.order.tax.taxCents>0)
 receipt.washingtonSale={orderId:washington.order.id,calculationId:washington.order.tax.calculationId,transactionId:washington.order.tax.transactionId,taxCents:washington.order.tax.taxCents,levels:[...new Set(washington.order.tax.lines.flatMap(l=>l.jurisdictions.map(j=>j.level)))]}
 const customerEmail='synthetic-stall-exempt@example.test',native=await h.signIn(customerEmail)
 const evidence=await h.api('/api/stall/tax/exemptions',{customerEmail,state:'CA',evidenceReference:'Certificate reviewed by merchant 2026-18',expiresOn:'2035-12-31'})
 const guest=await kit.quote({customerEmail,destination:losAngeles}),exempt=await kit.quote({customerEmail,destination:losAngeles,as:native})
 assert.ok(guest.result.taxCents>0&&!guest.result.exempt);assert.equal(exempt.result.taxCents,0);assert.equal(exempt.result.exempt,true)
 const exemptSale=await kit.buy(exempt,{as:native});assert.equal(exemptSale.order.tax.taxCents,0);assert.ok(exemptSale.order.tax.transactionId)
 receipt.exemptSale={evidenceId:evidence.id,guestTaxCents:guest.result.taxCents,exemptCalculationId:exempt.result.calculationId,transactionId:exemptSale.order.tax.transactionId}
 await h.api('/api/stall/promotions',{code:'SYNTHETIC-STALL-TAX-SHIP',startsAt:'2000-01-01T00:00:00Z',endsAt:'2100-01-01T00:00:00Z',minimumBasketCents:0,maxUsesPerCustomer:5,maxTotalUses:10,maxShippingDiscountCents:2000})
 const full=await kit.quote({destination:seattle}),discounted=await kit.quote({destination:seattle,promotionCode:'SYNTHETIC-STALL-TAX-SHIP'})
 assert.ok(discounted.result.taxCents<full.result.taxCents,'tax consumes the discounted shipping amount exactly once')
 receipt.discountedShipping={fullCalculationId:full.result.calculationId,fullTaxCents:full.result.taxCents,discountedCalculationId:discounted.result.calculationId,discountedTaxCents:discounted.result.taxCents,discountedTotalCents:discounted.result.totalCents}
 const sale=await kit.buy(await kit.quote({destination:losAngeles}))
 const t=sale.order.tax;assert.ok(t.transactionId&&t.taxCents>0)
 assert.equal(sale.order.totalCents,sale.session.amount_total)
 receipt.sale={orderId:sale.order.id,calculationId:t.calculationId,transactionId:t.transactionId,taxCents:t.taxCents,totalCents:sale.order.totalCents,jurisdictions:t.jurisdictions?.map(j=>`${j.level}:${j.name}:${j.ratePercent}:${j.amountCents}`)}
 await kit.ship(sale.order.id)
 const refunded=await kit.refund(sale.order.id),refund=refunded.refunds[0]
 assert.equal(refund.status,'succeeded');assert.ok(refund.taxReversalId)
 receipt.refund={refundId:refund.id,reversalId:refund.taxReversalId,amountCents:refund.amountCents,taxCents:refund.taxAllocation.taxCents}
 const today=new Date(Date.now()-864e5*2).toISOString().slice(0,10),end=new Date(Date.now()+864e5*2).toISOString().slice(0,10)
 const liability=await h.api(`/api/stall/tax/liability?from=${today}&to=${end}`)
 assert.equal(liability.totals.taxCents,t.taxCents+washington.order.tax.taxCents-refund.taxAllocation.taxCents,'the report nets both sales and the reversal exactly')
 assert.equal(liability.totals.unallocatedTaxCents,0,'the reversal is attributed over the original provider jurisdictions')
 assert.deepEqual(liability.states.map(row=>row.state),['CA','WA'])
 assert.ok(liability.transactions.some(row=>row.id===t.transactionId)&&liability.transactions.some(row=>row.id===refund.taxReversalId))
 for(const level of ['state','jurisdiction','transaction']) {
  const rows=readCsv(await (await h.request(`/api/stall/tax/liability.csv?from=${today}&to=${end}&level=${level}`)).text())
  assert.equal(rows.reduce((sum,row)=>sum+Number(row.taxCents),0),liability.totals.taxCents,level+' export reconciles to the report')
  if(level==='transaction')assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([t.transactionId,washington.order.tax.transactionId,exemptSale.order.tax.transactionId,refund.taxReversalId]))
  receipt['csv_'+level]=rows.length
 }
 const nexus=await h.api(`/api/stall/tax/nexus?from=${today}&to=${end}`)
 receipt.liability={grossSalesCents:liability.totals.grossSalesCents,taxCents:liability.totals.taxCents,refundTaxCents:liability.totals.refundTaxCents,unallocatedTaxCents:liability.totals.unallocatedTaxCents,levels:[...new Set(liability.jurisdictions.map(j=>j.level))],california:nexus.states.find(s=>s.state==='CA')}
 receipt.providerRequests=requests.filter(r=>r.method==='POST').map(r=>`${r.method} ${r.path} ${r.status} ${r.requestId}`)
 assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.status===200),'every Stripe Tax write succeeded')
 assert.ok(!JSON.stringify(receipt).includes(key))
 console.log(JSON.stringify(receipt,null,1))
} catch(error) {console.error(JSON.stringify(requests,null,1));throw error} finally {await kit.close()}
