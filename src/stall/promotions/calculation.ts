import type { Line } from '../model'
import type { Rule,Targets } from './rules'
import { allocate } from '../analytics/money'
/** All calculations use extended integer cents. Fixed discounts apply once per selected basket. */
export function calculate(rule:Rule,lines:Line[],remaining:number[],shippingCents:number,matches:(target:Targets,line:Line)=>boolean) {
 const eligible=lines.map((line,i)=>matches(rule.targets,line)?i:-1).filter(i=>i>=0),discounts=lines.map(()=>0)
 const amount=(cents:number)=>rule.valueType==='free'?cents:rule.valueType==='amount'?Math.min(cents,rule.value):Math.floor(cents*rule.value/10000)
 if(rule.type==='free_shipping')return {lineDiscounts:discounts,shippingDiscountCents:shippingCents}
 if(rule.type==='buy_get') {
  const buy=lines.map((line,i)=>matches(rule.buy,line)?i:-1).filter(i=>i>=0)
  // Reward units are removed before evaluating qualifying units; a BOGO never buys itself.
  const units=lines.map(line=>line.quantity),reserved=lines.map(()=>0)
  const cheapest=[...eligible].sort((a,b)=>remaining[a]/lines[a].quantity-remaining[b]/lines[b].quantity||a-b)
  for(let application=0;application<rule.maxApplications;application++) {
   const wanted=lines.map(()=>0);let needed=rule.getQuantity
   for(const i of cheapest){const n=Math.min(units[i],needed);wanted[i]=n;needed-=n}
   if(needed)break
   const quantity=buy.reduce((n,i)=>n+units[i]-wanted[i],0),spend=buy.reduce((n,i)=>n+Math.floor(remaining[i]*(units[i]-wanted[i])/lines[i].quantity),0)
   if(rule.buySpendCents?spend<rule.buySpendCents:quantity<rule.buyQuantity)break
   for(const i of cheapest){units[i]-=wanted[i];reserved[i]+=wanted[i]}
   // Each application also consumes its qualifying units, choosing deterministic SKU order.
   let qty=rule.buySpendCents?0:rule.buyQuantity,spendNeeded=rule.buySpendCents
   for(const i of buy)while(units[i]>0&&(qty>0||spendNeeded>0)){units[i]--;qty--;spendNeeded-=Math.floor(remaining[i]/lines[i].quantity)}
  }
  for(const i of eligible)discounts[i]=amount(Math.floor(remaining[i]*reserved[i]/lines[i].quantity))
 } else {
  const indexes=rule.type==='order'?lines.map((_,i)=>i):eligible,weights=indexes.map(i=>remaining[i]),total=weights.reduce((n,v)=>n+v,0),parts=allocate(amount(total),weights)
  indexes.forEach((i,n)=>discounts[i]=parts[n])
 }
 return {lineDiscounts:discounts,shippingDiscountCents:0}
}
