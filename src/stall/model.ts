export class Problem extends Error {
 constructor(public code:string, message:string, public status=409) { super(message) }
}
export function fail(code:string,message:string,status=409):never { throw new Problem(code,message,status) }
export type Actor={id:string;email:string;role:string;version:number;sessionId?:string;agent:boolean;grantId?:string}
export type ProductValue={sku:string;name:string;description:string;unitCents:number;active:boolean;draft?:Omit<ProductValue,'draft'>;approval?:Approval}
export type Product={id:string;value:ProductValue;revision:string}
export type Approval={by:string;version:number;at:string;revision:string}
export type Line={sku:string;name:string;itemId:string;quantity:number;unitCents:number}
export type RefundKind='lines'|'shipping'|'goodwill'
export type Refund={kind?:RefundKind;taxTreatment?:'no_tax_recorded';accountingCategory?:'merchandise'|'shipping'|'goodwill';id:string;lines:{sku:string;quantity:number}[];amountCents:number;reason:string;status:'draft'|'pending'|'succeeded'|'failed'|'canceled';preparedBy:string;approval?:Approval;startedAt?:string;stripeId?:string}
export type PierDispatch={id:string;reference:string;shippedAt?:string;deliveryStatus?:string;tracking:{carton?:number;trackingCode?:string;trackingUrl?:string}[]}
export type Shipment={id:string;reference:string;status:'draft'|'pending'|'partial'|'shipped';preparedBy:string;approval?:Approval;pierShipmentId?:string;dispatches?:PierDispatch[]}
// The shop sells in US dollars and ships within the United States (Stripe's codes).
export const shopCurrency='usd'
export const shopCountry='US'
export type Order={id:string;revision:string;customerEmail:string|null;erasedAt?:string;lines:Line[];totalCents:number;shippingCents?:number;currency:typeof shopCurrency;status:'checkout_pending'|'awaiting_payment'|'paid'|'shortfall'|'reserved'|'shipped';createdAt:string;shippingDetails?:{name:string;address:{line1:string;line2:string;city:string;state:string;postal_code:string;country:string}};requestDigest:string;checkoutKey:string;pierOrigin:string;pierCustomerId:string;checkout?:{id:string;url:string};payment?:{sessionId:string;intentId:string;paidAt:string};reservation?:{id:string;reference:string;lines:any[]};shipment?:Shipment;refunds:Refund[]}
export const text=(v:unknown,name:string,limit=160):string=>typeof v==='string'&&v.trim()&&v.length<=limit?v.trim():fail('INPUT',`${name} is required (at most ${limit} characters).`,400)
export const integer=(v:unknown,name:string,min=0,max=100000000):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail('INPUT',`${name} must be a whole number between ${min} and ${max}.`,400)
export const supplier=(a:Actor)=>['owner','admin'].includes(a.role)
export function requireSupplier(a:Actor) { if(!supplier(a)) fail('FORBIDDEN','Only an owner or administrator may manage the shop.',403) }
export function requirePerson(a:Actor) { if(a.agent) fail('PERSON_REQUIRED','Agents prepare drafts; a person must approve this exact revision.',403) }
export const actorLabel=(a:Actor)=>a.agent?`agent:${a.grantId}`:a.id
export const approval=(a:Actor,revision:string):Approval=>({by:a.id,version:a.version,at:new Date().toISOString(),revision})
export function email(value:unknown) { const e=text(value,'Customer email',254).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail('INPUT','Enter a valid customer email.',400); return e }
