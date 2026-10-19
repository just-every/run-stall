import type { Bindings } from '../auth.server'
import { fail, type Order, type Refund } from './model'
import { stripe, checkoutSession, retrieveRefund } from './stripe'

/** Bounded, read-only provider lookup. An absent/ambiguous result never licenses
 * a new write: a person can inspect Stripe and supply its original ID instead. */
async function original(env: Bindings, path: string, params: URLSearchParams, matches: (value: any) => boolean) {
 let found: any, cursor: string | undefined
 params.set('limit', '100')
 for (let page = 0; page < 5; page++) {
  if (cursor) params.set('starting_after', cursor)
  const result = await stripe(env, path + '?' + params.toString())
  if (result?.object !== 'list' || !Array.isArray(result.data) || typeof result.has_more !== 'boolean') fail('STRIPE_RESPONSE', 'Stripe did not return a readable operation list.', 502)
  for (const value of result.data.filter(matches)) {
   if (found && found.id !== value.id) fail('STRIPE_RECOVERY', 'Stripe has multiple matching operations. Inspect the original references before reconciling.')
   found = value
  }
  if (!result.has_more) {
   if (!found) fail('STRIPE_RECOVERY', 'The original operation was not found in Stripe. No replacement was sent. Check the original account and supply its existing provider ID, or refresh after Stripe finishes processing.')
   return found
  }
  const next = result.data.at(-1)?.id
  if (typeof next !== 'string' || !next || next === cursor) fail('STRIPE_RESPONSE', 'Stripe returned an invalid operation-list cursor.', 502)
  cursor = next
 }
 return fail('STRIPE_RECOVERY', 'The original operation lookup reached its 500-record limit. No replacement was sent. Find the existing provider ID in Stripe and reconcile it explicitly.')
}
export function originalCheckout(env: Bindings, order: Order, id?: string) {
 if (id) return checkoutSession(env, id)
 const since = Math.floor(Date.parse(order.createdAt) / 1000) - 300
 if (!Number.isSafeInteger(since)) fail('STRIPE_RECOVERY', 'The original checkout time is invalid. Supply the existing Stripe session ID.')
 return original(env, '/checkout/sessions', new URLSearchParams({ 'created[gte]': String(since) }), value => value?.metadata?.stall_order_id === order.id || value?.client_reference_id === order.id)
}
export function originalRefund(env: Bindings, order: Order, refund: Refund, id?: string) {
 if (id) return retrieveRefund(env, id)
 return original(env, '/refunds', new URLSearchParams({ payment_intent: order.payment!.intentId }), value => value?.metadata?.stall_refund_id === refund.id)
}
