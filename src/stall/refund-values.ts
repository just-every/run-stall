import { refundTaxAllocation } from './tax/transactions-refunds'
import { fail, integer, text, type Order, type Refund, type RefundKind } from './model'

/** Pending money is already committed; failed/canceled attempts free its budget. */
export function refundValue(order: Order, input: any): Pick<Refund, 'kind'|'lines'|'amountCents'|'taxTreatment'|'accountingCategory'|'taxAllocation'> {
 const kind: RefundKind = input.kind ?? 'lines'
 if (!['lines', 'shipping', 'goodwill'].includes(kind)) fail('REFUND_KIND', 'Choose purchased items, shipping or goodwill.', 400)
 const committed = order.refunds.filter(refund => ['pending', 'succeeded'].includes(refund.status))
 let lines: Refund['lines'] = [], amountCents: number
 if (kind === 'lines') {
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > order.lines.length) fail('LINES', 'Choose the items to refund.', 400)
  if (input.amountCents !== undefined) fail('INPUT', 'Item refunds are computed from purchased quantities.', 400)
  const seen = new Set<string>()
  lines = input.lines.map((line: any) => {
   const sku = text(line.sku, 'SKU', 100), quantity = integer(line.quantity, 'Refund quantity', 1, 1000)
   const source = order.lines.find(item => item.sku === sku)
   if (!source || seen.has(sku)) fail('LINES', 'Choose distinct products from this order.', 400)
   seen.add(sku)
   const refunded = committed.reduce((sum, refund) => sum + (refund.lines.find(item => item.sku === sku)?.quantity ?? 0), 0)
   if (refunded + quantity > source.quantity) fail('REFUND_LIMIT', 'The requested quantity exceeds the unrefunded purchase.')
   return { sku, quantity }
  })
  amountCents = lines.reduce((sum, line) => sum + line.quantity * order.lines.find(item => item.sku === line.sku)!.unitCents, 0)
 } else {
  if (input.lines !== undefined && (!Array.isArray(input.lines) || input.lines.length)) fail('LINES', 'Shipping and goodwill refunds do not return purchased items.', 400)
  amountCents = integer(input.amountCents, 'Refund amount cents', 1, order.totalCents)
  if (kind === 'shipping') {
   const used = committed.filter(refund => refund.kind === 'shipping').reduce((sum, refund) => sum + (refund.taxAllocation?.shippingCents??refund.amountCents), 0)
   if (used + amountCents > (order.shippingCents ?? 0)) fail('REFUND_LIMIT', 'The shipping refund exceeds the unrefunded shipping paid.')
  }
 }
 const taxAllocation=refundTaxAllocation(order,{kind,lines,amountCents})
 amountCents+=taxAllocation?.taxCents??0
 if (committed.reduce((sum, refund) => sum + refund.amountCents, 0) + amountCents > order.totalCents) fail('REFUND_LIMIT', 'Refunds cannot exceed the paid amount.')
 return { kind, lines, amountCents, taxTreatment: taxAllocation?'original_tax_allocated':'no_tax_recorded',...(taxAllocation?{taxAllocation}:{}), accountingCategory: kind === 'lines' ? 'merchandise' : kind }
}
