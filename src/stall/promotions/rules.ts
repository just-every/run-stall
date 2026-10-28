import { fail,integer,text } from '../model'
export type Targets={products:string[];variants:string[];collections:string[]}
export type Rule={method:'code'|'automatic';type:'free_shipping'|'product'|'order'|'buy_get';valueType:'free'|'percentage'|'amount';value:number;targets:Targets;buy:Targets;minimumQuantity:number;buyQuantity:number;buySpendCents:number;getQuantity:number;maxApplications:number;countries:string[];zones:string[];maximumRateCents:number|null;customerIds:string[];segmentIds:string[];combines:{product:boolean;order:boolean;shipping:boolean}}
const list=(v:any,label:string)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>100)fail('INPUT',`${label} needs at most 100 entries.`,400);return [...new Set(v.map(x=>text(x,label,100)))]}
const targets=(v:any={}):Targets=>({products:list(v.products,'Product SKU'),variants:list(v.variants,'Variant SKU'),collections:list(v.collections,'Collection handle')})
export function promotionRule(v:any={}):Rule {
 const method=v.method??'code',type=v.type??'free_shipping',valueType=type==='free_shipping'?'free':v.valueType??'percentage'
 if(!['code','automatic'].includes(method)||!['free_shipping','product','order','buy_get'].includes(type)||!['free','percentage','amount'].includes(valueType))fail('INPUT','Choose a supported promotion method, type and value.',400)
 const result:Rule={method,type,valueType,value:valueType==='free'?0:integer(v.value,'Discount value',1,valueType==='percentage'?10000:99999999),targets:targets(v.targets),buy:targets(v.buy),minimumQuantity:integer(v.minimumQuantity??0,'Minimum quantity',0,50000),buyQuantity:integer(v.buyQuantity??1,'Buy quantity',1,50000),buySpendCents:integer(v.buySpendCents??0,'Qualifying spend cents',0,99999999),getQuantity:integer(v.getQuantity??1,'Get quantity',1,50000),maxApplications:integer(v.maxApplications??1,'Applications per order',1,1000),countries:list(v.countries,'Country'),zones:list(v.zones,'Shipping zone prefix'),maximumRateCents:v.maximumRateCents==null?null:integer(v.maximumRateCents,'Maximum shipping rate',0,99999999),customerIds:list(v.customerIds,'Customer ID'),segmentIds:list(v.segmentIds,'Segment ID'),combines:{product:v.combines?.product===true,order:v.combines?.order===true,shipping:v.combines?.shipping===true}}
 if(result.countries.some(c=>! /^[A-Z]{2}$/.test(c))||result.zones.some(z=>!/^\d{1,5}$/.test(z)))fail('INPUT','Use two-letter countries and numeric ZIP prefixes.',400)
 if(['product','buy_get'].includes(type)&&!Object.values(result.targets).some(v=>v.length))fail('INPUT','Choose the discounted products, variants or collections.',400)
 return result
}
export const storedRule=(row:{rule_json?:string|null})=>promotionRule(row.rule_json?JSON.parse(row.rule_json):{})
export const discountClass=(rule:Rule)=>rule.type==='free_shipping'?'shipping':rule.type==='order'?'order':'product'
