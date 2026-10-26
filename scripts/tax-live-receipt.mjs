// Sandbox receipt for TAX-001: drives the real Worker through the owner preview, a taxed test-mode sale and a
// partial line refund while the Stripe Tax calls reach the actual Stripe test API. Payment stays on the local
// Stripe fake. Run with the held US test key injected as STRIPE_SECRET_KEY; only ids are printed, never a key.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
const kit=await taxCommerceInstallation({tax,key,shipFrom,thresholdState:'CA'}),{h}=kit
const receipt={}
try {
 const readiness=await h.api('/api/stall/tax/readiness');assert.ok(readiness.states.includes('CA'),'the US account has an active California registration')
 receipt.registeredStates=readiness.states;receipt.accountId=readiness.boundary.accountId
 const boundary=await h.api('/api/stall/tax/boundary')
 const preview=await h.api('/api/stall/tax/preview',{id:randomUUID(),consent:boundary.consent,destination:sanFrancisco,shipFrom,lines:[{reference:'synthetic-stall-taxable',unitCents:1000,quantity:2,taxCode:'txcd_99999999'},{reference:'synthetic-stall-exempt',unitCents:500,quantity:1,taxCode:'txcd_00000000'}],shippingCents:200})
 assert.equal(preview.previewOnly,true);assert.ok(preview.taxCents>0)
 receipt.preview={calculationId:preview.providerId??preview.calculationId,taxCents:preview.taxCents,totalCents:preview.totalCents,jurisdictions:preview.breakdown?.length}
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
 assert.equal(liability.totals.taxCents,t.taxCents-refund.taxAllocation.taxCents,'the report nets the sale tax and the reversal exactly')
 assert.ok(liability.transactions.some(row=>row.id===t.transactionId)&&liability.transactions.some(row=>row.id===refund.taxReversalId))
 const nexus=await h.api(`/api/stall/tax/nexus?from=${today}&to=${end}`)
 receipt.liability={grossSalesCents:liability.totals.grossSalesCents,taxCents:liability.totals.taxCents,refundTaxCents:liability.totals.refundTaxCents,unallocatedTaxCents:liability.totals.unallocatedTaxCents,levels:[...new Set(liability.jurisdictions.map(j=>j.level))],california:nexus.states.find(s=>s.state==='CA')}
 receipt.providerRequests=requests.filter(r=>r.method==='POST').map(r=>`${r.method} ${r.path} ${r.status} ${r.requestId}`)
 assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.status===200),'every Stripe Tax write succeeded')
 assert.ok(!JSON.stringify(receipt).includes(key))
 console.log(JSON.stringify(receipt,null,1))
} catch(error) {console.error(JSON.stringify(requests,null,1));throw error} finally {await kit.close()}
