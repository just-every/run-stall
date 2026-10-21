import type { Bindings } from '../auth.server'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { portabilityPolicy } from './portability-policy.mjs'
import { audit, changed, commit } from './access'
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
 // Customer-uploaded files leave with the contact; the order line keeps only that a file was erased.
 const withFiles = (await env.DB.prepare("SELECT id,value_json,revision FROM st_orders WHERE json_extract(value_json,'$.customerEmail')=? AND EXISTS(SELECT 1 FROM st_uploads WHERE order_id=st_orders.id)").bind(address).all<{ id: string; value_json: string; revision: string }>()).results
 const scrubbed = withFiles.flatMap(row => {
  const order = JSON.parse(row.value_json)
  for (const line of order.lines) for (const answer of line.personalization ?? []) if (answer.fileId) { answer.value = 'Erased with customer files'; delete answer.fileId; delete answer.fileName }
  return [env.DB.prepare('UPDATE st_orders SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(order), crypto.randomUUID(), row.id, row.revision), changed(env.DB)]
 })
 await commit(env.DB, actor, [
  ...scrubbed,
  env.DB.prepare("DELETE FROM st_uploads WHERE order_id IN (SELECT id FROM st_orders WHERE json_extract(value_json,'$.customerEmail')=?)").bind(address),
  ...await portability.invalidateTransfersStatements(),
  ...await portability.redactionStatements(),
  // Rebuild annotations from their attribution fields only: even a redaction
  // reason can contain customer details. The transaction also fences old writes.
  env.DB.prepare(`UPDATE st_orders SET value_json=json_remove(json_set(value_json,
   '$.customerEmail',NULL,'$.requestDigest','','$.erasedAt',?,
   '$.notes',json((SELECT json_group_array(json_object(
    'id',json_extract(note.value,'$.id'),'by',json_extract(note.value,'$.by'),
    'at',json_extract(note.value,'$.at'),'text','Erased with customer contact'))
    FROM json_each(st_orders.value_json,'$.notes') note))),
   '$.shippingDetails','$.tags','$.manualPayment.reference','$.shipping.postalCode','$.shipping.quote'),revision=lower(hex(randomblob(16)))
   WHERE json_extract(value_json,'$.customerEmail')=?`).bind(erasedAt, address),
  audit(env.DB, actor, crypto.randomUUID(), 'customer.email-erased'),
 ])
 return { erased: true, erasedAt }
}
