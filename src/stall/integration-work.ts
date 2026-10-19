import type { Bindings } from '../auth.server'
import { fail, type Problem } from './model'
import { digest } from './access'

export type StripeWork = {
 id: string; orderId: string; kind: 'checkout' | 'refund'; intentHash: string;
 status: 'prepared' | 'uncertain' | 'response_observed'; attempts: number; attemptedAt: string;
 observedAt: string | null; providerId: string | null; errorCode: string | null;
}
const columns = 'id,order_id AS orderId,kind,intent_hash AS intentHash,status,attempts,attempted_at AS attemptedAt,observed_at AS observedAt,provider_id AS providerId,error_code AS errorCode'
export async function stripeWork(db: D1Database, limit?: number) {
 const query = `SELECT ${columns} FROM st_stripe_work ORDER BY attempted_at DESC,id${limit === undefined ? '' : ' LIMIT ?'}`
 return (await (limit === undefined ? db.prepare(query) : db.prepare(query).bind(limit)).all<StripeWork>()).results
}

/** Claim the only write before crossing the network. An interrupted/unknown
 * attempt is observation-only thereafter, including on another Worker/restore. */
export async function stripeWrite(env: Bindings, intent: { id: string; orderId: string; kind: StripeWork['kind']; value: unknown }, send: () => Promise<any>, recover: (id?: string) => Promise<any>, allowCreate: boolean, preflight: () => void) {
 const hash = await digest(JSON.stringify(intent.value)), at = new Date().toISOString()
 if (allowCreate) await env.DB.prepare("INSERT OR IGNORE INTO st_stripe_work(id,order_id,kind,intent_hash,status,attempts,attempted_at) VALUES(?,?,?,?,?,0,?)").bind(intent.id, intent.orderId, intent.kind, hash, 'prepared', at).run()
 let work = await env.DB.prepare(`SELECT ${columns} FROM st_stripe_work WHERE id=?`).bind(intent.id).first<StripeWork>()
 // A duplicate must not claim an unknown legacy row before its original
 // creator has prepared the journal. It can only observe, never insert a block.
 if (!work) return recover()
 if (work.intentHash !== hash || work.orderId !== intent.orderId || work.kind !== intent.kind) fail('IDEMPOTENCY', 'This provider operation belongs to a different commercial intent.')
 try {
  let claimed = false
  if (work.status === 'prepared') {
   // Only a row never claimed for the network may make its first request.
   // Configuration/age refusals leave it demonstrably unsent and recoverable.
   preflight()
   const claim = await env.DB.prepare("UPDATE st_stripe_work SET status='uncertain',attempts=1,attempted_at=?,error_code=NULL WHERE id=? AND status='prepared' AND attempts=0").bind(at, intent.id).run()
   claimed = claim.meta.changes === 1
   if (!claimed) work = (await env.DB.prepare(`SELECT ${columns} FROM st_stripe_work WHERE id=?`).bind(intent.id).first<StripeWork>())!
  }
  const result = claimed ? await send() : await recover(work.providerId ?? undefined)
  if (typeof result?.id !== 'string' || !(intent.kind === 'checkout' ? /^cs_[A-Za-z0-9_]+$/ : /^re_[A-Za-z0-9_]+$/).test(result.id)) fail('STRIPE_RESPONSE', 'Stripe did not return an operation reference. Reconcile the original operation.', 502)
  await env.DB.prepare("UPDATE st_stripe_work SET status='response_observed',provider_id=?,observed_at=?,error_code=NULL WHERE id=?").bind(result.id, new Date().toISOString(), intent.id).run()
  return result
 } catch (error) {
  const code = (error as Problem)?.code
  // Never retain provider bodies, credentials, addresses or arbitrary error text.
  await env.DB.prepare('UPDATE st_stripe_work SET error_code=? WHERE id=?').bind(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'STRIPE_UNAVAILABLE', intent.id).run()
  throw error
 }
}

export async function observedStripeWork(db: D1Database, id: string, providerId: string) {
 await db.prepare("UPDATE st_stripe_work SET status='response_observed',provider_id=?,observed_at=?,error_code=NULL WHERE id=? AND (provider_id IS NULL OR provider_id=?)").bind(providerId, new Date().toISOString(), id, providerId).run()
}

/** Public commercial fields only; intent fingerprints remain internal. */
export function workRecord(work: StripeWork) {
 const { intentHash, ...record } = work
 return record
}
