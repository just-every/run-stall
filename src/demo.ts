// Demo data for `rer demo` and the hosted demo (modules/demo runs it once, after
// the owner exists): Saltbush & Clay, a lived-in Santa Fe ceramics shop with
// its catalogue and stock in Pier, six weeks of orders in every state (paid,
// reserved, packed and awaiting shipping approval, shipped, refunded, a stock
// shortfall, abandoned checkouts), a refund waiting for a person's approval,
// product drafts, an agent credential and the audit trail. The shop's Pier stock
// desk and Stripe account are the demo's own simulated ones
// (stall/demo/providers.ts). Fixed ids with ON CONFLICT DO NOTHING keep it
// idempotent; nothing is fetched or sent.
import type { Bindings } from './auth.server'
import { digest } from './stall/access'
import { catalogue, clock, history, type Staff } from './stall/demo/history'
import { demoPierKey, demoStripeKey } from './stall/demo/providers'
import { agentGrant, shop, team } from './stall/demo/shop'

type Row = Record<string, string | number | null>
/** INSERT many rows in one statement, with json_each. */
function rows(db: D1Database, table: string, list: Row[], chunk = 40): D1PreparedStatement[] {
 const columns = Object.keys(list[0]), out: D1PreparedStatement[] = []
 for (let i = 0; i < list.length; i += chunk)
  out.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(c => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`).bind(JSON.stringify(list.slice(i, i + chunk))))
 return out
}

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
 const db = env.DB
 const found = await db.prepare("SELECT id,display_name,version FROM oa_operators WHERE lower(email)=lower(?) AND role='owner' AND status='active'").bind(ownerEmail).first<{ id: string; display_name: string; version: number }>()
 if (!found) throw new Error('The demo shop needs its owner first')
 const { at } = clock(now), [sam] = team
 const staff: Staff = { owner: { id: found.id, version: found.version }, sam: { id: sam.id, version: 1 } }
 const { products, pier, events: productEvents } = await catalogue(now, staff)
 const { orders, events: orderEvents, stripe } = await history(now, staff, pier)
 const granted = at(agentGrant.created, 17, 5)
 const events = [...productEvents, ...orderEvents, { subject: agentGrant.id, actor: found.id, action: 'agent.granted', at: granted }].sort((a, b) => a.at.localeCompare(b.at))
 await db.batch([
  db.prepare("UPDATE oa_operators SET display_name=? WHERE id=? AND display_name='Owner'").bind(shop.owner, found.id),
  db.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING').bind(found.id, Date.parse(at(shop.since, 11))),
  ...rows(db, 'oa_operators', team.map(t => ({ id: t.id, email: t.email, display_name: t.name, role: t.role, status: 'active', version: 1, created_at: Date.parse(at(t.joined, 10)) }))),
  // Nobody holds this credential's token; it shows how the shop's agent prepares drafts.
  db.prepare('INSERT INTO st_agent_tokens VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(agentGrant.id, await digest(crypto.randomUUID()), found.id, found.version, now.getTime() + agentGrant.expiresIn * 86400000),
  ...rows(db, 'st_products', products.map(p => ({ id: p.id, value_json: JSON.stringify(p.value), revision: p.revision }))),
  ...rows(db, 'st_orders', orders.map(({ revision, ...value }) => ({ id: value.id, value_json: JSON.stringify({ ...value, revision }), revision }))),
  ...rows(db, 'st_audit', await Promise.all(events.map(async (e, i) => ({ id: await digest(`stall-demo:audit:${i}`), ...e }))), 200),
  db.prepare('INSERT INTO rer_demo(name,value) VALUES(?,?),(?,?) ON CONFLICT DO NOTHING').bind(demoPierKey, JSON.stringify(pier), demoStripeKey, JSON.stringify(stripe)),
 ])
}
