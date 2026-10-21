import type { Bindings } from '../auth.server'
import { actorLabel, fail, requirePerson, requireSupplier, text, type Actor, type Order } from './model'
import { readOrder, saveOrder } from './store'

/** Internal staff annotations share the order's revision and attributable history. */
export async function orderNoteCommand(env: Bindings, actor: Actor, type: string, payload: any): Promise<Order> {
 requirePerson(actor)
 requireSupplier(actor)
 const order = await readOrder(env.DB, text(payload.orderId, 'Order'))
 if (payload.revision !== order.revision) fail('CHANGED', 'The order changed. Review its current exact revision.')
 if (order.erasedAt) fail('ERASED', 'An erased order cannot receive notes or tags.')
 const by = actorLabel(actor), at = new Date().toISOString()
 let next: Order, action: string
 if (type === 'order.note.add') {
  const note = { id: crypto.randomUUID(), text: text(payload.text, 'Note', 2000), by, at }
  next = { ...order, notes: [...(order.notes ?? []), note] }
  action = 'order.note.added'
 } else if (type === 'order.note.redact') {
  if (actor.role !== 'owner') fail('FORBIDDEN', 'Only the owner may redact an internal note.', 403)
  const noteId = text(payload.noteId, 'Note'), reason = text(payload.reason, 'Redaction reason', 2000)
  const note = order.notes?.find(value => value.id === noteId)
  if (!note) fail('NOT_FOUND', 'Note not found.', 404)
  if (note.redaction) fail('REDACTED', 'This note has already been redacted.')
  next = { ...order, notes: order.notes!.map(value => value.id === noteId ? { ...value, text: 'Redacted by owner', redaction: { by, at, reason } } : value) }
  action = 'order.note.redacted'
 } else if (type === 'order.tag.add' || type === 'order.tag.remove') {
  const tag = text(payload.tag, 'Tag', 40), tags = order.tags ?? []
  if (type === 'order.tag.add') {
   if (tags.includes(tag)) fail('TAG_EXISTS', 'This order already has that tag.')
   if (tags.length >= 50) fail('TAG_LIMIT', 'An order may have at most 50 tags.', 400)
   next = { ...order, tags: [...tags, tag] }
   action = 'order.tag.added'
  } else {
   if (!tags.includes(tag)) fail('NOT_FOUND', 'Tag not found.', 404)
   next = { ...order, tags: tags.filter(value => value !== tag) }
   action = 'order.tag.removed'
  }
 } else return fail('COMMAND', 'Unknown internal order annotation command.', 404)
 return saveOrder(env, next, action, actor)
}
