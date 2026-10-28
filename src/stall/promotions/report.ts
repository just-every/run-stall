import type { Bindings } from '../../auth.server'
import { live } from '../access'
import { fail, integer, text, type Actor } from '../model'
import { manager } from './management'

/** Commercial facts only: no code, customer identity, staff notes or provider credentials. */
export async function promotionReport(env: Bindings, actor: Actor, params: URLSearchParams) {
  manager(actor); await live(env, actor)
  if(!params.has('promotionId'))return campaignReport(env,actor)
  const id = text(params.get('promotionId'), 'Promotion ID', 100)
  const after = params.get('after') ?? '', limit = params.has('limit') ? integer(Number(params.get('limit')), 'Report page size', 1, 100) : 50
  if (after && !/^[a-f\d-]{36}$/i.test(after)) fail('INPUT', 'Use the next report cursor returned by Stall.', 400)
  if (!await env.DB.prepare('SELECT id FROM st_promotions WHERE id=?').bind(id).first()) fail('NOT_FOUND', 'Promotion not found.', 404)
  const facts = `WITH facts AS (
    SELECT a.order_id AS orderId,a.promotion_revision AS promotionRevision,a.status,a.discount_cents AS discountCents,a.reserved_at AS reservedAt,a.used_at AS usedAt,a.code_id AS codeId,
      json_extract(o.value_json,'$.totalCents') AS orderTotalCents,
      COALESCE(json_extract(o.value_json,'$.shippingCents'),0) AS shippingCents,
      CASE WHEN json_extract(o.value_json,'$.tax') IS NOT NULL THEN 'provider_tax' ELSE COALESCE(json_extract(o.value_json,'$.taxTreatment'),'no_tax_recorded') END AS taxTreatment,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='succeeded'),0) AS refundedCents,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='pending'),0) AS pendingRefundCents,
      q.id AS qualificationEventId,d.id AS redemptionEventId
    FROM st_promotion_allocations a JOIN st_orders o ON o.id=a.order_id
    LEFT JOIN st_headless_events q ON q.id='promotion.qualified.'||a.order_id||CASE WHEN a.promotion_id=json_extract(o.value_json,'$.promotion.id') THEN '' ELSE '.'||a.promotion_id END
    LEFT JOIN st_headless_events d ON d.id='promotion.redeemed.'||a.order_id||CASE WHEN a.promotion_id=json_extract(o.value_json,'$.promotion.id') THEN '' ELSE '.'||a.promotion_id END
    WHERE a.promotion_id=?
  ) `
  // Both reads share one database transaction, including the full totals for every page.
  const [summary, page] = await env.DB.batch([
    env.DB.prepare(facts + `SELECT COUNT(*) AS checkouts,
      COUNT(CASE WHEN status='reserved' THEN 1 END) AS reservedUses,COUNT(CASE WHEN status='used' THEN 1 END) AS paidUses,
      COALESCE(SUM(discountCents),0) AS committedDiscountCents,
      COALESCE(SUM(CASE WHEN status='used' THEN orderTotalCents ELSE 0 END),0) AS grossPaidCents,
      COALESCE(SUM(CASE WHEN status='used' THEN refundedCents ELSE 0 END),0) AS refundedCents,
      COALESCE(SUM(CASE WHEN status='used' THEN pendingRefundCents ELSE 0 END),0) AS pendingRefundCents
      FROM facts`).bind(id),
    env.DB.prepare(facts + 'SELECT * FROM facts WHERE orderId>? ORDER BY orderId LIMIT ?').bind(id, after, limit + 1),
  ])
  const rows = page.results.slice(0, limit) as { orderId: string }[], totals = summary.results[0] as Record<string, number>
  return { promotionId: id, currency: 'USD', totals: { ...totals, netPaidCents: totals.grossPaidCents - totals.refundedCents }, orders: rows,
    nextAfter: page.results.length > limit ? rows.at(-1)!.orderId : null,
    campaign: await campaignReport(env,actor,id),
    taxNotice: rows.some((r:any)=>r.taxTreatment==='provider_tax')?'Provider tax is recorded on the contributing orders; tax reversals are shown separately.': 'No tax was calculated for these orders. Tax amounts are unavailable; this report does not verify a zero tax obligation.',
    budgetPolicy: 'Paid checkouts permanently consume promotion budget; a reserved checkout releases it only once Stripe reports it expired or never created. Refunds do not restore it. Net paid subtracts succeeded refunds only; pending refunds are shown separately.' }
}

