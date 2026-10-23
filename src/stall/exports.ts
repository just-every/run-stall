import { businessExtensions } from './business-extensions'
import { fail, shopCurrency, type Approval, type Order, type ProductValue } from './model'
import { orders, products } from './store'
import { productDetails } from './product-details'
import { businessTimeZone } from './preferences'
import { stripeWork,workRecord } from './integration-work'
import { pierWork,pierWorkRecord,pierWorkFields } from './pier-work'
import { collections } from './collections'
import { merchandising } from './merchandising'
import { searchReport } from './search-report'
import { shippingAssignments, shippingPlaces, shippingProfiles } from './shipping-profiles'

const kinds = ['products', 'customers', 'orders', 'lines', 'payments', 'refunds', 'shipments', 'reconciliation', 'stripe-work', 'pier-work', 'records'] as const
type Row = Record<string, unknown>
// Never spread stored/provider objects: only these commercial fields may leave.
function fields(value: any, names: string[]): Row {
 return Object.fromEntries(names.filter(key => value?.[key] !== undefined &&
  (value[key] === null || ['string', 'number', 'boolean'].includes(typeof value[key])))
  .map(key => [key, value[key]]))
}
function utc(value?: string) {
 if (value === undefined) return undefined
 const time = Date.parse(value)
 if (!Number.isFinite(time)) fail('EXPORT_DATA', 'A stored business timestamp is invalid. Repair it before exporting.', 409)
 return new Date(time).toISOString()
}
function approved(value?: Approval) {
 return value ? { ...fields(value, ['by', 'version', 'revision']), at: utc(value.at) } : undefined
}
function productValue(value: Omit<ProductValue, 'draft'>) {
 return { ...fields(value, ['sku', 'name', 'description', 'unitCents', 'active', 'publishAt', 'archived']), approval: approved(value.approval), ...(value.details ? { details: productDetails(value.details) } : {}) }
}
function commercialOrder(order: Order) {
 const shipment = order.shipment, shipping = order.shippingDetails
 return {
  id: order.id, revision: order.revision, shopper:order.shopper, customerEmail: order.customerEmail, channel: order.channel ?? 'online', taxTreatment: order.taxTreatment,
  notes: order.notes?.map(note=>({...note,at:utc(note.at)})), tags: order.tags,
  manualPayment: order.manualPayment ? {...order.manualPayment,at:utc(order.manualPayment.at)} : undefined,
  totalCents: order.totalCents, shippingCents: order.shippingCents ?? 0, shipping: order.shipping, currency: order.currency, status: order.status,
  pierOrigin: order.pierOrigin, pierCustomerId: order.pierCustomerId,
  assignments: order.assignments?.map(change=>({...fields(change,['id','assigneeId','by']),at:utc(change.at)})),
  createdAt: utc(order.createdAt), erasedAt: utc(order.erasedAt),
  shippingDetails: shipping ? { name: shipping.name, address: fields(shipping.address, ['line1', 'line2', 'city', 'state', 'postal_code', 'country']) } : undefined,
  checkout: order.checkout ? fields(order.checkout, ['id']) : undefined,
  payment: order.payment ? { ...fields(order.payment, ['source', 'sessionId', 'intentId']), ...(order.manualPayment?{method:order.manualPayment.method,receivedOn:order.manualPayment.receivedOn,reference:order.manualPayment.reference,recordedBy:order.manualPayment.by,label:'Payment recorded by staff, not confirmed by a payment provider'}:{source:'stripe'}), paidAt: utc(order.payment.paidAt) } : undefined,
  lines: order.lines.map(line => ({ ...fields(line, ['sku', 'productSku', 'name', 'description', 'itemId', 'quantity', 'unitCents', 'addOnCents']), ...(line.variant ? { variant: line.variant } : {}), ...(line.personalization ? { personalization: line.personalization.map(answer => fields(answer, ['key', 'label', 'type', 'value', 'addOnCents'])) } : {}) })),
  reservation: order.reservation ? { ...fields(order.reservation, ['id', 'reference']),
   lines: order.reservation.lines.map(line => fields(line, ['id', 'itemId', 'quantity', 'price', 'reserved', 'cancelled', 'dispatched'])) } : undefined,
  shipment: shipment ? { ...fields(shipment, ['id', 'reference', 'status', 'preparedBy', 'pierShipmentId']), approval: approved(shipment.approval),
   dispatches: shipment.dispatches?.map(dispatch => ({ ...fields(dispatch, ['id', 'reference', 'deliveryStatus']), shippedAt: utc(dispatch.shippedAt),
    tracking: dispatch.tracking.map(tracking => fields(tracking, ['carton', 'trackingCode', 'trackingUrl'])) })) } : undefined,
  refunds: order.refunds.map(refund => ({ ...fields(refund, ['id', 'kind', 'taxTreatment', 'accountingCategory', 'amountCents', 'reason', 'status', 'preparedBy', 'stripeId', 'source']),
   ...(refund.source==='staff'?{label:'Refund recorded by staff; Stall moved no money'}:{}), approval: approved(refund.approval), startedAt: utc(refund.startedAt), lines: refund.lines.map(line => fields(line, ['sku', 'quantity'])) })),
 }
}
function customers(history: Order[]): Row[] {
 const grouped = new Map<string, Order[]>()
 for (const order of history) {
  if (!order.customerEmail || order.erasedAt) continue
  const key = `${order.customerEmail}\0${order.currency}`
  const previous = grouped.get(key) ?? []
  previous.push(order); grouped.set(key, previous)
 }
 return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([, purchases]) => {
  const dates = purchases.map(order => utc(order.createdAt)!).sort()
  return { email: purchases[0].customerEmail, orderCount: purchases.length, firstOrderAt: dates[0], lastOrderAt: dates.at(-1),
   orderIds: purchases.map(order => order.id), currency: purchases[0].currency,
   paidCents: purchases.reduce((sum, order) => sum + (order.payment ? order.totalCents : 0), 0),
   refundedCents: purchases.reduce((sum, order) => sum + order.refunds.filter(refund => refund.status === 'succeeded').reduce((n, refund) => n + refund.amountCents, 0), 0) }
 })
}
function reconciliation(order: Order) {
 const succeeded = order.refunds.filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amountCents, 0)
 const pending = order.refunds.filter(refund => refund.status === 'pending').reduce((sum, refund) => sum + refund.amountCents, 0)
 const paid = order.payment ? order.totalCents : 0
 return { orderId: order.id, currency: order.currency, status: order.status, totalCents: order.totalCents,
  paidCents: paid, succeededRefundCents: succeeded, pendingRefundCents: pending, netRecordedCents: paid - succeeded,
  checkoutSessionId: order.checkout?.id, paymentIntentId: order.payment?.intentId,
  reservationId: order.reservation?.id, shipmentStatus: order.shipment?.status,
  pendingRefundIds: order.refunds.filter(refund => refund.status === 'pending').map(refund => refund.id) }
}
const columns: Record<string, string[]> = {
 products: ['id', 'revision', 'state', 'sku', 'name', 'description', 'unitCents', 'currency', 'active', 'publishAt', 'archived', 'approval', 'details'],
 customers: ['email', 'orderCount', 'firstOrderAt', 'lastOrderAt', 'orderIds', 'currency', 'paidCents', 'refundedCents'],
 orders: ['shopper','notes', 'tags', 'channel', 'manualPayment', 'taxTreatment', 'assignments', 'id', 'revision', 'customerEmail', 'status', 'createdAt', 'erasedAt', 'totalCents', 'shippingCents', 'shipping', 'currency', 'shippingDetails', 'checkout', 'payment', 'reservation', 'shipment', 'refunds'],
 lines: ['orderId', 'lineNumber', 'sku', 'productSku', 'name', 'variant', 'personalization', 'description', 'itemId', 'quantity', 'unitCents', 'addOnCents', 'lineTotalCents', 'currency'],
 payments: ['source', 'method', 'receivedOn', 'reference', 'recordedBy', 'label', 'orderId', 'sessionId', 'intentId', 'paidAt', 'amountCents', 'currency'],
 refunds: ['source', 'label', 'orderId', 'id', 'kind', 'taxTreatment', 'accountingCategory', 'amountCents', 'currency', 'reason', 'status', 'preparedBy', 'approval', 'startedAt', 'stripeId', 'lines'],
 shipments: ['orderId', 'id', 'reference', 'status', 'preparedBy', 'approval', 'pierShipmentId', 'dispatches'],
 'pier-work': [...pierWorkFields],
 'stripe-work': ['id', 'orderId', 'kind', 'status', 'attempts', 'attemptedAt', 'observedAt', 'providerId', 'errorCode'],
 reconciliation: ['orderId', 'currency', 'status', 'totalCents', 'paidCents', 'succeededRefundCents', 'pendingRefundCents', 'netRecordedCents', 'checkoutSessionId', 'paymentIntentId', 'reservationId', 'shipmentStatus', 'pendingRefundIds'],
}
function cell(value: unknown): string {
 let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
 // Spreadsheet importers can skip leading controls/whitespace before a formula.
 if (typeof value !== 'number' && (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text) || text.startsWith("'"))) text = "'" + text
 return '"' + text.replace(/"/g, '""') + '"'
}

