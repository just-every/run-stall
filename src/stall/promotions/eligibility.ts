import type { Bindings } from '../../auth.server'
import { digest } from '../access'
import { email,fail,type Order } from '../model'
import { priceSelection,selectLines } from '../order-selection'
import { promotionCode,type Promotion,type PromotionSnapshot } from './model'

type Usage={uses:number;discount:number;customerUses:number}
export async function customerKey(env:Bindings,address:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('stall-promotion-customer:'+email(address))))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function qualification(env:Bindings,code:unknown,address:string,subtotalCents:number,shippingCents:number,shippingKind:string) {
 const [hash,customer]=await Promise.all([digest(promotionCode(code)),customerKey(env,address)])
 const promotion=await env.DB.prepare('SELECT * FROM st_promotions WHERE code_hash=?').bind(hash).first<Promotion>()
 const refuse=(reason:string,message:string)=>({applicable:false as const,reason,message,discountCents:0})
 if(!promotion) return refuse('UNKNOWN_CODE','This promotion code is not available.')
 const at=new Date().toISOString()
 if(promotion.revoked_at) return refuse('REVOKED','This promotion has been revoked.')
 if(!await env.DB.prepare("SELECT 1 FROM st_promotion_authority a JOIN oa_operators o ON o.id=a.custodian_id WHERE a.promotion_id=? AND a.revision=? AND o.version=a.custodian_version AND o.status='active' AND (o.role='owner' OR (o.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff s WHERE s.actor_id=o.id)))").bind(promotion.id,promotion.revision).first()) return refuse('AUTHORITY_REQUIRED','The owner or an administrator must review and enable this promotion again.')
 if(at<promotion.starts_at) return refuse('NOT_STARTED','This promotion has not started.')
 if(at>=promotion.ends_at) return refuse('ENDED','This promotion has ended.')
 if(subtotalCents<promotion.minimum_cents) return refuse('MINIMUM_BASKET','The merchandise subtotal is below this promotion’s minimum basket amount.')
 if(shippingKind!=='ship'||shippingCents<=0) return refuse('NO_SHIPPING_CHARGE','This promotion requires a paid shipping service.')
 const usage=await env.DB.prepare('SELECT COUNT(*) AS uses,COALESCE(SUM(discount_cents),0) AS discount,COALESCE(SUM(CASE WHEN customer_key=? THEN 1 ELSE 0 END),0) AS customerUses FROM st_promotion_allocations WHERE promotion_id=?').bind(customer,promotion.id).first<Usage>()
 if(usage!.customerUses>=promotion.max_customer_uses) return refuse('CUSTOMER_LIMIT','This customer has already reserved or used the allowed number of checkouts.')
 if(usage!.uses>=promotion.max_total_uses) return refuse('TOTAL_LIMIT','All checkouts available under this promotion are reserved or used.')
 if(usage!.discount+shippingCents>promotion.max_discount_cents) return refuse('DISCOUNT_BUDGET','The remaining promotion budget cannot cover this shipping charge.')
 return {applicable:true as const,reason:'QUALIFIED',message:'Free shipping applies. Availability is reserved when you create checkout.',discountCents:shippingCents,snapshot:{id:promotion.id,revision:promotion.revision,kind:'free_shipping' as const,originalShippingCents:shippingCents,discountCents:shippingCents},customerKey:customer}
}
export async function promotionQuote(env:Bindings,p:any) {
 const priced=await priceSelection(env,selectLines(p.lines),undefined,p.shipping),subtotal=priced.totalCents-priced.shippingCents
 const qualified=await qualification(env,p.promotionCode,email(p.customerEmail),subtotal,priced.shippingCents,priced.shipping.service.kind)
 const {applicable,reason,message,discountCents}=qualified
 return {applicable,reason,message,discountCents,originalShippingCents:priced.shippingCents,shippingCents:priced.shippingCents-discountCents,totalCents:priced.totalCents-discountCents,currency:'usd',shipping:priced.shipping,...(qualified.applicable?{promotion:{id:qualified.snapshot.id,revision:qualified.snapshot.revision}}:{})}
}
export function requireQualified(result:Awaited<ReturnType<typeof qualification>>) {
 if(!result.applicable) fail('PROMOTION_UNAVAILABLE',result.message,409)
 return result
}
export function reservePromotion(db:D1Database,order:Order,snapshot:PromotionSnapshot,customer:string) {
 return db.prepare("INSERT INTO st_promotion_allocations(order_id,promotion_id,promotion_revision,customer_key,discount_cents,status,reserved_at) VALUES(?,?,?,?,?,'reserved',?)").bind(order.id,snapshot.id,snapshot.revision,customer,snapshot.discountCents,order.createdAt)
}
