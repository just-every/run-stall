import type { Bindings } from '../../auth.server'
import { live } from '../access'
import { fail, integer, text, type Actor } from '../model'
import { manager } from './management'

/** Commercial facts only: no code, customer identity, staff notes or provider credentials. */
export async function promotionReport(env: Bindings, actor: Actor, params: URLSearchParams) {
  manager(actor); await live(env, actor)
  const id = text(params.get('promotionId'), 'Promotion ID', 100)
  const after = params.get('after') ?? '', limit = params.has('limit') ? integer(Number(params.get('limit')), 'Report page size', 1, 100) : 50
  if (after && !/^[a-f\d-]{36}$/i.test(after)) fail('INPUT', 'Use the next report cursor returned by Stall.', 400)
  if (!await env.DB.prepare('SELECT id FROM st_promotions WHERE id=?').bind(id).first()) fail('NOT_FOUND', 'Promotion not found.', 404)
  const facts = `WITH facts AS (
    SELECT a.order_id AS orderId,a.promotion_revision AS promotionRevision,a.status,a.discount_cents AS discountCents,a.reserved_at AS reservedAt,a.used_at AS usedAt,
      json_extract(o.value_json,'$.totalCents') AS orderTotalCents,
      COALESCE(json_extract(o.value_json,'$.shippingCents'),0) AS shippingCents,
      CASE WHEN json_extract(o.value_json,'$.tax') IS NOT NULL THEN 'provider_calculated' ELSE COALESCE(json_extract(o.value_json,'$.taxTreatment'),'no_tax_recorded') END AS taxTreatment,
      json_extract(o.value_json,'$.tax.taxCents') AS taxCents,
      COALESCE((SELECT SUM(json_extract(r.value,'$.taxAllocation.taxCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='succeeded'),0) AS refundedTaxCents,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='succeeded'),0) AS refundedCents,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='pending'),0) AS pendingRefundCents,
      q.id AS qualificationEventId,d.id AS redemptionEventId
    FROM st_promotion_allocations a JOIN st_orders o ON o.id=a.order_id
    LEFT JOIN st_headless_events q ON q.id='promotion.qualified.'||a.order_id||CASE WHEN a.promotion_id=json_extract(o.value_json,'$.promotion.id') THEN '' ELSE '.'||a.promotion_id END
    LEFT JOIN st_headless_events d ON d.id='promotion.redeemed.'||a.order_id||CASE WHEN a.promotion_id=json_extract(o.value_json,'$.promotion.id') THEN '' ELSE '.'||a.promotion_id END
    WHERE a.promotion_id=?
  ) `
  // Both reads share one database transaction, including the full totals for every page.
  const [summary, page, taxSummary] = await env.DB.batch([
    env.DB.prepare(facts + `SELECT COUNT(*) AS checkouts,
      COUNT(CASE WHEN status='reserved' THEN 1 END) AS reservedUses,COUNT(CASE WHEN status='used' THEN 1 END) AS paidUses,
      COALESCE(SUM(discountCents),0) AS committedDiscountCents,
      COALESCE(SUM(CASE WHEN status='used' THEN orderTotalCents ELSE 0 END),0) AS grossPaidCents,
      COALESCE(SUM(CASE WHEN status='used' THEN refundedCents ELSE 0 END),0) AS refundedCents,
      COALESCE(SUM(CASE WHEN status='used' THEN pendingRefundCents ELSE 0 END),0) AS pendingRefundCents
      FROM facts`).bind(id),
    env.DB.prepare(facts + 'SELECT * FROM facts WHERE orderId>? ORDER BY orderId LIMIT ?').bind(id, after, limit + 1),
    env.DB.prepare(facts + `SELECT COUNT(CASE WHEN status='used' THEN 1 END) AS paid,COUNT(CASE WHEN status='used' AND taxCents IS NOT NULL THEN 1 END) AS priced,COALESCE(SUM(CASE WHEN status='used' THEN taxCents ELSE 0 END),0) AS taxCents,COALESCE(SUM(CASE WHEN status='used' THEN refundedTaxCents ELSE 0 END),0) AS refundedTaxCents FROM facts`).bind(id),
  ])
  const rows = page.results.slice(0, limit) as { orderId: string }[], totals = summary.results[0] as Record<string, number>
  const tax=taxSummary.results[0] as Record<string,number>
  return { taxTotals:{paidTaxCents:tax.paid&&tax.paid===tax.priced?tax.taxCents:null,refundedTaxCents:tax.refundedTaxCents},promotionId: id, currency: 'USD', totals: { ...totals, netPaidCents: totals.grossPaidCents - totals.refundedCents }, orders: rows,
    nextAfter: page.results.length > limit ? rows.at(-1)!.orderId : null,
    taxNotice: tax.priced?'Tax is recorded from the original provider calculations. Refund tax follows the original discounted lines. Unknown tax stays unknown.':'No tax was calculated for these orders. Tax amounts are unavailable; this report does not verify a zero tax obligation.',
    budgetPolicy: 'Paid checkouts permanently consume promotion budget; a reserved checkout releases it only once Stripe reports it expired or never created. Refunds do not restore it. Net paid subtracts succeeded refunds only; pending refunds are shown separately.' }
}

