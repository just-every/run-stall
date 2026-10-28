import type { Bindings } from '../../auth.server'
import { email,fail,type Order } from '../model'
import { priceSelection,selectLines } from '../order-selection'
import type { PromotionSnapshot } from './model'
import { evaluate } from './engine'
import { shippingDiscount } from './rules'
export { customerKey } from './identity'
export async function promotionQuote(env:Bindings,p:any,verifiedEmail?:string) {
 const priced=await priceSelection(env,selectLines(p.lines),undefined,p.shipping)
 const qualified=await evaluate(env,p.promotionCode,email(p.customerEmail),priced,verifiedEmail)
 const {applicable,reason,message,discountCents}=qualified
 return {applicable,reason,message,discountCents,originalShippingCents:priced.shippingCents,shippingCents:priced.shippingCents-(qualified.applicable?shippingDiscount(qualified.snapshot):0),totalCents:priced.totalCents-discountCents,currency:'usd',shipping:priced.shipping,...(qualified.applicable?{promotion:qualified.snapshot,messages:qualified.messages}:{})}
}
export function reservePromotions(db:D1Database,order:Order,snapshot:PromotionSnapshot,customer:string) {
 return (snapshot.components??[snapshot]).map(s=>db.prepare("INSERT INTO st_promotion_allocations(order_id,promotion_id,promotion_revision,customer_key,discount_cents,status,reserved_at,code_id) VALUES(?,?,?,?,?,'reserved',?,?)").bind(order.id,s.id,s.revision,customer,s.discountCents,order.createdAt,s.codeId??null))
}
