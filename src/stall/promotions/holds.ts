import type { Bindings } from '../../auth.server'
import { Problem } from '../model'
import { readOrder,saveOrder } from '../store'
import { validateSession } from '../stripe'
import { originalCheckout } from '../stripe-recovery'

/** An unpaid checkout holds its promotion use while Stripe could still take its
 * payment. A day on, the scheduled run releases the hold once Stripe reports the
 * checkout expired, or reports none was created (no write is sent after 23 hours).
 * An open, completed, ambiguous or unanswered lookup keeps the hold. */
export async function releaseExpiredHolds(env:Bindings) {
 if(!env.STRIPE_SECRET_KEY) return
 const rows=(await env.DB.prepare(`SELECT a.order_id AS id FROM st_promotion_allocations a JOIN st_orders o ON o.id=a.order_id WHERE a.status='reserved' AND json_extract(o.value_json,'$.payment') IS NULL AND json_extract(o.value_json,'$.createdAt')<? ORDER BY random() LIMIT 20`).bind(new Date(Date.now()-25*3600000).toISOString()).all<{id:string}>()).results
 for(const row of rows) {
  try {
   const order=await readOrder(env.DB,row.id),session=await originalCheckout(env,order,order.checkout?.id,true)
   if(session) { validateSession(order,session); if(session.status!=='expired') continue }
   await saveOrder(env,{...order,checkoutExpiredAt:new Date().toISOString()},'promotion.released',undefined,'stripe',{before:[],after:()=>[env.DB.prepare("DELETE FROM st_promotion_allocations WHERE order_id=? AND status='reserved'").bind(order.id)]})
  } catch(error) { if(!(error instanceof Problem)) throw error }
 }
}
