import type { CostRecord,Money,ReportLine,ReportOrder } from './report-model'

/** Integer largest remainder allocation keeps every cent in the report. */
export function allocate(total:number,weights:number[]):number[] {
 const sum=weights.reduce((n,v)=>n+v,0)
 if(!sum)return weights.map((_,i)=>i===0?total:0)
 const parts=weights.map((weight,i)=>{const value=BigInt(total)*BigInt(weight);return {i,cents:Number(value/BigInt(sum)),remainder:value%BigInt(sum)}})
 let remaining=total-parts.reduce((n,p)=>n+p.cents,0)
 for(const part of [...parts].sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1)) {if(remaining<=0)break;part.cents++;remaining--}
 return parts.map(p=>p.cents)
}
export function orderMoney(order:ReportOrder,cost:CostRecord|null,costEnabled:boolean):{money:Money;lines:ReportLine[]} {
 const refunds=order.refunds.filter(r=>r.status==='succeeded'),refundsCents=refunds.reduce((n,r)=>n+r.amountCents,0)
 const grossSalesCents=order.lines.reduce((n,l)=>n+l.quantity*l.unitCents,0)
 const discountsCents=order.promotion?.discountCents??0
 const shipping=order.shippingCents??0
 const fullReversal=refunds.some(r=>r.kind==='address_change')
 const refundedTax=refunds.reduce((n,r)=>n+(r.taxAllocation?.taxCents??(r.kind==='address_change'?(order.tax?.taxCents??0):0)),0)
 const refundedShipping=refunds.reduce((n,r)=>n+(r.taxAllocation?.shippingCents??(r.kind==='shipping'?r.amountCents:r.kind==='address_change'?shipping:0)),0)
 const merchandiseRefund=refundsCents-refundedTax-refundedShipping
 const merchandiseDiscount=order.lines.reduce((n,l)=>n+(l.discountCents??0),0)
 const netSalesCents=grossSalesCents-merchandiseDiscount-merchandiseRefund
 const lineRefunds=order.lines.map(line=>fullReversal?line.quantity:refunds.reduce((n,r)=>n+(r.lines.find(l=>l.sku===line.sku)?.quantity??0),0))
 const itemWeights=order.lines.map((line,i)=>lineRefunds[i]*line.unitCents)
 const itemRefunds=itemWeights.reduce((n,v)=>n+v,0)
 const direct=allocate(Math.min(merchandiseRefund,itemRefunds),itemWeights),other=allocate(Math.max(0,merchandiseRefund-itemRefunds),order.lines.map(line=>line.quantity*line.unitCents))
 const allocated=direct.map((value,i)=>value+other[i])
 const lines=order.lines.map((line,i)=>({sku:line.sku,productSku:line.productSku??line.sku,name:line.name,quantity:line.quantity,unitCents:line.unitCents,refundedQuantity:lineRefunds[i],grossSalesCents:line.quantity*line.unitCents,netSalesCents:line.quantity*line.unitCents-(line.discountCents??0)-allocated[i]}))
 const shippingCollectedCents=shipping-refundedShipping,taxCents=order.tax?order.tax.taxCents-refundedTax:null
 const shippingCostCents=costEnabled?(cost?.shippingCostCents??null):null,feesCents=costEnabled?(cost?.feesCents??null):null,itemCostCents=costEnabled?(cost?.itemCostCents??null):null
 return {lines,money:{grossSalesCents,discountsCents,netSalesCents,taxCents,shippingCollectedCents,refundsCents,netCollectedCents:order.totalCents-refundsCents,shippingCostCents,feesCents,itemCostCents,contributionMarginCents:shippingCostCents===null||feesCents===null||itemCostCents===null?null:netSalesCents+shippingCollectedCents-shippingCostCents-feesCents-itemCostCents,giftLiabilityCents:costEnabled?(cost?.giftLiabilityCents??null):null}}
}
export function sumMoney(rows:Money[]):Money {
 const sum=(key:keyof Money)=>rows.reduce((n,row)=>n+(row[key]??0),0)
 const known=(key:keyof Money)=>rows.length&&rows.every(row=>row[key]!==null)?sum(key):null
 return {grossSalesCents:sum('grossSalesCents'),discountsCents:sum('discountsCents'),netSalesCents:sum('netSalesCents'),taxCents:known('taxCents'),shippingCollectedCents:sum('shippingCollectedCents'),refundsCents:sum('refundsCents'),netCollectedCents:sum('netCollectedCents'),shippingCostCents:known('shippingCostCents'),feesCents:known('feesCents'),itemCostCents:known('itemCostCents'),contributionMarginCents:known('contributionMarginCents'),giftLiabilityCents:known('giftLiabilityCents')}
}
