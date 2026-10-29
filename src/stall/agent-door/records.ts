import type { Bindings } from '../../auth.server'
import { ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import { authorize } from '../permissions'
import { products, readOrder, orders } from '../store'
import { authorizeMerchandising, proposalBundle, merchandisingProposals, currentProposal, previewProposal } from '../proposals'
import { readMedia } from '../media'
import { stallState } from '../native-state'
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
 return nativeCall(async () => {
  authorizeMerchandising(await nativeActor(env,ctx))
  await productRecord(env,ctx,sku)
  return proposalBundle(env.DB,String(sku))
 })
}
export async function proposalRecord(env: Bindings, ctx: ToolContext, args: Record<string, unknown>) {
 return nativeCall(async () => {
  authorizeMerchandising(await nativeActor(env,ctx))
  return (await currentProposal(env.DB,args)).proposal
 })
}
export async function previewRecord(env: Bindings, ctx: ToolContext, args: Record<string, unknown>) {
 return nativeCall(async () => {
  authorizeMerchandising(await nativeActor(env,ctx))
  return previewProposal(env,args)
 })
}
export async function mediaRecord(env: Bindings, ctx: ToolContext, id: unknown) {
 const actor = await nativeActor(env,ctx)
 try {
  const { shown: _shown, ...record } = await readMedia(env,String(id),async () => actor)
  return record
 } catch(error) {
  if (error instanceof Error && 'code' in error && error.code === 'NOT_FOUND') throw new ToolRefusal('resource_unavailable')
  throw error
 }
}
/** Hooks only name candidates; the admitted run performs the native refresh. */
export async function refreshCandidates(env: Bindings, ctx: ToolContext) {
 return nativeCall(async () => {
  authorize(await nativeActor(env,ctx),'admin')
  return (await orders(env.DB)).filter(order=>order.payment&&order.reservation).map(order=>order.id)
 })
}
export async function refreshRecord(env: Bindings, ctx: ToolContext) {
 return nativeCall(async () => {
  const actor = await nativeActor(env,ctx,true); authorize(actor,'admin')
  const state = await stallState(env,actor)
  const orderIds = await refreshCandidates(env,ctx)
  return {
   products: state.products, orders: state.orders.map(orderRecord),
   proposals: await merchandisingProposals(env.DB), audit: state.audit,
   shipmentSync: 'shipmentSync' in state ? state.shipmentSync : {},
   refreshed: { orderIds, count: orderIds.length },
  }
 })
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