/** Local business data only. The HTTP caller must authorize the human owner. */
export async function businessExport(db: D1Database, kind: string): Promise<Response> {
 if (!(kinds as readonly string[]).includes(kind)) fail('EXPORT_KIND', `Choose an export: ${kinds.join(', ')}.`, 400)
 const [catalogue, history, work, pier] = await Promise.all([products(db), orders(db), stripeWork(db), pierWork(db)])
 const productRecords = catalogue.map(product => ({ id: product.id, revision: product.revision,
  value: { ...productValue(product.value), ...(product.value.draft ? { draft: productValue(product.value.draft) } : {}) } }))
 const orderRecords = history.map(commercialOrder)
 const customerRecords = customers(history), reconciliationRecords = history.map(reconciliation)
 const workRecords = work.map(value => ({ ...workRecord(value), attemptedAt: utc(value.attemptedAt), observedAt: value.observedAt ? utc(value.observedAt) : null }))
 const pierRecords = pier.map(value => ({ ...pierWorkRecord(value), attemptedAt: utc(value.attemptedAt), observedAt: value.observedAt ? utc(value.observedAt) : null }))
 const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-type': kind === 'records' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
  'content-disposition': `attachment; filename="stall-${kind}.${kind === 'records' ? 'json' : 'csv'}"` }
 if (kind === 'records') return new Response(JSON.stringify({ schema: 'stall-business-export-v1', exportedAt: new Date().toISOString(),
  currency: shopCurrency, ...await businessExtensions(db), timeZone: await businessTimeZone(db), shipping: { profiles: await shippingProfiles(db), places: await shippingPlaces(db), assignments: await shippingAssignments(db) }, collections: (await collections(db)).map(entry => ({ id: entry.id, revision: entry.revision, value: entry.value })), merchandising: (await merchandising(db)).value, searchTerms: (await searchReport(db)).top, products: productRecords, customers: customerRecords, orders: orderRecords, reconciliation: reconciliationRecords, stripeWork: workRecords, pierWork: pierRecords }, null, 2), { headers })
 let rows: Row[]
 switch (kind) {
  case 'products': rows = productRecords.flatMap(product => [
   { id: product.id, revision: product.revision, state: 'current', currency: shopCurrency, ...product.value },
   ...(product.value.draft ? [{ id: product.id, revision: product.revision, state: 'draft', currency: shopCurrency, ...product.value.draft }] : []),
  ]); break
  case 'pier-work': rows = pierRecords; break
  case 'stripe-work': rows = workRecords; break
  case 'customers': rows = customerRecords; break
  case 'orders': rows = orderRecords; break
  case 'lines': rows = history.flatMap(order => order.lines.map((line, index) => ({ orderId: order.id, lineNumber: index + 1,
   ...fields(line, ['sku', 'productSku', 'name', 'description', 'itemId', 'quantity', 'unitCents', 'addOnCents']), ...(line.variant ? { variant: line.variant } : {}), ...(line.personalization ? { personalization: line.personalization.map(answer => fields(answer, ['key', 'label', 'type', 'value', 'addOnCents'])) } : {}), lineTotalCents: line.quantity * line.unitCents, currency: order.currency }))); break
  case 'payments': rows = orderRecords.flatMap(order => order.payment ? [{ orderId: order.id, ...order.payment, amountCents: order.totalCents, currency: order.currency }] : []); break
  case 'refunds': rows = orderRecords.flatMap(order => order.refunds.map(refund => ({ orderId: order.id, currency: order.currency, ...refund }))); break
  case 'shipments': rows = orderRecords.flatMap(order => order.shipment ? [{ orderId: order.id, ...order.shipment }] : []); break
  default: rows = reconciliationRecords
 }
 const names = columns[kind]
 return new Response([names.map(cell).join(','), ...rows.map(row => names.map(name => cell(row[name])).join(','))].join('\r\n') + '\r\n', { headers })
}
