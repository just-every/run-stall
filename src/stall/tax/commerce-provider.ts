import type { Bindings } from '../../auth.server'
import { fail,integer,text } from '../model'
import { taxStates,type TaxAddress } from './configuration'

export function taxTestMode(env:Bindings) {
 if(!env.STRIPE_SECRET_KEY||/^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY))fail('TAX_MODE','Tax commerce requires a connected Stripe test-mode account.',503)
}
export async function commerceCall(env:Bindings,path:string,form?:URLSearchParams,key?:string):Promise<any> {
 taxTestMode(env)
 let response:Response
 try {response=await fetch('https://api.stripe.com/v1'+path,{method:form?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':'2025-06-30.basil',...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(form?{body:form.toString()}:{})})}
 catch {return fail('TAX_UNAVAILABLE','Stripe Tax did not answer. No zero tax is assumed. An uncertain write can only recover its original provider reference.',503)}
 if(!response.ok)fail(response.status===400?'TAX_CONFIGURATION':'TAX_UNAVAILABLE','Stripe Tax refused or could not confirm this operation. Check complete addresses, tax codes, account head office and registrations. No zero tax is assumed.',503)
 try {return await response.json()}catch {return fail('TAX_RESPONSE','Stripe Tax returned unreadable evidence. Recover the original provider reference.',502)}
}
export function taxAddress(input:any):TaxAddress {
 if(input?.country!=='US')fail('TAX_ADDRESS','Tax checkout requires a complete US address.',400)
 const value={line1:text(input.line1,'Street address',200),...(input.line2?{line2:text(input.line2,'Address line 2',200)}:{}),city:text(input.city,'City',100),state:text(input.state,'State',2).toUpperCase(),postal_code:text(input.postal_code,'ZIP code',10),country:'US' as const}
 if(!taxStates.includes(value.state)||!/^\d{5}(?:-\d{4})?$/.test(value.postal_code))fail('TAX_ADDRESS','Use a US state and full ZIP code.',400)
 return value
}
export type TaxJurisdiction={level:'state'|'county'|'city'|'district';name:string;country:'US';state:string;ratePercent:string;amountCents:number;taxableCents:number}
export type TaxItem={reference:string;amount:number;taxCents:number;quantity:number;taxCode:string;taxableCents:number;exemptCents:number;providerLineId?:string;jurisdictions:TaxJurisdiction[]}
export type TaxSnapshot={quoteId:string;calculationId:string;configRevision:string;commerceRevision:string;accountId:string;destination:Pick<TaxAddress,'state'|'postal_code'|'country'>;destinationHash:string;taxCents:number;shippingTaxCents:number;totalCents:number;expiresAt:number;lines:TaxItem[];shippingJurisdictions:TaxJurisdiction[];exemption?:{id:string;revision:string};transactionId?:string}
export function jurisdictions(entries:any[],sign=1):TaxJurisdiction[] {
 return entries.flatMap(entry=>{
  const j=entry.jurisdiction,rate=entry.tax_rate_details?.percentage_decimal
  if(!j||!['state','county','city','district'].includes(j.level)||typeof j.display_name!=='string'||!j.display_name.trim()||j.country!=='US'||!taxStates.includes(j.state)||typeof rate!=='string'||!/^\d+(?:\.\d+)?$/.test(rate))return []
  return [{level:j.level,name:j.display_name,country:'US' as const,state:j.state,ratePercent:rate,amountCents:sign*integer(Math.abs(entry.amount),'Jurisdiction tax cents',0,99999999),taxableCents:sign*integer(Math.abs(entry.taxable_amount),'Jurisdiction taxable cents',0,99999999)}]
 })
}
export function calculationItem(item:any,expected:{reference:string;amount:number;quantity:number;taxCode:string},exempt:boolean):TaxItem {
 if(item.reference!==expected.reference||item.amount!==expected.amount||item.quantity!==expected.quantity||item.tax_code!==expected.taxCode||item.tax_behavior!=='exclusive'||!Array.isArray(item.tax_breakdown)||!item.tax_breakdown.length)fail('TAX_MISMATCH','Stripe line evidence differs from the reviewed purchase.',502)
 if(item.tax_breakdown.some((b:any)=>['not_collecting','not_supported'].includes(b.taxability_reason)))fail('TAX_CONFIGURATION','Stripe cannot collect this obligation with the current registration and coverage.',503)
 const taxCents=integer(item.amount_tax,'Line tax cents',0,99999999)
 if(item.tax_breakdown.reduce((n:number,b:any)=>n+integer(b.amount,'Jurisdiction tax cents',0,99999999),0)!==taxCents)fail('TAX_RESPONSE','Stripe line tax breakdown does not reconcile.',502)
 const taxableCents=exempt?0:Math.max(0,...item.tax_breakdown.map((b:any)=>integer(b.taxable_amount,'Taxable line cents',0,expected.amount)))
 return {...expected,taxCents,taxableCents,exemptCents:exempt?expected.amount:0,jurisdictions:jurisdictions(item.tax_breakdown)}
}

export async function protectedTaxHash(env:Bindings,value:unknown) {
 if(!env.SESSION_SECRET)fail('CONFIG','A session secret is required to protect tax intent.',503)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('')
}
export function taxDestinationHash(env:Bindings,address:any) {return protectedTaxHash(env,['line1','line2','city','state','postal_code','country'].map(key=>String(address?.[key]??'').trim().toLowerCase()))}
export async function requireTaxDestination(env:Bindings,tax:TaxSnapshot,address:any) {
 if(tax.destinationHash!==await taxDestinationHash(env,address))fail('TAX_DESTINATION_CHANGED','The address paid in Stripe differs from the reviewed full tax address. Refund the original payment in Stripe and obtain a fresh quote before fulfillment.',409)
}
