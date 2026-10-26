import { fail,type Order,type Refund } from '../model'
import type { TaxItem,TaxJurisdiction } from './commerce-provider'
import type { TaxRefundAllocation } from './transactions'

/** Cumulative rounding assigns the last cent to the final returned quantity. */
function share(value:number,before:number,amount:number,total:number) {
 const rounded=(quantity:number)=>Number((2n*BigInt(value)*BigInt(quantity)+BigInt(total))/(2n*BigInt(total)))
 return rounded(before+amount)-rounded(before)
}
const same=(a:TaxJurisdiction,b:TaxJurisdiction)=>a.level===b.level&&a.name===b.name&&a.state===b.state&&a.ratePercent===b.ratePercent
/** Stripe's reversal names no jurisdiction, so the refund tax is split over the original sale's provider breakdown by what remains unreversed; the largest remainders take the odd cents and the last return clears every jurisdiction exactly. */
function attribute(taxCents:number,original:TaxJurisdiction[],reversed:TaxJurisdiction[][],taxableCents:(j:TaxJurisdiction)=>number):TaxJurisdiction[] {
 const remaining=original.map(j=>j.amountCents-reversed.reduce((n,list)=>n+(list.find(r=>same(r,j))?.amountCents??0),0)),pool=remaining.reduce((n,v)=>n+v,0)
 if(!original.length||taxCents<=0||pool<taxCents)return []
 const floors=remaining.map(v=>Math.floor(taxCents*v/pool)),order=remaining.map((v,i)=>({i,rest:taxCents*v%pool})).sort((a,b)=>b.rest-a.rest||a.i-b.i)
 for(let left=taxCents-floors.reduce((n,v)=>n+v,0),k=0;left>0;left--,k++)floors[order[k].i]++
 return original.flatMap((j,i)=>floors[i]>0?[{...j,amountCents:floors[i],taxableCents:taxableCents(j)}]:[])
}
export function refundTaxAllocation(order:{tax?:Order['tax'];lines:{sku:string;quantity:number;unitCents:number}[];shippingCents?:number|null;refunds:Refund[]},refund:Pick<Refund,'kind'|'lines'|'amountCents'>):TaxRefundAllocation|undefined {
 if(!order.tax)return undefined
 if(!order.tax.transactionId)fail('TAX_RECOVERY','Record the paid order’s original Stripe Tax transaction before preparing a refund.')
 if(refund.kind==='goodwill')fail('TAX_REFUND_ALLOCATION','Taxed goodwill has no reviewed merchandise or shipping allocation. Choose purchased items or shipping instead.',409)
 const committed=order.refunds.filter(r=>['pending','succeeded'].includes(r.status))
 let shippingCents=0,shippingTaxCents=0,shippingJurisdictions:TaxJurisdiction[]=[],lines:TaxItem[]=[]
 if(refund.kind==='shipping') {
  shippingCents=refund.amountCents
  const before=committed.filter(r=>r.kind==='shipping').reduce((n,r)=>n+(r.taxAllocation?.shippingCents??r.amountCents),0),total=order.shippingCents??0
  if(!total||before+shippingCents>total)fail('REFUND_LIMIT','The shipping refund exceeds shipping paid.')
  shippingTaxCents=share(order.tax.shippingTaxCents,before,shippingCents,total)
  shippingJurisdictions=attribute(shippingTaxCents,order.tax.shippingJurisdictions,committed.map(r=>r.taxAllocation?.shippingJurisdictions??[]),j=>share(j.taxableCents,before,shippingCents,total))
 } else lines=refund.lines.map(line=>{
  const source=order.lines.find(l=>l.sku===line.sku)!,index=order.lines.indexOf(source),tax=order.tax!.lines.find(l=>l.reference==='line-'+index)
  if(!tax?.providerLineId)fail('TAX_RECOVERY','Recover the original tax transaction’s purchased line references.')
  const before=committed.reduce((n,r)=>n+(r.lines.find(l=>l.sku===line.sku)?.quantity??0),0)
  const taxCents=share(tax.taxCents,before,line.quantity,source.quantity)
  return {...tax,amount:line.quantity*source.unitCents,quantity:line.quantity,taxCents,taxableCents:share(tax.taxableCents,before,line.quantity,source.quantity),exemptCents:share(tax.exemptCents,before,line.quantity,source.quantity),jurisdictions:attribute(taxCents,tax.jurisdictions,committed.map(r=>r.taxAllocation?.lines.find(l=>l.reference===tax.reference)?.jurisdictions??[]),j=>share(j.taxableCents,before,line.quantity,source.quantity))}
 })
 return {lines,shippingCents,shippingTaxCents,taxCents:lines.reduce((n,l)=>n+l.taxCents,shippingTaxCents),shippingJurisdictions}
}