/** Combined totals count each purchase once even when it belongs to several promotions. */
export async function campaignReport(env:Bindings,actor:Actor) {
 manager(actor);await live(env,actor)
 const [allocations,orders,codes,events]=await env.DB.batch([
  env.DB.prepare('SELECT promotion_id AS promotionId,status,COUNT(*) AS uses,SUM(discount_cents) AS discountCents FROM st_promotion_allocations GROUP BY promotion_id,status ORDER BY promotion_id,status'),
  env.DB.prepare('SELECT DISTINCT o.id,o.value_json FROM st_orders o JOIN st_promotion_allocations a ON a.order_id=o.id ORDER BY o.id'),
  env.DB.prepare('SELECT c.promotion_id AS promotionId,c.label,COUNT(a.order_id) AS uses,COALESCE(SUM(a.discount_cents),0) AS discountCents FROM st_promotion_codes c LEFT JOIN st_promotion_allocations a ON a.code_hash=c.code_hash GROUP BY c.code_hash ORDER BY c.label'),
  env.DB.prepare("SELECT id,resource_id AS promotionId,occurred_at AS occurredAt FROM st_headless_events WHERE kind='promotion' ORDER BY occurred_at,id"),
 ])
 const rows=orders.results.map((row:any)=>{
  const o=JSON.parse(row.value_json),paid=!!o.payment,refunds=o.refunds.filter((r:any)=>r.status==='succeeded'),refundedCents=refunds.reduce((n:number,r:any)=>n+r.amountCents,0),refundedTaxCents=refunds.reduce((n:number,r:any)=>n+(r.taxAllocation?.taxCents??0),0)
  return {orderId:o.id,paid,subtotalCents:o.lines.reduce((n:number,l:any)=>n+l.unitCents*l.quantity,0),discountCents:o.promotion.discountCents,lineDiscountCents:o.promotion.lineDiscounts?.reduce((n:number,l:any)=>n+l.discountCents,0)??0,shippingCents:o.shippingCents??0,taxCents:o.tax?.taxCents??null,totalCents:o.totalCents,refundedCents,refundedTaxCents,netPaidCents:paid?o.totalCents-refundedCents:0,promotions:o.promotion.components?.map((c:any)=>({id:c.id,revision:c.revision,discountCents:c.discountCents}))??[{id:o.promotion.id,revision:o.promotion.revision,discountCents:o.promotion.discountCents}]}
 })
 const paid=rows.filter(r=>r.paid),sum=(key:keyof typeof rows[number])=>paid.reduce((n,r)=>n+Number(r[key]??0),0)
 return {currency:'USD',allocations:allocations.results,codes:codes.results,orders:rows,events:events.results,totals:{orders:rows.length,paidOrders:paid.length,subtotalCents:sum('subtotalCents'),discountCents:sum('discountCents'),lineDiscountCents:sum('lineDiscountCents'),shippingCents:sum('shippingCents'),taxCents:paid.length&&paid.every(r=>r.taxCents!==null)?sum('taxCents'):null,totalCents:sum('totalCents'),refundedCents:sum('refundedCents'),refundedTaxCents:sum('refundedTaxCents'),netPaidCents:sum('netPaidCents')},policy:'Combined purchase totals count each order once. Campaign allocations consume their own budgets. Unknown tax remains unknown. Refunds retain paid promotion use and budget.'}
}
