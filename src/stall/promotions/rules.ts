import { fail,integer,text,type Line,type Order } from '../model'

export type Target={skus:string[];products:string[];collections:string[]}
export type Benefit={kind:'percentage'|'amount';value:number}
export type Rule={mode:'code'|'automatic';type:'product'|'order'|'buy_get'|'shipping';targets:Target;benefit:Benefit;minimumQuantity:number;countries:string[];zipPrefixes:string[];maximumShippingCents:number|null;customers:string[];segments:string[];combines:('product'|'order'|'shipping')[];buy?:{targets:Target;quantity:number;spendCents:number;getQuantity:number;maxUses:number}}
const list=(v:unknown,name:string,max=100)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>max)fail('INPUT',`${name} must be a bounded list.`,400);return [...new Set(v.map(x=>text(x,name,100)))]}
const target=(v:any):Target=>({skus:list(v?.skus,'Variant SKUs'),products:list(v?.products,'Product SKUs'),collections:list(v?.collections,'Collection handles')})
export function readRule(v:any):Rule {
 if(!v||!['code','automatic'].includes(v.mode)||!['product','order','buy_get','shipping'].includes(v.type))fail('INPUT','Choose a code or automatic promotion and a supported discount type.',400)
 const kind=v.benefit?.kind??'percentage'
 if(!['percentage','amount'].includes(kind))fail('INPUT','Choose an amount or percentage benefit.',400)
 const combines=list(v.combines,'Combination classes',3)
 if(combines.some(x=>!['product','order','shipping'].includes(x)))fail('INPUT','Combine product, order or shipping discounts.',400)
 const rule:Rule={mode:v.mode,type:v.type,targets:target(v.targets),benefit:{kind,value:integer(v.benefit?.value??100,'Benefit',1,kind==='percentage'?100:99999999)},minimumQuantity:integer(v.minimumQuantity??0,'Minimum quantity',0,50000),countries:list(v.countries,'Countries'),zipPrefixes:list(v.zipPrefixes,'ZIP prefixes'),maximumShippingCents:v.maximumShippingCents==null?null:integer(v.maximumShippingCents,'Maximum shipping rate cents',1,99999999),customers:list(v.customers,'Customer IDs'),segments:list(v.segments,'Segment IDs'),combines:combines as Rule['combines']}
 if(rule.countries.some(c=>! /^[A-Z]{2}$/.test(c))||rule.zipPrefixes.some(c=>! /^\d{1,5}$/.test(c)))fail('INPUT','Use two-letter countries and numeric US ZIP prefixes.',400)
 if(rule.type==='buy_get')rule.buy={targets:target(v.buy?.targets),quantity:integer(v.buy?.quantity??0,'Buy quantity',0,50000),spendCents:integer(v.buy?.spendCents??0,'Buy spend cents',0,99999999),getQuantity:integer(v.buy?.getQuantity,'Reward quantity',1,1000),maxUses:integer(v.buy?.maxUses,'Per-order uses',1,1000)}
 if(rule.buy&&!rule.buy.quantity&&!rule.buy.spendCents)fail('INPUT','Buy X get Y requires a buy quantity or spend.',400)
 return rule
}
export const category=(rule:Rule)=>rule.type==='buy_get'?'product':rule.type
export const benefit=(amount:number,value:Benefit)=>Math.min(amount,value.kind==='percentage'?Math.floor(amount*value.value/100):value.value)
/** Cumulative integer rounding makes partial returns sum to the amount actually paid. */
export function portion(total:number,before:number,quantity:number,count:number) {return Math.floor((total*(before+quantity)+count/2)/count)-Math.floor((total*before+count/2)/count)}
export const linePaid=(line:Pick<Line,'unitCents'|'quantity'|'discountCents'>)=>line.unitCents*line.quantity-(line.discountCents??0)
export const shippingDiscount=(snapshot:Order['promotion'])=>snapshot?.shippingDiscountCents??(snapshot?.kind==='free_shipping'?snapshot.discountCents:0)
export function refundedLine(order:Pick<Order,'lines'|'refunds'>,sku:string,quantity:number) {
 const line=order.lines.find(l=>l.sku===sku)!,before=order.refunds.filter(r=>['pending','succeeded'].includes(r.status)).reduce((n,r)=>n+(r.lines.find(l=>l.sku===sku)?.quantity??0),0)
 return portion(linePaid(line),before,quantity,line.quantity)
}