/** Count each contributing order once even when several campaigns combine. */
async function campaignReport(env:Bindings,actor:Actor,promotionId?:string) {
 manager(actor);await live(env,actor)
 const [allocationRows,orderRows,events,codes]=await Promise.all([
  env.DB.prepare('SELECT order_id AS orderId,promotion_id AS promotionId,promotion_revision AS revision,discount_cents AS discountCents,status,code_id AS codeId FROM st_promotion_allocations WHERE (? IS NULL OR promotion_id=?) ORDER BY order_id,promotion_id').bind(promotionId??null,promotionId??null).all<any>(),
  env.DB.prepare("SELECT o.value_json,r.value_json AS risk_json FROM st_orders o LEFT JOIN st_risk r ON r.order_id=o.id WHERE EXISTS(SELECT 1 FROM st_promotion_allocations a WHERE a.order_id=o.id AND (? IS NULL OR a.promotion_id=?)) ORDER BY o.id").bind(promotionId??null,promotionId??null).all<{value_json:string;risk_json:string|null}>(),
  env.DB.prepare("SELECT id,resource_id AS promotionId FROM st_headless_events WHERE kind='promotion' AND (? IS NULL OR resource_id=?) ORDER BY id").bind(promotionId??null,promotionId??null).all(),
  env.DB.prepare('SELECT c.id,c.promotion_id AS promotionId,a.order_id AS orderId,a.status FROM st_promotion_codes c LEFT JOIN st_promotion_allocations a ON a.code_id=c.id WHERE (? IS NULL OR c.promotion_id=?) ORDER BY c.id').bind(promotionId??null,promotionId??null).all(),
 ])
 const orders=orderRows.results.map(row=>{const o=JSON.parse(row.value_json),refunds=o.refunds.filter((r:any)=>r.status==='succeeded');return {orderId:o.id,paid:!!o.payment,canceled:row.risk_json?JSON.parse(row.risk_json).status==='canceled':false,merchandiseCents:o.lines.reduce((n:number,l:any)=>n+l.unitCents*l.quantity-(l.discountCents??0),0),shippingCents:o.shippingCents??0,taxCents:o.tax?.taxCents??null,totalCents:o.totalCents,refundedCents:refunds.reduce((n:number,r:any)=>n+r.amountCents,0),refundTaxCents:o.tax?refunds.reduce((n:number,r:any)=>n+(r.taxAllocation?.taxCents??0),0):null,lineAllocations:o.lines.map((l:any)=>({sku:l.sku,quantity:l.quantity,grossCents:l.quantity*l.unitCents,discountCents:l.discountCents??0})),ruleSnapshot:o.promotion}})
 const paid=orders.filter(o=>o.paid),sum=(key:'merchandiseCents'|'shippingCents'|'totalCents'|'refundedCents')=>paid.reduce((n,o)=>n+o[key],0)
 return {currency:'USD',allocations:allocationRows.results,codes:codes.results,events:events.results,orders,totals:{uniqueOrders:orders.length,paidOrders:paid.length,canceledOrders:orders.filter(o=>o.canceled).length,consumedDiscountCents:allocationRows.results.reduce((n,a)=>n+a.discountCents,0),merchandiseCents:sum('merchandiseCents'),shippingCents:sum('shippingCents'),grossPaidCents:sum('totalCents'),refundedCents:sum('refundedCents'),netPaidCents:sum('totalCents')-sum('refundedCents'),taxCents:paid.length&&paid.every(o=>o.taxCents!==null)?paid.reduce((n,o)=>n+o.taxCents!,0):null,refundTaxCents:paid.length&&paid.every(o=>o.refundTaxCents!==null)?paid.reduce((n,o)=>n+o.refundTaxCents!,0):null},boundary:'Combined orders are counted once; each campaign retains its own consumed budget. Cancellation stops fulfillment only and does not move money or release stock. Refunds return paid line cents and original line tax; neither refunds nor cancellation replenishes promotion budgets.'}
}
