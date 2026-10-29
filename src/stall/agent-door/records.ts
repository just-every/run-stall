import type { Bindings } from '../../auth.server'
import { ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import { authorize } from '../permissions'
import { products, readOrder } from '../store'
import { proposalBundle, merchandisingProposals } from '../proposals'
import { nativeActor, nativeCall } from './principal'
import type { Order } from '../model'

// Checkout handles, provider credentials, request fingerprints and customer
// addresses never enter an agent response. Imported prose remains untrusted.
export const orderRecord = (order: Order) => ({ id: order.id, revision: order.revision, lines: order.lines,
 totalCents: order.totalCents, currency: order.currency, status: order.status,
 shipment: order.shipment ?? null, refunds: order.refunds })
export async function productRecord(env: Bindings, ctx: ToolContext, sku: unknown) {
 return nativeCall(async () => {
  authorize(await nativeActor(env,ctx),'catalog')
  const row = (await products(env.DB)).find(product => product.id === sku)
  if (!row) throw new ToolRefusal('resource_unavailable')
  return row
 })
}
export async function nativeOrder(env: Bindings, ctx: ToolContext, id: unknown) {
 return nativeCall(async () => {
  authorize(await nativeActor(env,ctx),'orders')
  try { return await readOrder(env.DB,String(id)) } catch { throw new ToolRefusal('resource_unavailable') }
 })
}
export async function sources(env: Bindings, ctx: ToolContext, sku: unknown) {
 await productRecord(env,ctx,sku)
 return nativeCall(() => proposalBundle(env.DB,String(sku)))
}
export async function witness(env: Bindings, ctx: ToolContext) {
 return nativeCall(async () => {
  const actor = await nativeActor(env,ctx); authorize(actor,'admin')
  const [catalog, orders, proposals, audit] = await Promise.all([
   products(env.DB),env.DB.prepare('SELECT id,revision,value_json FROM st_orders ORDER BY id').all<any>(),
   merchandisingProposals(env.DB),env.DB.prepare('SELECT subject,actor,action,at FROM st_audit ORDER BY rowid').all(),
  ])
  return { products: catalog, orders: orders.results.map(row => orderRecord({...JSON.parse(row.value_json),revision:row.revision})), proposals, audit: audit.results }
 })
}
