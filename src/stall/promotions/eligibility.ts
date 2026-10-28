import type { Bindings } from '../../auth.server'
import { digest } from '../access'
import { email,fail,type Order,type Line,type OrderShipping } from '../model'
import { priceSelection,selectLines } from '../order-selection'
import { catalogue } from '../pier'
import { collectionMembers } from '../discover'
import { collections } from '../collections'
import { orders } from '../store'
import { historyBusinessRecords } from '../customers/order-history'
import { promotionCode,type Promotion,type PromotionSnapshot,type PromotionComponent } from './model'
import { storedRule,discountClass,type Rule,type Targets } from './rules'
import { calculate } from './calculation'

type Context={lines:Line[];shipping:OrderShipping;country?:string;verifiedEmail?:string}
type Usage={uses:number;discount:number;customerUses:number}
export async function customerKey(env:Bindings,address:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('stall-promotion-customer:'+email(address))))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
async function customerEligible(env:Bindings,rule:Rule,address:string,verifiedEmail?:string) {
 if(!rule.customerIds.length&&!rule.segmentIds.length)return true
 if(verifiedEmail!==address)return false
 const profile=await env.DB.prepare('SELECT c.id,c.value_json FROM st_customer_emails e JOIN st_customers c ON c.id=e.customer_id WHERE e.email=?').bind(address).first<{id:string;value_json:string}>()
 if(!profile)return false
 if(rule.customerIds.includes(profile.id))return true
 const mailboxes=(await env.DB.prepare('SELECT email FROM st_customer_emails WHERE customer_id=?').bind(profile.id).all<{email:string}>()).results.map(r=>r.email)
 const purchases=(await orders(env.DB)).filter(o=>!o.erasedAt&&o.payment&&o.customerEmail&&mailboxes.includes(o.customerEmail.toLowerCase()))
 const past=(await historyBusinessRecords(env.DB)).filter(r=>r.email&&mailboxes.includes(r.email)&&r.value.paid).map(r=>r.value),allPaid=[...purchases,...past]
 const spent=allPaid.reduce((n,o)=>n+o.totalCents-o.refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amountCents,0),0),tags=JSON.parse(profile.value_json).tags??[]
 const addresses=(await env.DB.prepare('SELECT email,value_json FROM st_customer_addresses').all<{email:string;value_json:string}>()).results.filter(r=>mailboxes.includes(r.email))
 const states=[...allPaid.map(o=>o.shippingDetails?.address.state),...addresses.map(r=>JSON.parse(r.value_json).state)]
 for(const id of rule.segmentIds){const row=await env.DB.prepare('SELECT value_json FROM st_customer_segments WHERE id=?').bind(id).first<{value_json:string}>();if(!row)continue;const s=JSON.parse(row.value_json);if((!s.tag||tags.includes(s.tag))&&spent>=s.minimumSpentCents&&allPaid.length>=s.minimumOrders&&(!s.state||states.includes(s.state)))return true}
 return false
}
export async function qualification(env:Bindings,code:unknown,address:string,subtotalCents:number,shippingCents:number,shippingKind:string,context?:Context) {
 const customer=await customerKey(env,address),codes=code===undefined?[]:promotionCode(code).split(','),hashes=await Promise.all(codes.map(digest))
 const all=(await env.DB.prepare('SELECT * FROM st_promotions ORDER BY created_at,id').all<Promotion>()).results
 const batchCodes=(await env.DB.prepare('SELECT code_hash,promotion_id FROM st_promotion_codes').all<{code_hash:string;promotion_id:string}>()).results
 const explicit=hashes.map(hash=>all.find(row=>row.code_hash===hash||batchCodes.some(c=>c.code_hash===hash&&c.promotion_id===row.id)))
 if(new Set(explicit.filter(Boolean).map(p=>p!.id)).size!==explicit.filter(Boolean).length)return {applicable:false as const,reason:'COMBINATION',message:'Use only one code from each promotion.',discountCents:0}
 const refuse=(reason:string,message:string)=>({applicable:false as const,reason,message,discountCents:0})
 if(explicit.some(row=>!row||storedRule(row).method!=='code'))return refuse('UNKNOWN_CODE','This promotion code is not available.')
 const selected=[...explicit as Promotion[],...all.filter(row=>storedRule(row).method==='automatic'&&!explicit.some(p=>p?.id===row.id))]
 // Product discounts precede order discounts, then shipping. Explicit codes win ties.
 selected.sort((a,b)=>['product','order','shipping'].indexOf(discountClass(storedRule(a)))-['product','order','shipping'].indexOf(discountClass(storedRule(b))))
 const lines=context?.lines??[],remaining=lines.map(l=>l.quantity*l.unitCents),components:PromotionComponent[]=[],applied:Rule[]=[],explanations:{id:string;applied:boolean;reason:string}[]=[]
 let shippingRemaining=shippingCents
 const needsCollections=selected.some(p=>{const r=storedRule(p);return r.targets.collections.length||r.buy.collections.length})
 const stock=needsCollections?await catalogue(env):null,groups=needsCollections?await collections(env.DB):[]
 const members=new Map(groups.map(group=>[group.id,collectionMembers({...stock!,collections:groups,config:{} as any},group.id).map(p=>p.sku)]))
 const matches=(target:Targets,line:Line)=>!Object.values(target).some(v=>v.length)||target.products.includes(line.productSku??line.sku)||target.variants.includes(line.sku)||target.collections.some(c=>members.get(c)?.includes(line.productSku??line.sku))
 for(const promotion of selected) {
  const rule=storedRule(promotion),selectedHash=hashes.find(hash=>promotion.code_hash===hash||batchCodes.some(c=>c.code_hash===hash&&c.promotion_id===promotion.id)),explicitCode=!!selectedHash,at=new Date().toISOString()
  let reason='',message=''
  const deny=(r:string,m:string)=>{if(!reason){reason=r;message=m}}
  if(promotion.revoked_at)deny('REVOKED','This promotion has been revoked.')
  if(!await env.DB.prepare("SELECT 1 FROM st_promotion_authority a JOIN oa_operators o ON o.id=a.custodian_id WHERE a.promotion_id=? AND a.revision=? AND o.version=a.custodian_version AND o.status='active' AND (o.role='owner' OR (o.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id)))").bind(promotion.id,promotion.revision).first())deny('AUTHORITY_REQUIRED','The owner or an administrator must review and enable this promotion again.')
  if(at<promotion.starts_at)deny('NOT_STARTED','This promotion has not started.')
  if(at>=promotion.ends_at)deny('ENDED','This promotion has ended.')
  if(subtotalCents<promotion.minimum_cents)deny('MINIMUM_BASKET','The merchandise subtotal is below this promotion’s minimum basket amount.')
  if(lines.reduce((n,l)=>n+l.quantity,0)<rule.minimumQuantity)deny('MINIMUM_QUANTITY','This basket does not meet the minimum item quantity.')
  if(!await customerEligible(env,rule,address,context?.verifiedEmail))deny('CUSTOMER_ELIGIBILITY','This promotion requires a currently verified eligible customer account.')
  if(rule.type==='free_shipping') {
   if(shippingKind!=='ship'||shippingCents<=0)deny('NO_SHIPPING_CHARGE','This promotion requires a paid shipping service.')
   if(rule.countries.length&&!rule.countries.includes(context?.country??'US'))deny('COUNTRY','This shipping destination is not eligible.')
   if(rule.zones.length&&!rule.zones.some(z=>context?.shipping.postalCode?.startsWith(z)))deny('SHIPPING_ZONE','This shipping zone is not eligible.')
   if(rule.maximumRateCents!==null&&shippingCents>rule.maximumRateCents)deny('SHIPPING_RATE','This shipping rate exceeds the promotion maximum.')
  }
  if(applied.some(previous=>!previous.combines[discountClass(rule)]||!rule.combines[discountClass(previous)]))deny('COMBINATION','These promotions cannot be combined. Remove the conflicting code and review again.')
  const result=context?calculate(rule,lines,remaining,shippingRemaining,matches):{lineDiscounts:[],shippingDiscountCents:rule.type==='free_shipping'?shippingRemaining:0}
  const discountCents=result.lineDiscounts.reduce((n,v)=>n+v,0)+result.shippingDiscountCents
  if(!discountCents)deny('NO_QUALIFYING_ITEMS','This basket has no qualifying discount value. Add the required qualifying and reward items.')
  if(selectedHash&&batchCodes.some(c=>c.code_hash===selectedHash)&&await env.DB.prepare('SELECT 1 FROM st_promotion_allocations WHERE code_hash=?').bind(selectedHash).first())deny('CODE_USED','This single-use code has already been reserved or redeemed.')
  const usage=await env.DB.prepare('SELECT COUNT(*) AS uses,COALESCE(SUM(discount_cents),0) AS discount,COALESCE(SUM(CASE WHEN customer_key=? THEN 1 ELSE 0 END),0) AS customerUses FROM st_promotion_allocations WHERE promotion_id=?').bind(customer,promotion.id).first<Usage>()
  if(usage!.customerUses>=promotion.max_customer_uses)deny('CUSTOMER_LIMIT','This customer has already reserved or used the allowed number of checkouts.')
  if(usage!.uses>=promotion.max_total_uses)deny('TOTAL_LIMIT','All checkouts available under this promotion are reserved or used.')
  if(usage!.discount+discountCents>promotion.max_discount_cents)deny('DISCOUNT_BUDGET','The remaining promotion budget cannot cover this discount.')
  if(reason){if(explicitCode)return refuse(reason,message);explanations.push({id:promotion.id,applied:false,reason});continue}
  components.push({id:promotion.id,revision:promotion.revision,kind:rule.type,discountCents,shippingDiscountCents:result.shippingDiscountCents,lineDiscounts:lines.map((l,i)=>({sku:l.sku,discountCents:result.lineDiscounts[i]})),...(explicitCode?{codeHash:selectedHash}:{})})
  applied.push(rule);result.lineDiscounts.forEach((value,i)=>remaining[i]-=value);shippingRemaining-=result.shippingDiscountCents;explanations.push({id:promotion.id,applied:true,reason:'QUALIFIED'})
 }
 if(!components.length)return {...refuse('NO_PROMOTIONS','No automatic promotion applies to this basket.'),explanations}
 const first=components[0],discountCents=components.reduce((n,c)=>n+c.discountCents,0),shippingDiscountCents=shippingCents-shippingRemaining
 const snapshot:PromotionSnapshot={id:first.id,revision:first.revision,kind:components.length===1&&first.kind==='free_shipping'?'free_shipping':'discounts',originalShippingCents:shippingCents,discountCents,shippingDiscountCents,lineDiscounts:lines.map((l,i)=>({sku:l.sku,discountCents:l.quantity*l.unitCents-remaining[i]})),components}
 return {applicable:true as const,reason:'QUALIFIED',message:snapshot.kind==='free_shipping'?'Free shipping applies. Availability is reserved when you create checkout.':'Promotions applied. Review the exact line discounts and total before paying.',discountCents,snapshot,customerKey:customer,explanations}
}
export function requireQualified(result:Awaited<ReturnType<typeof qualification>>) {if(!result.applicable)fail('PROMOTION_UNAVAILABLE',result.message,409);return result}
export async function purchasePromotion(env:Bindings,p:any,priced:Awaited<ReturnType<typeof priceSelection>>,verifiedEmail?:string) {
 const result=await qualification(env,p.promotionCode,email(p.customerEmail),priced.totalCents-priced.shippingCents,priced.shippingCents,priced.shipping.service.kind,{lines:priced.lines,shipping:priced.shipping,country:p.destination?.country??p.shopper?.address?.country,verifiedEmail})
 if(p.promotionCode!==undefined)return requireQualified(result)
 return result.applicable?result:undefined
}
export async function promotionQuote(env:Bindings,p:any,verifiedEmail?:string) {
 const priced=await priceSelection(env,selectLines(p.lines),undefined,p.shipping),qualified=await qualification(env,p.promotionCode,email(p.customerEmail),priced.totalCents-priced.shippingCents,priced.shippingCents,priced.shipping.service.kind,{lines:priced.lines,shipping:priced.shipping,country:p.destination?.country,verifiedEmail})
 const {applicable,reason,message,discountCents}=qualified
 return {applicable,reason,message,discountCents,originalShippingCents:priced.shippingCents,shippingCents:priced.shippingCents-(qualified.applicable?qualified.snapshot.shippingDiscountCents??discountCents:0),totalCents:priced.totalCents-discountCents,currency:'usd',shipping:priced.shipping,...('explanations' in qualified?{explanations:qualified.explanations}:{}),...(qualified.applicable?{promotion:qualified.snapshot,lineDiscounts:qualified.snapshot.lineDiscounts}:{})}
}
export function reservePromotion(db:D1Database,order:Order,snapshot:PromotionSnapshot,customer:string) {
 return (snapshot.components??[{...snapshot,codeHash:undefined}]).map(component=>db.prepare("INSERT INTO st_promotion_allocations(order_id,promotion_id,promotion_revision,customer_key,discount_cents,status,reserved_at,code_hash) VALUES(?,?,?,?,?,'reserved',?,?)").bind(order.id,component.id,component.revision,customer,component.discountCents,order.createdAt,component.codeHash??null))
}
