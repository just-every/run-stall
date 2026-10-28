import { fail,text } from '../model'

export type PromotionSnapshot={id:string;revision:string;kind:'free_shipping'|'discounts';originalShippingCents:number;discountCents:number;shippingDiscountCents?:number;lineDiscounts?:{sku:string;discountCents:number}[];components?:PromotionComponent[]}
export type PromotionComponent={id:string;revision:string;kind:'product'|'order'|'buy_get'|'free_shipping';discountCents:number;shippingDiscountCents:number;lineDiscounts:{sku:string;discountCents:number}[];codeHash?:string}
export type Promotion={rule_json?:string|null;id:string;revision:string;code_hash:string;starts_at:string;ends_at:string;minimum_cents:number;max_customer_uses:number;max_total_uses:number;max_discount_cents:number;revoked_at:string|null;created_at:string;updated_at:string}
export function promotionCode(value:unknown) {
 const code=text(value,'Promotion code',320).toUpperCase().split(',').map(c=>c.trim()).sort().join(',')
 const parts=code.split(',')
 if(parts.length>5||new Set(parts).size!==parts.length||parts.some(part=>!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(part)))fail('INPUT','Use up to five distinct codes of 3 to 64 letters, numbers, underscores or hyphens, separated by commas.',400)
 return code
}
export function instant(value:unknown,name:string) {
 const raw=text(value,name,40)
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(raw)||!Number.isFinite(Date.parse(raw))) fail('INPUT',`${name} must be an ISO instant with a time zone.`,400)
 return new Date(raw).toISOString()
}
