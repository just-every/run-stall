import type { Bindings } from '../../auth.server'
import { email,fail,integer,text,type Line,type Order } from '../model'
import { priceSelection,selectLines } from '../order-selection'
import { promotionCode } from '../promotions/model'
import { qualification,requireQualified } from '../promotions/eligibility'
import { readTaxConfiguration } from './configuration'
import { publicTaxCommerce,shopperTaxConsent,taxCommerceState } from './commerce'
import { calculationItem,commerceCall,nontaxableCode,unpricedObligation,jurisdictions,taxAddress,taxTestMode,protectedTaxHash,taxDestinationHash,type TaxSnapshot } from './commerce-provider'
import { taxReadiness } from './index'

type QuoteRow={id:string;intent_hash:string;status:string;provider_id:string|null;result_json:string|null;order_id:string|null;restored:number}
export const taxPurchaseHash=(env:Bindings,lines:Line[],shippingCents:number,customerEmail:string,shipping:unknown,promotion:unknown)=>protectedTaxHash(env,{lines,shippingCents,customerEmail,shipping,promotion:promotion??null})
/** Shared priced purchase boundary. Extended line cents and net shipping are fixed here. */
export async function quoteTax(env:Bindings,p:any,verifiedCustomerEmail?:string) {
 const mode=await taxCommerceState(env)
 if(mode.requiresReview)fail('TAX_CONFIGURATION','The owner must review restored tax sale authority before checkout can accept payments.',503)
 if(!mode.enabled)fail('TAX_DISABLED','Taxed sales have not been separately enabled by the shop owner.',409)
 taxTestMode(env)
 if(p.consent!==shopperTaxConsent)fail('TAX_CONSENT','Review and accept the shopper tax data disclosure before requesting a quote.',400)
 const id=text(p.id,'Tax quote ID',36)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))fail('INPUT','Retain a random UUID for this tax quote.',400)
 const destination=taxAddress(p.destination),customerEmail=email(p.customerEmail),config=await readTaxConfiguration(env)
 if(!config.shipFrom||!config.revision)fail('TAX_CONFIGURATION','The owner must configure a complete ship-from address.',503)
 const code=p.promotionCode===undefined?undefined:promotionCode(p.promotionCode),priced=await priceSelection(env,selectLines(p.lines),undefined,p.shipping)
 if(priced.shipping.service.kind==='pickup')fail('TAX_DESTINATION','Taxed pickup checkout is not supported. Choose delivery.',409)
 if(priced.shipping.postalCode&&priced.shipping.postalCode!==destination.postal_code.slice(0,5))fail('TAX_ADDRESS','The tax destination must match the reviewed shipping ZIP code.',409)
 const qualified=code===undefined?undefined:requireQualified(await qualification(env,code,customerEmail,priced.totalCents-priced.shippingCents,priced.shippingCents,priced.shipping.service.kind))
 const shippingCents=priced.shippingCents-(qualified?.discountCents??0),subtotal=priced.totalCents-(qualified?.discountCents??0)
 const expected=priced.lines.map((line,i)=>{const taxCode=config.categories.find(c=>c.sku===line.sku)?.taxCode;if(!taxCode)fail('TAX_CONFIGURATION','An explicit Stripe Tax code is missing for a selected SKU.',503);return {reference:'line-'+i,quantity:line.quantity,amount:integer(line.quantity*line.unitCents,'Extended line cents',1,99999999),taxCode,sku:line.sku}})
 const evidence=verifiedCustomerEmail===customerEmail?await env.DB.prepare('SELECT id,revision FROM st_tax_exemptions WHERE customer_email=? AND state=? AND revoked=0 AND restored=0 AND expires_on>=? ORDER BY reviewed_at DESC,id LIMIT 1').bind(customerEmail,destination.state,new Date().toISOString().slice(0,10)).first<{id:string;revision:string}>():null
 const exemption=evidence?{id:evidence.id,revision:evidence.revision}:undefined

 const purchaseHash=await taxPurchaseHash(env,priced.lines,shippingCents,customerEmail,priced.shipping,qualified?.snapshot),intentHash=await protectedTaxHash(env,{purchaseHash,destination,configRevision:config.revision,commerceRevision:mode.revision,exemption:exemption??null})
 let row=await env.DB.prepare('SELECT * FROM st_tax_quotes WHERE id=?').bind(id).first<QuoteRow>()
 if(row&&(row.intent_hash!==intentHash||row.restored))fail('TAX_RECOVERY','This quote identity has different or restored intent. Recover its original evidence; do not replace it.')
 if(row?.status==='observed')return publicQuote(JSON.parse(row.result_json!))
 if(!row) {
  if(p.calculationId)fail('TAX_RECOVERY','Recover the existing original quote identity before supplying its calculation reference.')
  const uncertain=await env.DB.prepare("SELECT id FROM st_tax_quotes WHERE intent_hash=? AND status='uncertain' LIMIT 1").bind(intentHash).first()
  if(uncertain)fail('TAX_RECOVERY','This tax intent has an uncertain original calculation. Recover its original quote '+(uncertain as any).id+' and calculation ID.')
  const readiness=await taxReadiness(env)
  if(readiness.boundary.accountId!==mode.accountId||!readiness.states.includes(destination.state))fail('TAX_CONFIGURATION','The connected account or destination registration differs from enabled tax sale authority.',503)
  await env.DB.prepare("INSERT OR IGNORE INTO st_tax_quotes(id,intent_hash,config_revision,commerce_revision,status) VALUES(?,?,?,?,'prepared')").bind(id,intentHash,config.revision,mode.revision).run()
  row=(await env.DB.prepare('SELECT * FROM st_tax_quotes WHERE id=?').bind(id).first<QuoteRow>())!
  if(row.intent_hash!==intentHash)fail('IDEMPOTENCY','This quote identity belongs to another intent.')
 }
 const form=new URLSearchParams({currency:'usd','customer_details[address_source]':'shipping','shipping_cost[amount]':String(shippingCents),'shipping_cost[tax_behavior]':'exclusive','expand[]':'line_items.data.tax_breakdown'})
 form.append('expand[]','shipping_cost.tax_breakdown')
 if(exemption)form.set('customer_details[taxability_override]','customer_exempt')
 for(const [key,value] of Object.entries(destination))form.set(`customer_details[address][${key}]`,value)
 for(const [key,value] of Object.entries(config.shipFrom))form.set(`ship_from_details[address][${key}]`,value)
 expected.forEach((line,i)=>{for(const [key,value] of Object.entries({reference:line.reference,quantity:line.quantity,amount:line.amount,tax_code:line.taxCode,tax_behavior:'exclusive'}))form.set(`line_items[${i}][${key}]`,String(value));form.set(`line_items[${i}][metadata][stall_quote_id]`,id);form.set(`line_items[${i}][metadata][stall_intent]`,intentHash)})
 const claim=await env.DB.prepare("UPDATE st_tax_quotes SET status='uncertain',attempted_at=? WHERE id=? AND status='prepared' AND restored=0").bind(new Date().toISOString(),id).run()
 let value:any
 if(claim.meta.changes===1)value=await commerceCall(env,'/tax/calculations',form,'stall-sale-quote-'+id)
 else {
  const original=row.provider_id??p.calculationId
  if(typeof original!=='string'||!/^taxcalc_[A-Za-z0-9]+$/.test(original))fail('TAX_RECOVERY','The calculation outcome is uncertain. Supply its original Stripe calculation ID with the unchanged quote input; no POST will be retried.')
  value=await commerceCall(env,'/tax/calculations/'+encodeURIComponent(original))
 }
 if(typeof value.id!=='string'||!/^taxcalc_[A-Za-z0-9]+$/.test(value.id))fail('TAX_RESPONSE','Stripe omitted the original calculation reference.',502)
 await env.DB.prepare('UPDATE st_tax_quotes SET provider_id=? WHERE id=? AND (provider_id IS NULL OR provider_id=?)').bind(value.id,id,value.id).run()
 const returned=await commerceCall(env,'/tax/calculations/'+encodeURIComponent(value.id)+'/line_items?limit=100&expand[]=data.tax_breakdown')
 if(value.object!=='tax.calculation'||value.currency!=='usd'||value.livemode!==false||value.tax_amount_inclusive!==0||!Array.isArray(returned.data)||returned.has_more!==false||returned.data.length!==expected.length)fail('TAX_RESPONSE','Stripe returned incomplete calculation evidence.',502)
 const sameAddress=(actual:any,expected:any)=>['line1','line2','city','state','postal_code','country'].every(key=>(actual?.[key]??'')===(expected[key]??''))
 if(!sameAddress(value.customer_details?.address,destination)||!sameAddress(value.ship_from_details?.address,config.shipFrom)||value.customer_details?.address_source!=='shipping'||value.shipping_cost?.amount!==shippingCents||value.shipping_cost?.tax_behavior!=='exclusive'||(value.customer_details?.taxability_override==='customer_exempt')!==!!exemption)fail('TAX_MISMATCH','Stripe calculated a different destination, exemption or shipping intent.',502)
 const lines=expected.map(line=>{const matches=returned.data.filter((item:any)=>item.reference===line.reference);if(matches.length!==1||matches[0].metadata?.stall_quote_id!==id||matches[0].metadata?.stall_intent!==intentHash)fail('TAX_MISMATCH','Calculation lines belong to another tax intent.',502);return {...calculationItem(matches[0],line,!!exemption),sku:line.sku}})
 if(!Array.isArray(value.tax_breakdown)||[...value.tax_breakdown.map((b:any)=>unpricedObligation(b,expected.some(l=>l.taxCode===nontaxableCode))),...(value.shipping_cost?.tax_breakdown??[]).map((b:any)=>unpricedObligation(b,expected.some(l=>l.taxCode===nontaxableCode)))].some(Boolean))fail('TAX_CONFIGURATION','Stripe cannot confirm complete supported tax coverage for this purchase.',503)
 const shippingTaxCents=integer(value.shipping_cost?.amount_tax,'Shipping tax cents',0,99999999),taxCents=integer(value.tax_amount_exclusive,'Tax cents',0,99999999)
 if(lines.reduce((n,l)=>n+l.taxCents,shippingTaxCents)!==taxCents||value.amount_total!==subtotal+taxCents)fail('TAX_RESPONSE','Stripe tax does not reconcile to exact merchandise and shipping.',502)
 const result:TaxSnapshot&{purchaseHash:string}={quoteId:id,calculationId:value.id,configRevision:config.revision,commerceRevision:mode.revision!,accountId:mode.accountId!,destination:{state:destination.state,postal_code:destination.postal_code,country:'US'},destinationHash:await taxDestinationHash(env,destination),taxCents,shippingTaxCents,totalCents:value.amount_total,expiresAt:integer(value.expires_at,'Calculation expiry',1,Number.MAX_SAFE_INTEGER),lines,shippingJurisdictions:jurisdictions(value.shipping_cost?.tax_breakdown??[]),...(exemption?{exemption}:{}),purchaseHash}
 await env.DB.prepare("UPDATE st_tax_quotes SET status='observed',result_json=? WHERE id=? AND provider_id=?").bind(JSON.stringify(result),id,value.id).run()
 return publicQuote(result)
}
function publicQuote(result:TaxSnapshot) {
 const grouped=new Map<string,{level:string;name:string;country:string;state:string;ratePercent:string;amountCents:number}>()
 for(const entry of [...result.lines.flatMap(line=>line.jurisdictions),...result.shippingJurisdictions]) {
  const key=JSON.stringify([entry.level,entry.name,entry.country,entry.state,entry.ratePercent]),current=grouped.get(key)??{...entry,amountCents:0}
  current.amountCents+=entry.amountCents;grouped.set(key,current)
 }
 const jurisdictions=[...grouped.values()]
 return {quoteId:result.quoteId,calculationId:result.calculationId,taxCents:result.taxCents,totalCents:result.totalCents,expiresAt:result.expiresAt,exempt:!!result.exemption,jurisdictions,unallocatedTaxCents:result.taxCents-jurisdictions.reduce((sum,j)=>sum+j.amountCents,0)}
}
export async function checkoutTax(env:Bindings,p:any,lines:Line[],shippingCents:number,customerEmail:string,shipping:unknown,promotion:unknown,verifiedCustomerEmail?:string):Promise<TaxSnapshot|undefined> {
 const currentMode=await publicTaxCommerce(env)
 if(currentMode.requiresReview)fail('TAX_CONFIGURATION','The owner must explicitly review restored tax sale authority before accepting payments.',503)
 if(!currentMode.enabled) {if(p.taxQuoteId)fail('TAX_CHANGED','Tax sale authority changed. Review checkout again.');return undefined}
 taxTestMode(env)
 if(typeof p.taxQuoteId!=='string')fail('TAX_QUOTE_REQUIRED','Review an address-level tax quote before paying. This checkout cannot bypass enabled tax.',409)
 const row=await env.DB.prepare('SELECT * FROM st_tax_quotes WHERE id=?').bind(p.taxQuoteId).first<QuoteRow>()
 if(!row||row.status!=='observed'||row.restored||row.order_id)fail('TAX_QUOTE_REQUIRED','Obtain a current, unused tax quote for this purchase.')
 const result=JSON.parse(row.result_json!) as TaxSnapshot&{purchaseHash:string},config=await readTaxConfiguration(env),mode=await taxCommerceState(env)
 if(result.configRevision!==config.revision||result.commerceRevision!==mode.revision||result.expiresAt<=Date.now()/1000||result.purchaseHash!==await taxPurchaseHash(env,lines,shippingCents,customerEmail,shipping,promotion))fail('TAX_CHANGED','The basket, identity, shipping, promotion, tax settings or quote expiry changed. Review a fresh tax quote.')
 if(result.exemption) {if(verifiedCustomerEmail!==customerEmail)fail('TAX_IDENTITY','Sign in with the proven customer email before using reviewed exemption evidence.',403);const current=await env.DB.prepare('SELECT id FROM st_tax_exemptions WHERE id=? AND revision=? AND customer_email=? AND state=? AND restored=0 AND revoked=0 AND expires_on>=?').bind(result.exemption.id,result.exemption.revision,customerEmail,result.destination.state,new Date().toISOString().slice(0,10)).first();if(!current)fail('TAX_CHANGED','Exemption evidence changed. Review a fresh tax quote.')}
 integer(p.expectedTotalCents,'Reviewed tax-inclusive total cents',50,99999999)
 if(p.expectedTotalCents!==result.totalCents)fail('PRICE_CHANGED','Review the exact tax-inclusive total before paying.')
 const {purchaseHash,...snapshot}=result
 return snapshot
}
/** Added to the order INSERT batch so a calculation can fund only one payment. */
export function claimTaxQuote(env:Bindings,order:Order) {
 return order.tax?[env.DB.prepare('UPDATE st_tax_quotes SET order_id=? WHERE id=? AND order_id IS NULL AND restored=0 AND EXISTS(SELECT 1 FROM st_tax_commerce WHERE id=1 AND enabled=1 AND restored=0 AND revision=st_tax_quotes.commerce_revision) AND EXISTS(SELECT 1 FROM st_tax_configuration WHERE id=1 AND revision=st_tax_quotes.config_revision)').bind(order.id,order.tax.quoteId),env.DB.prepare('INSERT INTO st_guard(value) VALUES(changes())')]:[]
}
