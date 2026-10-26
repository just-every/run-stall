import type { Bindings } from '../../auth.server'
import { audit, changed, commit } from '../access'
import { email, fail, text, type Actor } from '../model'
import { addressValue } from './account'
import { directory, directoryAuthority } from './directory'

export async function merchantAddress(env: Bindings, actor: Actor, p: any, remove = false) {
  directoryAuthority(actor, true)
  if (!p || Object.keys(p).some(key => !['customerId', 'customerRevision', 'email', 'id', 'revision', 'address'].includes(key))) fail('INPUT', 'Supply the reviewed customer, mailbox and address only.', 400)
  const customerId = text(p.customerId, 'Customer ID', 100), customerRevision = text(p.customerRevision, 'Customer revision', 100), mailbox = email(p.email)
  const customer = await env.DB.prepare('SELECT revision FROM st_customers c WHERE id=? AND EXISTS(SELECT 1 FROM st_customer_emails e WHERE e.customer_id=c.id AND e.email=?)').bind(customerId, mailbox).first<{ revision: string }>()
  if (!customer) fail('NOT_FOUND', 'Mailbox does not belong to this directory customer.', 404)
  if (customer.revision !== customerRevision) fail('REVIEW_CHANGED', 'Customer changed. Refresh before managing addresses.')
  const id = p.id ? text(p.id, 'Address ID', 100) : crypto.randomUUID()
  const existing = await env.DB.prepare('SELECT revision FROM st_customer_addresses WHERE id=? AND email=?').bind(id, mailbox).first<{ revision: string }>()
  if ((p.id || remove) && (!existing || existing.revision !== p.revision)) fail('NOT_FOUND', 'Address not found or changed. Refresh this customer.', 404)
  const statements = [
    env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_customer_emails WHERE customer_id=? AND email=?) THEN 1 ELSE 0 END').bind(customerId, mailbox),
    env.DB.prepare('UPDATE st_customers SET revision=? WHERE id=? AND revision=?').bind(crypto.randomUUID(), customerId, customerRevision), changed(env.DB),
  ]
  if (remove) statements.push(env.DB.prepare('DELETE FROM st_customer_addresses WHERE id=? AND email=? AND revision=?').bind(id, mailbox, p.revision))
  else {
    const value = JSON.stringify(addressValue(p.address)), revision = crypto.randomUUID()
    statements.push(existing
      ? env.DB.prepare('UPDATE st_customer_addresses SET value_json=?,revision=? WHERE id=? AND email=? AND revision=?').bind(value, revision, id, mailbox, p.revision)
      : env.DB.prepare('INSERT INTO st_customer_addresses SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM st_customer_addresses WHERE email=?)<20').bind(id, mailbox, revision, value, new Date().toISOString(), mailbox))
  }
  await commit(env.DB, actor, [...statements, changed(env.DB), audit(env.DB, actor, customerId, remove ? 'customer.address-removed' : 'customer.address-managed')])
  return directory(env, actor)
}
