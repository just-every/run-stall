import type { Bindings } from '../../auth.server'
import { audit,commit } from '../access'
import { fail,integer,requirePerson,text,type Actor } from '../model'
import { businessTimeZone } from '../preferences'
import { date,localInstant } from '../workflows/time'
import { taxStates } from './configuration'

export const marketplaceConsent='Record these marketplace-facilitated sales as reporting evidence only. The marketplace calculated, collected and remitted this tax; Stall does not calculate, collect, remit or file it, and the rows keep no customer, address or payment data.'
type Row={id:string;orderId:string;kind:'sale'|'refund';occurred_at:string;destination_state:string;gross_cents:number;taxable_cents:number;nontaxable_cents:number;shipping_cents:number;tax_cents:number;amount_cents:number;calculation_id:string;original_transaction_id:string|null}
const reference=(value:unknown,label:string)=>{const v=text(value,label,100);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v))fail('INPUT',`${label} may use letters, digits, dots, colons, dashes and underscores only.`,400);return v}
async function postingId(marketplace:string,ref:string) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`stall-marketplace-v1\n${marketplace.toLowerCase()}\n${ref}`))
 return 'marketplace-'+[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,40)
}
/** Owner-only reporting evidence: separated from merchant-collected tax and never a calculation or filing. */
export async function recordMarketplaceSales(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner')fail('FORBIDDEN','Only the owner may record marketplace-facilitated sales.',403)
 if(p.consent!==marketplaceConsent)fail('TAX_CONSENT','Review the marketplace reporting boundary before recording sales.',400)
 if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>200)fail('INPUT','Record between 1 and 200 marketplace rows at a time.',400)
 const zone=await businessTimeZone(env.DB),seen=new Set<string>(),statements:D1PreparedStatement[]=[]
 const prepared=[]
 for(const input of p.rows) {
  const kind=input?.kind==='refund'?'refund':input?.kind==='sale'?'sale':fail('INPUT','Each row is a sale or a refund.',400),marketplace=text(input.marketplace,'Marketplace',60),ref=reference(input.reference,'Marketplace order reference'),day=date(input.occurredOn)
  const state=text(input.state,'State',2).toUpperCase()
  if(!taxStates.includes(state))fail('INPUT','Use a two-letter US state.',400)
  const goods=integer(input.goodsCents,'Item gross cents',0,99999999),nonTaxable=integer(input.nonTaxableCents??0,'Non-taxable item cents',0,goods),shipping=integer(input.shippingCents??0,'Shipping cents',0,99999999),tax=integer(input.taxCents??0,'Marketplace tax cents',0,99999999)
  const id=await postingId(marketplace,(kind==='refund'?'refund:':'sale:')+ref)
  if(seen.has(id))fail('INPUT','A marketplace reference appears twice in one batch.',400)
  seen.add(id)
  const original=kind==='refund'?await postingId(marketplace,'sale:'+reference(input.originalReference,'Original marketplace order reference')):null
  if(original&&!seen.has(original)&&!await env.DB.prepare("SELECT 1 FROM st_tax_postings WHERE id=? AND channel='marketplace' AND kind='sale' AND destination_state=?").bind(original,state).first())fail('MARKETPLACE_ORIGINAL','A marketplace refund needs a recorded sale in the same state.',409)
  const sign=kind==='sale'?1:-1,at=new Date(localInstant(day,720,zone)).toISOString()
  prepared.push({id,original,kind,state,at,marketplace,ref,sign,goods,nonTaxable,shipping,tax})
 }
 for(const r of prepared) {
  const gross=r.sign*r.goods,taxable=r.sign*(r.goods-r.nonTaxable),nontaxable=r.sign*r.nonTaxable,shipping=r.sign*r.shipping,tax=r.sign*r.tax
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO st_tax_postings(id,order_id,kind,occurred_at,destination_state,channel,gross_cents,taxable_cents,nontaxable_cents,exempt_cents,shipping_cents,tax_cents,amount_cents,calculation_id,original_transaction_id,jurisdictions_json) VALUES(?,?,?,?,?,'marketplace',?,?,?,0,?,?,?,?,?,'[]')").bind(r.id,r.marketplace+':'+r.ref,r.kind,r.at,r.state,gross,taxable,nontaxable,shipping,tax,gross+shipping+tax,'marketplace:'+r.marketplace+':'+r.ref,r.original))
 }
 try {await commit(env.DB,actor,[...statements,audit(env.DB,actor,'marketplace-'+prepared.length,'tax.marketplace-recorded')])}
 catch(error:any) {if(String(error?.message??error).includes('TAX_POSTING_IMMUTABLE'))fail('MARKETPLACE_CONFLICT','A marketplace reference was already recorded with different amounts. Existing evidence is never replaced.',409);throw error}
 return marketplaceState(env)
}
export async function marketplaceState(env:Bindings) {
 const rows=(await env.DB.prepare("SELECT id,order_id AS orderId,kind,occurred_at AS occurredAt,destination_state AS state,gross_cents AS grossCents,shipping_cents AS shippingCents,tax_cents AS taxCents,calculation_id AS reference FROM st_tax_postings WHERE channel='marketplace' ORDER BY occurred_at DESC,id LIMIT 100").all()).results
 return {consent:marketplaceConsent,entries:rows}
}
