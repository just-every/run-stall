import type { Bindings } from '../../auth.server'
import { fail,integer,type Order,type Refund } from '../model'
import { jurisdictions,type TaxItem,type TaxJurisdiction } from './commerce-provider'

export async function postTaxTransaction(env:Bindings,order:Order,result:any,kind:'sale'|'refund',lines:TaxItem[],shippingCents:number,shippingTaxCents:number,shippingJurisdictions:TaxJurisdiction[]) {
 const sign=kind==='sale'?1:-1,gross=lines.reduce((n,l)=>n+l.amount,0),taxable=lines.reduce((n,l)=>n+l.taxableCents,0),exempt=lines.reduce((n,l)=>n+l.exemptCents,0),tax=lines.reduce((n,l)=>n+l.taxCents,shippingTaxCents)
 if(gross<taxable+exempt||gross+shippingCents+tax!==Math.abs(result.observedTotalCents))fail('TAX_MISMATCH','The observed Tax posting does not reconcile.',502)
 const postedAt=integer(result.posted_at,'Provider tax posting timestamp',1,253402300799)
 const allocated=[...lines.flatMap(line=>line.jurisdictions),...shippingJurisdictions]
 const named=kind==='sale'?[]:jurisdictions([...result.line_items.data.flatMap((line:any)=>Array.isArray(line.tax_breakdown)?line.tax_breakdown:[]),...(Array.isArray(result.shipping_cost?.tax_breakdown)?result.shipping_cost.tax_breakdown:[])])
 // Stripe normally omits reversal jurisdiction detail: then the reviewed pro rata split of the original provider breakdown stands in and sums to the reversed tax.
 const observedJurisdictions=named.length&&named.reduce((n,j)=>n+j.amountCents,0)===tax?named:allocated
 const postingJurisdictions=observedJurisdictions.map(j=>({...j,amountCents:sign*j.amountCents,taxableCents:sign*j.taxableCents}))
 await env.DB.prepare('INSERT OR IGNORE INTO st_tax_postings(id,order_id,kind,occurred_at,destination_state,channel,gross_cents,taxable_cents,nontaxable_cents,exempt_cents,shipping_cents,tax_cents,amount_cents,calculation_id,original_transaction_id,jurisdictions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(result.id,order.id,kind,new Date(postedAt*1000).toISOString(),order.tax!.destination.state,'online',sign*gross,sign*taxable,sign*(gross-taxable-exempt),sign*exempt,sign*shippingCents,sign*tax,sign*(gross+shippingCents+tax),order.tax!.calculationId,kind==='refund'?order.tax!.transactionId:null,JSON.stringify(postingJurisdictions)).run()
}
/** Goodwill is money returned with no sales-tax effect: a zero-tax adjustment keeps the filing period's cash and tax columns reconciled. */
export async function postGoodwillAdjustment(env:Bindings,order:Order,refund:Refund) {
 if(!order.tax?.transactionId||!refund.startedAt)fail('TAX_RECOVERY','A goodwill adjustment needs the original recorded tax transaction and its approval time.')
 const amount=refund.amountCents
 await env.DB.prepare("INSERT OR IGNORE INTO st_tax_postings(id,order_id,kind,occurred_at,destination_state,channel,gross_cents,taxable_cents,nontaxable_cents,exempt_cents,shipping_cents,tax_cents,amount_cents,calculation_id,original_transaction_id,jurisdictions_json) VALUES(?,?,'adjustment',?,?,'online',?,0,?,0,0,0,?,?,?,'[]')").bind('stall-goodwill-'+refund.id,order.id,new Date(refund.startedAt).toISOString(),order.tax.destination.state,-amount,-amount,-amount,order.tax.calculationId,order.tax.transactionId).run()
}
