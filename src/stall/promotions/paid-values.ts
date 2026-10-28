import type { Order } from '../model'
/** Cumulative floor rounding returns each paid cent once, including the final odd cent. */
export function refundedLineCents(order:Pick<Order,'promotion'|'refunds'>&{lines:{sku:string;quantity:number;unitCents:number}[]},sku:string,quantity:number) {
 const line=order.lines.find(l=>l.sku===sku)!,discount=order.promotion?.lineDiscounts?.find(l=>l.sku===sku)?.discountCents??0,total=line.quantity*line.unitCents-discount
 const before=order.refunds.filter(r=>['pending','succeeded'].includes(r.status)).reduce((n,r)=>n+(r.lines.find(l=>l.sku===sku)?.quantity??0),0)
 return Math.floor(total*(before+quantity)/line.quantity)-Math.floor(total*before/line.quantity)
}
export function netLineCents(order:Pick<Order,'promotion'>,line:{sku:string;quantity:number;unitCents:number}) {return line.quantity*line.unitCents-(order.promotion?.lineDiscounts?.find(l=>l.sku===line.sku)?.discountCents??0)}
