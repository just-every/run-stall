import type { Bindings } from '../auth.server'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { portabilityPolicy } from './portability-policy.mjs'
import { audit, commit } from './access'
import { email, fail, requirePerson, type Actor } from './model'

// Financial and stock history survives under opaque order IDs. The customer's
// mailbox and checkout request fingerprint do not. Provider-held data is a
// separate action in the shop owner's Stripe account.
export async function eraseCustomer(env: Bindings, actor: Actor, payload: any) {
 requirePerson(actor)
 if (actor.role !== 'owner') fail('FORBIDDEN', 'Only the owner may erase a customer email.', 403)
 if (payload.confirm !== 'ERASE') fail('CONFIRM', 'Type ERASE to confirm.', 400)
 const address = email(payload.email)
 const pending = await env.DB.prepare(`SELECT id FROM st_orders WHERE json_extract(value_json,'$.customerEmail')=? AND
  (json_extract(value_json,'$.status')<>'shipped' OR
   json_extract(value_json,'$.shipment.status')='pending' OR EXISTS
   (SELECT 1 FROM json_each(st_orders.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status')='pending')) LIMIT 1`).bind(address).first()
 if (pending) fail('PENDING_EFFECT', 'Ship the order and resolve pending refund effects before erasing customer details.')
 const portability = await createPortability({ db: env.DB, policy: portabilityPolicy })
 const erasedAt = new Date().toISOString()
 await commit(env.DB, actor, [
  ...await portability.invalidateTransfersStatements(),
  ...await portability.redactionStatements(),
  env.DB.prepare(`UPDATE st_orders SET value_json=json_remove(json_set(value_json,'$.customerEmail',NULL,'$.requestDigest','','$.erasedAt',?),'$.shippingDetails'),revision=lower(hex(randomblob(16))) WHERE json_extract(value_json,'$.customerEmail')=?`).bind(erasedAt, address),
  audit(env.DB, actor, crypto.randomUUID(), 'customer.email-erased'),
 ])
 return { erased: true, erasedAt }
}
