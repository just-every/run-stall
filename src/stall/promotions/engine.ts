import type { Bindings } from '../../auth.server'
import { catalogue } from '../pier'
import { collections } from '../collections'
import { merchandising } from '../merchandising'
import { collectionMembers } from '../discover'
import { digest } from '../access'
import { fail,type Line,type OrderShipping } from '../model'
import { category,benefit,type Rule,type Target } from './rules'
import type { Promotion,PromotionSnapshot } from './model'
import { promotionCode } from './model'
import { customerKey } from './identity'

type Priced={lines:Line[];shippingCents:number;totalCents:number;shipping:OrderShipping}
export type Qualified={applicable:true;reason:string;message:string;discountCents:number;snapshot:PromotionSnapshot;customerKey:string;messages:{id:string;reason:string;message:string}[]}
const refused=(reason:string,message:string)=>({applicable:false as const,reason,message,discountCents:0})
export async function evaluate(env:Bindings,code:unknown,address:string,priced:Priced,verifiedEmail?:string):Promise<Qualified|ReturnType<typeof refused>> {
 const hash=code===undefined?null:await digest(promotionCode(code)),customer=await customerKey(env,address)
 const rows=(await env.DB.prepare(`SELECT p.*,r.value_json AS rule_json,c.id AS code_id FROM st_promotions p LEFT JOIN st_promotion_rules r ON r.promotion_id=p.id LEFT JOIN st_promotion_codes c ON c.promotion_id=p.id AND c.code_hash=? WHERE p.code_hash=? OR c.id IS NOT NULL OR json_extract(r.value_json,'$.mode')='automatic' ORDER BY CASE WHEN p.code_hash=? OR c.id IS NOT NULL THEN 0 ELSE 1 END,CASE json_extract(r.value_json,'$.type') WHEN 'product' THEN 0 WHEN 'buy_get' THEN 0 WHEN 'order' THEN 1 ELSE 2 END,p.id`).bind(hash,hash,hash).all<Promotion&{rule_json:string|null;code_id:string|null}>()).results
 if(hash&&!rows.some(p=>p.code_hash===hash||p.code_id))return refused('UNKNOWN_CODE','This promotion code is not available.')
 const discounts=priced.lines.map(()=>0),selected:PromotionSnapshot[]=[],messages:Qualified['messages']=[]
 let shippingCents=0
 let source:Awaited<ReturnType<typeof catalogue>>|undefined,saved:Awaited<ReturnType<typeof collections>>|undefined,config:Awaited<ReturnType<typeof merchandising>>|undefined
 async function indices(target:Target) {
  if(!target.skus.length&&!target.products.length&&!target.collections.length)return priced.lines.map((_,i)=>i)
  const products=new Set(target.products)
  if(target.collections.length) {source??=await catalogue(env);saved??=await collections(env.DB);config??=await merchandising(env.DB);for(const handle of target.collections)for(const product of collectionMembers({...source,collections:saved,config:config.value},handle))products.add(product.sku)}
  return priced.lines.flatMap((line,i)=>target.skus.includes(line.sku)||products.has(line.productSku??line.sku)?[i]:[])
 }
 const subtotal=priced.totalCents-priced.shippingCents
 for(const p of rows) {
  const explicit=!!hash&&(p.code_hash===hash||!!p.code_id),rule:Rule|null=p.rule_json?JSON.parse(p.rule_json):null
  let rejection:ReturnType<typeof refused>|undefined
  const no=(reason:string,message:string)=>{rejection=refused(reason,message)}
  const at=new Date().toISOString()
  if(p.revoked_at)no('REVOKED','This promotion has been revoked.')
  else if(!await env.DB.prepare("SELECT 1 FROM st_promotion_authority a JOIN oa_operators o ON o.id=a.custodian_id WHERE a.promotion_id=? AND a.revision=? AND o.version=a.custodian_version AND o.status='active' AND (o.role='owner' OR (o.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id)))").bind(p.id,p.revision).first())no('AUTHORITY_REQUIRED','The owner or an administrator must review and enable this promotion again.')
  else if(at<p.starts_at)no('NOT_STARTED','This promotion has not started.')
  else if(at>=p.ends_at)no('ENDED','This promotion has ended.')
  else if(subtotal<p.minimum_cents)no('MINIMUM_BASKET','The merchandise subtotal is below this promotion’s minimum basket amount.')
  const type=rule?category(rule):'shipping'
  if(!rejection&&rule) {
   if(priced.lines.reduce((n,l)=>n+l.quantity,0)<rule.minimumQuantity)no('MINIMUM_QUANTITY','The basket does not contain the required quantity.')
   else if(rule.countries.length&&!rule.countries.includes('US'))no('DESTINATION','This promotion does not serve this delivery country.')
   else if(rule.zipPrefixes.length&&!rule.zipPrefixes.some(prefix=>priced.shipping.postalCode?.startsWith(prefix)))no('DESTINATION','This promotion does not serve this delivery zone.')
   else if(rule.customers.length||rule.segments.length) {
    // A supplied checkout mailbox alone never earns a restricted customer benefit.
    const profile=verifiedEmail===address?await env.DB.prepare('SELECT customer_id FROM st_customer_emails WHERE email=?').bind(address).first<{customer_id:string}>():null
    let eligible=!!profile&&rule.customers.includes(profile.customer_id)
    if(profile&&rule.segments.length) {
     const {inPromotionSegment}=await import('../customers/directory')
     eligible||=await inPromotionSegment(env,address,rule.segments)
    }
    if(!eligible)no('CUSTOMER_ELIGIBILITY','Sign in with an eligible customer account to use this promotion.')
   }
   if(!rejection&&selected.some(s=>{const other=s.rule?category(s.rule):'shipping';return !rule.combines.includes(other)||!s.rule?.combines.includes(type)}))no('COMBINATION','This promotion cannot combine with the selected discounts.')
  } else if(!rejection&&selected.length)no('COMBINATION','This promotion cannot combine with the selected discounts.')
  const allocation=priced.lines.map(()=>0)
  let shipping=0
  if(!rejection) {
   if(type==='shipping') {
    if(priced.shipping.service.kind!=='ship'||priced.shippingCents<=0)no('NO_SHIPPING_CHARGE','This promotion requires a paid shipping service.')
    else if(rule?.maximumShippingCents&&priced.shippingCents>rule.maximumShippingCents)no('MAXIMUM_RATE','The chosen shipping rate exceeds this promotion’s maximum.')
    else shipping=priced.shippingCents-shippingCents
   } else {
    const matched=await indices(rule!.targets),remaining=(i:number)=>priced.lines[i].unitCents*priced.lines[i].quantity-discounts[i]
    if(rule!.type==='buy_get') {
     const buy=rule!.buy!,buyIndices=await indices(buy.targets)
     // Reward units are excluded from qualifying units, including same-product BOGO.
     const units=matched.flatMap(i=>Array.from({length:priced.lines[i].quantity},()=>({i,unit:priced.lines[i].unitCents}))).sort((a,b)=>a.unit-b.unit||a.i-b.i)
     let uses=0,rewards=0
     for(let use=1;use<=buy.maxUses;use++) {
      const count=use*buy.getQuantity;if(count>units.length)break
      const consumed=units.slice(0,count),excluded=new Map<number,number>()
      for(const u of consumed)excluded.set(u.i,(excluded.get(u.i)??0)+1)
      const qty=buyIndices.reduce((n,i)=>n+priced.lines[i].quantity-(excluded.get(i)??0),0),spend=buyIndices.reduce((n,i)=>n+(priced.lines[i].quantity-(excluded.get(i)??0))*priced.lines[i].unitCents,0)
      if(qty<buy.quantity*use||spend<buy.spendCents*use)break
      uses=use;rewards=count
     }
     if(!uses)no('BUY_REQUIREMENT','Add the qualifying items and reward items to this basket.')
     else for(const unit of units.slice(0,rewards))allocation[unit.i]+=benefit(unit.unit,rule!.benefit)
     allocation.forEach((v,i)=>allocation[i]=Math.min(v,remaining(i)))
    } else {
     const weights=priced.lines.map((_,i)=>matched.includes(i)?remaining(i):0),pool=weights.reduce((n,v)=>n+v,0),amount=benefit(pool,rule!.benefit)
     if(!pool)no('NO_ELIGIBLE_ITEMS','This basket has no eligible merchandise.')
     else {const {allocate}=await import('../analytics/money');allocate(amount,weights).forEach((v,i)=>allocation[i]=v)}
    }
   }
  }
  const amount=allocation.reduce((n,v)=>n+v,shipping)
  if(!rejection&&amount<=0)no('NO_DISCOUNT','No further discount applies to this basket.')
  if(!rejection) {
   const usage=(await env.DB.prepare('SELECT COUNT(*) AS uses,COALESCE(SUM(discount_cents),0) AS discount,COALESCE(SUM(CASE WHEN customer_key=? THEN 1 ELSE 0 END),0) AS customerUses FROM st_promotion_allocations WHERE promotion_id=?').bind(customer,p.id).first<{uses:number;discount:number;customerUses:number}>())!
   if(p.code_id&&await env.DB.prepare('SELECT 1 FROM st_promotion_allocations WHERE code_id=?').bind(p.code_id).first())no('CODE_USED','This single-use code is already reserved or redeemed.')
   else if(usage.customerUses>=p.max_customer_uses)no('CUSTOMER_LIMIT','This customer has already reserved or used the allowed number of checkouts.')
   else if(usage.uses>=p.max_total_uses)no('TOTAL_LIMIT','All checkouts available under this promotion are reserved or used.')
   else if(usage.discount+amount>p.max_discount_cents)no('DISCOUNT_BUDGET','The remaining promotion budget cannot cover this discount.')
  }
  if(rejection) {if(explicit)return rejection;messages.push({id:p.id,...rejection});continue}
  const snapshot:PromotionSnapshot={id:p.id,revision:p.revision,kind:rule?(rule.type==='shipping'?'free_shipping':rule.type):'free_shipping',originalShippingCents:priced.shippingCents,discountCents:amount,...(rule?{rule,shippingDiscountCents:shipping,lineDiscounts:priced.lines.map((l,i)=>({sku:l.sku,discountCents:allocation[i]}))}:{}),...(p.code_id?{codeId:p.code_id}:{})}
  selected.push(snapshot);allocation.forEach((v,i)=>discounts[i]+=v);shippingCents+=shipping
  messages.push({id:p.id,reason:'QUALIFIED',message:rule&&rule.type!=='shipping'?'Promotion applied. Availability is reserved at checkout.':'Free shipping applies. Availability is reserved when you create checkout.'})
 }
 if(!selected.length)return refused('NO_PROMOTION','No automatic promotion applies to this basket.')
 const snapshot=selected.length===1?selected[0]:{...selected[0],kind:'combined' as const,discountCents:selected.reduce((n,s)=>n+s.discountCents,0),shippingDiscountCents:shippingCents,lineDiscounts:priced.lines.map((l,i)=>({sku:l.sku,discountCents:discounts[i]})),components:selected}
 return {applicable:true,reason:'QUALIFIED',message:messages.filter(m=>m.reason==='QUALIFIED').map(m=>m.message).join(' '),discountCents:snapshot.discountCents,snapshot,customerKey:customer,messages}
}
export async function purchasePromotion(env:Bindings,code:unknown,address:string,priced:Priced,verifiedEmail?:string) {
 const result=await evaluate(env,code,address,priced,verifiedEmail)
 if(result.applicable)return result
 if(code!==undefined)fail('PROMOTION_UNAVAILABLE',result.message,409)
 return undefined
}
export function discountedLines(lines:Line[],snapshot?:PromotionSnapshot) {return lines.map(l=>{const amount=snapshot?.lineDiscounts?.find(a=>a.sku===l.sku)?.discountCents??0;return amount?{...l,discountCents:amount}:l})}
