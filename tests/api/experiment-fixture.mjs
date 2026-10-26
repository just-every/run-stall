// Test-only measured store data for AI-003: seeded orders and page counts stand in for history that a real store records.
export const expSku = 'synthetic-stall-911'
export const expVariant = 'synthetic-stall-912'
export const day = 86400000
let serial = 0
const hour = at => new Date(Math.floor(at / 3600000) * 3600000).toISOString().slice(0, 13)
export const ago = ms => new Date(Date.now() - ms).toISOString()

export async function experimentFixture(h, costCents = 2000) {
 const draft = await h.command('product.prepare', { sku: expSku, name: 'Studio plate', description: 'Hand-thrown plate', unitCents: 2400, active: true, details: { costCents, handle: 'studio-plate', customFields: [{ key: 'finish', label: 'Finish', type: 'text', value: 'Matte glaze' }], options: [{ name: 'Color', values: ['Clay'] }], variants: [{ sku: expVariant, options: { Color: 'Clay' }, unitCents: 2600 }] } })
 const product = await h.command('product.approve', { sku: expSku, revision: draft.revision })
 const grant = await h.api('/api/stall/agent-token', {})
 return { product, grant, agent: { as: '', headers: { authorization: `Bearer ${grant.token}` } } }
}
/** `count` paid online orders at `at`; the first `refunded` of them are refunded in full. */
export async function seedOrders(h, { count, at, unitCents, refunded = 0 }) {
 for (let i = 0; i < count; i++) {
  const id = `synthetic-stall-${2000 + ++serial}`
  const order = { id, customerEmail: null, lines: [{ productSku: expSku, sku: expVariant, name: 'Studio plate', itemId: 'item-0', quantity: 1, unitCents }], totalCents: unitCents, currency: 'usd', status: 'paid', createdAt: at, requestDigest: id, checkoutKey: id, pierOrigin: 'https://stock.example.test', pierCustomerId: 'shop', payment: { source: 'stripe', sessionId: `${id}-session`, intentId: `${id}-intent`, paidAt: at }, refunds: i < refunded ? [{ id: `${id}-refund`, lines: [{ sku: expVariant, quantity: 1 }], amountCents: unitCents, reason: 'Returned', status: 'succeeded', preparedBy: 'synthetic-stall-owner' }] : [] }
  await h.db.prepare('INSERT INTO st_orders VALUES(?,?,?)').bind(id, JSON.stringify(order), id).run()
 }
}
export const seedViews = (h, { at, views, limited = 0 }) => h.db.prepare('INSERT INTO st_product_views VALUES(?,?,?,?) ON CONFLICT(hour,sku) DO UPDATE SET views=views+excluded.views,limited=limited+excluded.limited').bind(hour(Date.parse(at)), expSku, views, limited).run()
/** Three baseline days before the test: 36 orders from 1,200 counted views. */
export async function seedBaseline(h) {
 for (const k of [4, 5, 6]) { const at = ago(k * day); await seedOrders(h, { count: 12, at, unitCents: 2600 }); await seedViews(h, { at, views: 400, limited: k === 5 ? 20 : 0 }) }
}
/** Places a running experiment's window in the past so its trial data can be seeded without a future clock. */
export const backdate = (h, id, startedMs = 3.5 * day, endsMs = -3.5 * day) => h.db.prepare("UPDATE st_experiments SET value_json=json_set(value_json,'$.startedAt',?,'$.endsAt',?) WHERE id=?").bind(ago(startedMs), ago(endsMs), id).run()
export const budget = (extra = {}) => ({ durationDays: 7, maxDiscountCents: 50000, maxMarginLossCents: 100000, maxRefundRatePercent: 10, minViews: 100, minOrders: 10, ...extra })
export const hypothesis = 'A ten percent price cut should lift conversion enough to offset the lower unit margin.'
export const priceInput = (revision, extra = {}) => ({ sku: expSku, revision, hypothesis, citations: ['metric:window', 'metric:views', 'metric:orders', 'price'], change: { field: 'price', percent: -10 }, budget: budget(), ...extra })
