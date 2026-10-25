import type { Bindings } from '../../auth.server'
import { audit,changed,commit } from '../access'
import { fail,requirePerson,type Actor } from '../model'
import { readTaxConfiguration } from './configuration'
import { taxReadiness } from './index'
import { taxTestMode,commerceCall } from './commerce-provider'
export const shopperTaxConsent='Send my complete US delivery address, product amounts and tax codes, quantities and discounted shipping to the shop’s connected Stripe account to calculate tax for this purchase.'
export const commerceConsent='Enable test-mode taxed sales. Send shopper-consented US addresses, exact merchandise and discounted shipping amounts, product tax codes and reviewed exemption status to Stripe Tax; collect the quoted tax at payment, record the original Tax transaction after verified payment, and reverse allocated tax after successful refunds. Retain original calculation, transaction and reversal references and tax evidence with orders. This grants sale authority separately from preview consent. Stall does not register, file or change Stripe Tax settings.'
type Mode={revision:string;enabled:number;account_id:string|null;restored:number;reviewed_at:string}
export async function taxCommerceState(env:Bindings) {
 const row=await env.DB.prepare('SELECT * FROM st_tax_commerce WHERE id=1').first<Mode>()
 return {enabled:!!row?.enabled&&!row.restored,revision:row?.revision??null,accountId:row?.account_id??null,reviewedAt:row?.reviewed_at??null,restored:!!row?.restored,requiresReview:!!row?.restored,consent:commerceConsent+' Connected account: '+(row?.account_id??'none')+'.'}
}
export async function ownerTaxCommerceState(env:Bindings) {
 const state=await taxCommerceState(env)
 const account=env.STRIPE_SECRET_KEY?await commerceCall(env,'/account'):null
 const accountId=account?.id??state.accountId
 if(account&&!(typeof accountId==='string'&&/^acct_[A-Za-z0-9]+$/.test(accountId)))fail('TAX_RESPONSE','Stripe did not identify its connected account.',502)
 return {...state,accountId,consent:commerceConsent+' Connected account: '+(accountId??'none')+'.'}
}
export async function publicTaxCommerce(env:Bindings) {const mode=await taxCommerceState(env);return {enabled:mode.enabled,requiresReview:mode.requiresReview,shopperConsent:shopperTaxConsent}}
export async function ownerTaxCommerce(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner')fail('FORBIDDEN','Only the owner may enable taxed sales.',403)
 const disclosure=p.enabled===false?await taxCommerceState(env):await ownerTaxCommerceState(env)
 if(typeof p.enabled!=='boolean'||p.consent!==disclosure.consent)fail('TAX_CONSENT','Explicitly review the separate taxed-sales disclosure before changing sale authority.',400)
 const prior=await taxCommerceState(env)
 if((p.revision??null)!==prior.revision)fail('CHANGED','Review the current tax sale authority before changing it.')
 let accountId=prior.accountId
 if(p.enabled) {
  taxTestMode(env)
  const config=await readTaxConfiguration(env)
  if(!config.revision||!config.shipFrom||!config.categories.length)fail('TAX_CONFIGURATION','Save a complete ship-from address and explicit SKU tax code mappings before enabling taxed sales.',503)
  accountId=(await taxReadiness(env)).boundary.accountId
  if(accountId!==disclosure.accountId)fail('TAX_ACCOUNT','The connected account changed after disclosure. Review it again.')
 }
 const revision=crypto.randomUUID(),at=new Date().toISOString()
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_tax_commerce(id,revision,enabled,account_id,reviewed_by,reviewed_at,consent,restored) VALUES(1,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,account_id=excluded.account_id,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,consent=excluded.consent,restored=0 WHERE st_tax_commerce.revision=?').bind(revision,p.enabled?1:0,accountId,actor.id,at,p.consent,prior.revision),changed(env.DB),audit(env.DB,actor,'shop',p.enabled?'tax.commerce-enabled':'tax.commerce-disabled')])
 return taxCommerceState(env)
}
