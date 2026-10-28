import { fail,text } from '../model'

export type PromotionSnapshot={id:string;revision:string;kind:'free_shipping'|'product'|'order'|'buy_get'|'combined';originalShippingCents:number;discountCents:number;shippingDiscountCents?:number;lineDiscounts?:{sku:string;discountCents:number}[];rule?:import('./rules').Rule;codeId?:string;components?:PromotionSnapshot[]}
export type Promotion={id:string;revision:string;code_hash:string;starts_at:string;ends_at:string;minimum_cents:number;max_customer_uses:number;max_total_uses:number;max_discount_cents:number;revoked_at:string|null;created_at:string;updated_at:string}
export function promotionCode(value:unknown) {
 const code=text(value,'Promotion code',64).toUpperCase()
 if(!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(code)) fail('INPUT','Use a promotion code of 3 to 64 letters, numbers, underscores or hyphens.',400)
 return code
}
export function instant(value:unknown,name:string) {
 const raw=text(value,name,40)
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(raw)||!Number.isFinite(Date.parse(raw))) fail('INPUT',`${name} must be an ISO instant with a time zone.`,400)
 return new Date(raw).toISOString()
}
