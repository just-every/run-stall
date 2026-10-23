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
      COALESCE(json_extract(o.value_json,'$.taxTreatment'),'no_tax_recorded') AS taxTreatment,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='succeeded'),0) AS refundedCents,
      COALESCE((SELECT SUM(json_extract(r.value,'$.amountCents')) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='pending'),0) AS pendingRefundCents,
      q.id AS qualificationEventId,d.id AS redemptionEventId
    FROM st_promotion_allocations a JOIN st_orders o ON o.id=a.order_id
    LEFT JOIN st_headless_events q ON q.id='promotion.qualified.'||a.order_id
    LEFT JOIN st_headless_events d ON d.id='promotion.redeemed.'||a.order_id
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
    taxNotice: 'No tax was calculated for these orders. Tax amounts are unavailable; this report does not verify a zero tax obligation.',
    budgetPolicy: 'Paid checkouts permanently consume promotion budget; a reserved checkout releases it only once Stripe reports it expired or never created. Refunds do not restore it. Net paid subtracts succeeded refunds only; pending refunds are shown separately.' }
}
