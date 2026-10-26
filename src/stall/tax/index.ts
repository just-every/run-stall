import type { Bindings } from '../../auth.server'
import { audit,commit,live } from '../access'
import { fail,integer,requirePerson,text,type Actor } from '../model'
import { nontaxableCode,unpricedObligation } from './commerce-provider'

const boundary='Send these US addresses, line amounts, product tax codes and shipping amount to my connected Stripe account for a tax preview only.'
export const taxBoundary={provider:'Stripe Tax',purpose:'Preview only; no payment, tax transaction, registration or filing',sends:['Destination and ship-from street, city, state, ZIP and country','Opaque line references, amounts and quantities','Product tax codes','Already-discounted shipping amount','Opaque preview and intent references for original calculation custody'],retains:['Opaque preview ID','Keyed intent fingerprint','Attempt and outcome','Calculation reference','USD totals and jurisdiction breakdown'],providerRetention:'Stripe handles the outbound address data under its own retention policy. Stall preview records retain no street addresses or raw address-bearing payloads. Separate commerce order and shipping records have their own custody.',consent:boundary}
const uuid=(value:unknown)=>{const id=text(value,'Preview ID',36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))fail('INPUT','Retain a random UUID for this preview and every recovery.',400);return id}
export function taxOwner(actor:Actor) {
 requirePerson(actor)
 if(actor.role!=='owner')fail('FORBIDDEN','Only the owner may preview tax data sent to Stripe.',403)
}
function address(input:any) {
 if(input?.country!=='US')fail('TAX_ADDRESS','Tax preview requires complete US addresses.',400)
 const value={line1:text(input?.line1,'Street address',200),...(input?.line2?{line2:text(input.line2,'Address line 2',200)}:{}),city:text(input?.city,'City',100),state:text(input?.state,'State',2).toUpperCase(),postal_code:text(input?.postal_code,'ZIP code',10),country:'US'}
 if(!/^[A-Z]{2}$/.test(value.state)||!/^\d{5}(?:-\d{4})?$/.test(value.postal_code))fail('TAX_ADDRESS','Use a two-letter state and a full US ZIP code.',400)
 return value
}
async function call(env:Bindings,path:string,form?:URLSearchParams,key?:string) {
 if(/^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY??''))fail('TAX_MODE','Tax previews currently require a Stripe test-mode connection.',503)
 if(!env.STRIPE_SECRET_KEY)fail('TAX_CONFIGURATION','Connect Stripe in Settings → Provider connections before previewing tax.',503)
 let response:Response
 try {response=await fetch('https://api.stripe.com/v1'+path,{method:form?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':'2025-06-30.basil',...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(form?{body:form.toString()}:{})})}
 catch {return fail('TAX_UNAVAILABLE','Stripe Tax did not answer. No tax rate is assumed. Inspect the saved preview before recovering its original calculation.',503)}
 if(!response.ok) {
  if(response.status===401||response.status===403)fail('TAX_CREDENTIAL','Stripe refused Tax access. Check the connected account and its Tax read and calculation permissions.',503)
  if(response.status===400)fail('TAX_CONFIGURATION','Stripe Tax refused this address or tax configuration. Correct the addresses, tax codes and account settings; no zero rate is assumed.',503)
  fail('TAX_UNAVAILABLE','Stripe Tax is unavailable. No tax rate is assumed; recover the original preview if its outcome is uncertain.',503)
 }
 try {return await response.json() as any}catch {return fail('TAX_RESPONSE','Stripe Tax returned an unreadable result. No tax rate is assumed.',502)}
}
export async function taxBoundaryFor(env:Bindings) {
 const account=await call(env,'/account')
 if(typeof account?.id!=='string'||!/^acct_[A-Za-z0-9]+$/.test(account.id))fail('TAX_RESPONSE','Stripe did not identify the connected account.',502)
 return {...taxBoundary,accountId:account.id,consent:boundary+' Connected account: '+account.id+'.'}
}
export async function taxReadiness(env:Bindings) {
 const settings=await call(env,'/tax/settings'),registrations=await call(env,'/tax/registrations?status=active&limit=100')
 if(settings?.status!=='active'||!settings.head_office?.address?.line1||!settings.defaults?.tax_code)fail('TAX_CONFIGURATION','Finish Stripe Tax head office and default tax code settings in the connected Stripe account.',503)
 if(!Array.isArray(registrations?.data)||registrations.has_more!==false)fail('TAX_CONFIGURATION','Stripe Tax registrations could not be completely inspected.',503)
 const states=registrations.data.filter((r:any)=>r.status==='active'&&r.country==='US'&&/^[A-Z]{2}$/.test(r.country_options?.us?.state)).map((r:any)=>r.country_options.us.state as string)
 if(!states.length)fail('TAX_CONFIGURATION','Configure an active US tax registration in Stripe Tax before previewing a registered sale.',503)
 return {observedAt:new Date().toISOString(),states:[...new Set<string>(states)].sort(),boundary:await taxBoundaryFor(env)}
}
async function fingerprint(env:Bindings,value:string) {
 if(!env.SESSION_SECRET)fail('CONFIG','A session secret is required to protect preview intent.',503)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('stall-tax-preview-v1\n'+value)))].map(x=>x.toString(16).padStart(2,'0')).join('')
}
function projection(value:any,subtotal:number,nontaxableLine:boolean) {
 if(typeof value?.id!=='string'||!/^taxcalc_[A-Za-z0-9]+$/.test(value.id)||value.object!=='tax.calculation'||value.currency!=='usd'||value.livemode!==false)fail('TAX_RESPONSE','Stripe Tax did not return a matching USD calculation.',502)
 const taxCents=integer(value.tax_amount_exclusive,'Provider exclusive tax cents',0,99999999)
 if(value.tax_amount_inclusive!==0||value.amount_total!==subtotal+taxCents||!Array.isArray(value.tax_breakdown))fail('TAX_RESPONSE','Stripe Tax totals do not reconcile to the reviewed exclusive amounts.',502)
 const breakdown=value.tax_breakdown.map((entry:any)=>{
  const details=entry.tax_rate_details
  if(!details||entry.inclusive!==false||typeof details.percentage_decimal!=='string'||!/^\d+(?:\.\d+)?$/.test(details.percentage_decimal))fail('TAX_RESPONSE','Stripe Tax omitted its jurisdiction breakdown.',502)
  if(unpricedObligation(entry,nontaxableLine))fail('TAX_CONFIGURATION','Stripe Tax cannot price this obligation with the current registrations and supported tax coverage.',503)
  return {amountCents:integer(entry.amount,'Jurisdiction tax cents',0,99999999),taxableCents:integer(entry.taxable_amount,'Taxable cents',0,99999999),country:details.country??null,state:details.state??null,taxType:details.tax_type??null,ratePercent:details.percentage_decimal,reason:text(entry.taxability_reason,'Provider tax reason',100)}
 })
 if(breakdown.reduce((sum:number,j:{amountCents:number})=>sum+j.amountCents,0)!==taxCents)fail('TAX_RESPONSE','Stripe Tax jurisdiction amounts do not reconcile.',502)
 return {calculationId:value.id as string,currency:'usd',subtotalCents:subtotal,taxCents,totalCents:subtotal+taxCents,expiresAt:integer(value.expires_at,'Provider calculation expiry',1,Number.MAX_SAFE_INTEGER),breakdown,previewOnly:true,currentCheckoutTax:false}
}
function observation(result:any,restored:number) { return {...result,previewOnly:true,currentCheckoutTax:false,historicalObservation:!!restored||result.expiresAt<=Math.floor(Date.now()/1000)} }
type Preview={restored:number;id:string;intent_hash:string;status:string;attempts:number;attempted_at:string|null;observed_at:string|null;provider_id:string|null;result_json:string|null;error_code:string|null}
export async function taxHistory(env:Bindings) {
 const rows=(await env.DB.prepare('SELECT * FROM st_tax_previews ORDER BY attempted_at DESC,id LIMIT 100').all<Preview>()).results
 const count=await env.DB.prepare('SELECT count(*) AS total FROM st_tax_previews').first<{total:number}>()
 return {total:count!.total,limit:100,truncated:count!.total>100,previews:rows.map(({intent_hash,result_json,...row})=>({...row,result:result_json?observation(JSON.parse(result_json),row.restored):null}))}
}
/** This is an owner-reviewed calculation door, never authority to charge a shopper. */
export async function previewTax(env:Bindings,actor:Actor,p:any) {
 taxOwner(actor)
 if(p.consent!==(await taxBoundaryFor(env)).consent)fail('TAX_CONSENT','Review and explicitly accept the tax data boundary before sending a preview.',400)
 const id=uuid(p.id),destination=address(p.destination),shipFrom=address(p.shipFrom)
 if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>50)fail('INPUT','Preview between one and 50 lines.',400)
 const seen=new Set<string>(),lines=p.lines.map((line:any)=>{
  const reference=text(line.reference,'Line reference',100),taxCode=text(line.taxCode,'Stripe Tax product code',20),quantity=integer(line.quantity,'Quantity',1,1000),unitCents=integer(line.unitCents,'Unit cents',1,99999999)
  if(!/^[A-Za-z0-9_-]+$/.test(reference)||seen.has(reference)||!/^txcd_\d{8}$/.test(taxCode))fail('INPUT','Use unique opaque line references and Stripe Tax product codes.',400)
  seen.add(reference);return {reference,taxCode,quantity,amount:integer(unitCents*quantity,'Line cents',1,99999999)}
 }).sort((a:{reference:string},b:{reference:string})=>a.reference.localeCompare(b.reference))
 const shippingCents=integer(p.shippingCents,'Discounted shipping cents',0,99999999),subtotal=integer(lines.reduce((n:number,l:{amount:number})=>n+l.amount,shippingCents),'Preview subtotal cents',1,99999999)
 const computedHash=await fingerprint(env,JSON.stringify({destination,shipFrom,lines,shippingCents})),at=new Date().toISOString()
 let row=await env.DB.prepare('SELECT * FROM st_tax_previews WHERE id=?').bind(id).first<Preview>()
 const intentHash=row?.restored?row.intent_hash:computedHash
 if(row&&!row.restored&&row.intent_hash!==intentHash)fail('IDEMPOTENCY','This preview ID belongs to a different tax intent. Recover the original calculation without replacing it.')
 if(row?.status==='observed'&&!row.restored)return observation(JSON.parse(row.result_json!),0)
 if(row?.restored&&!p.calculationId&&!row.provider_id)fail('TAX_RECOVERY','Restored previews are observation-only. Recover the original calculation ID; no new calculation can be sent.')
 // Never replay an uncertain calculation POST: Stripe may have expired its key.
 // Recovery requires the original provider ID, with the original full input.
 if(row?.status==='uncertain'&&!p.calculationId&&!row.provider_id)fail('TAX_RECOVERY','The original calculation may exist. Supply its Stripe calculation ID with the unchanged original input; Stall will only retrieve it.')
 if(!row) {
  if(p.calculationId)fail('TAX_RECOVERY','Use the original preview identity to recover its calculation. A new identity never replaces an uncertain calculation.')
  const uncertain=await env.DB.prepare("SELECT id FROM st_tax_previews WHERE (intent_hash=? OR restored=1) AND status='uncertain' LIMIT 1").bind(computedHash).first<{id:string}>()
  if(uncertain)fail('TAX_RECOVERY','This intent has an uncertain original preview. Recover that original identity and provider reference; no replacement calculation was sent.')
  const readiness=await taxReadiness(env)
  if(!readiness.states.includes(destination.state))fail('TAX_CONFIGURATION','This preview requires an active Stripe Tax registration for its destination state.',503)
  await commit(env.DB,actor,[env.DB.prepare("INSERT OR IGNORE INTO st_tax_previews(id,intent_hash,status) VALUES(?,?,'prepared')").bind(id,intentHash),audit(env.DB,actor,id,'tax.preview-prepared')])
  row=(await env.DB.prepare('SELECT * FROM st_tax_previews WHERE id=?').bind(id).first<Preview>())!
  if(row.intent_hash!==intentHash)fail('IDEMPOTENCY','This preview ID belongs to a different tax intent.')
 }
 const form=new URLSearchParams({currency:'usd','customer_details[address_source]':'shipping','shipping_cost[amount]':String(shippingCents),'shipping_cost[tax_behavior]':'exclusive'})
 for(const [key,value] of Object.entries(destination))form.set(`customer_details[address][${key}]`,value)
 for(const [key,value] of Object.entries(shipFrom))form.set(`ship_from_details[address][${key}]`,value)
 lines.forEach((line:{reference:string;taxCode:string;quantity:number;amount:number},i:number)=>{for(const [key,value] of Object.entries({reference:line.reference,tax_code:line.taxCode,quantity:line.quantity,amount:line.amount,tax_behavior:'exclusive'}))form.set(`line_items[${i}][${key}]`,String(value));form.set(`line_items[${i}][metadata][stall_tax_preview_id]`,id);form.set(`line_items[${i}][metadata][stall_tax_intent]`,intentHash)})
 try {
  await live(env,actor)
  const claim=await env.DB.prepare("UPDATE st_tax_previews SET status='uncertain',attempts=1,attempted_at=? WHERE id=? AND status='prepared' AND attempts=0 AND restored=0").bind(at,id).run()
  let value:any
  if(claim.meta.changes===1)value=await call(env,'/tax/calculations',form,'stall-tax-preview-'+id)
  else {
   const original=row.provider_id??p.calculationId
   if(!original||!/^taxcalc_[A-Za-z0-9]+$/.test(original))fail('TAX_RECOVERY','Recover the original Stripe calculation ID; no replacement calculation was sent.')
   value=await call(env,'/tax/calculations/'+encodeURIComponent(original))
  }
  if(typeof value?.id!=='string'||!/^taxcalc_[A-Za-z0-9]+$/.test(value.id))fail('TAX_RESPONSE','Stripe did not return a calculation reference.',502)
  const returned=await call(env,'/tax/calculations/'+encodeURIComponent(value.id)+'/line_items?limit=100')
  if(returned?.has_more!==false||!Array.isArray(returned.data)||returned.data.length!==lines.length||!lines.every((line:any)=>{
   const matches=returned.data.filter((item:any)=>item.reference===line.reference),item=matches[0]
   return matches.length===1&&item.amount===line.amount&&item.quantity===line.quantity&&item.tax_code===line.taxCode&&item.tax_behavior==='exclusive'&&item.metadata?.stall_tax_preview_id===id&&item.metadata?.stall_tax_intent===intentHash
  }))fail('TAX_MISMATCH','The Stripe calculation belongs to a different original preview.',409)
  const sameAddress=(actual:any,expected:Record<string,string>)=>['line1','line2','city','state','postal_code','country'].every(key=>(actual?.[key]??'')===(expected[key]??''))
  if(!sameAddress(value.customer_details?.address,destination)||!sameAddress(value.ship_from_details?.address,shipFrom)||value.customer_details?.address_source!=='shipping'||value.shipping_cost?.amount!==shippingCents||value.shipping_cost?.tax_behavior!=='exclusive')fail('TAX_MISMATCH','Stripe calculated a different address or shipping amount.',409)
  await env.DB.prepare('UPDATE st_tax_previews SET provider_id=? WHERE id=? AND (provider_id IS NULL OR provider_id=?)').bind(value.id,id,value.id).run()
  const result={...projection(value,subtotal,lines.some((line:{taxCode:string})=>line.taxCode===nontaxableCode)),historicalObservation:!!row.restored||value.expires_at<=Math.floor(Date.now()/1000)}
  await env.DB.prepare("UPDATE st_tax_previews SET status='observed',observed_at=?,provider_id=?,result_json=?,error_code=NULL WHERE id=? AND (provider_id IS NULL OR provider_id=?)").bind(new Date().toISOString(),result.calculationId,JSON.stringify(result),id,result.calculationId).run()
  return result
 } catch(error:any) {
  await env.DB.prepare('UPDATE st_tax_previews SET error_code=? WHERE id=?').bind(typeof error?.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'TAX_UNAVAILABLE',id).run()
  throw error
 }
}
