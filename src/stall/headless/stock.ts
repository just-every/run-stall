import type { Bindings } from '../../auth.server'
import { catalogue } from '../pier'
import { digest } from '../access'
/** Poll only when a live subscription asks for stock. Events describe observed
 * Pier availability, never an inferred receipt, count or stock authority. */
export async function observeStock(env:Bindings) {
 if(!await env.DB.prepare(`SELECT s.id FROM st_headless_subscriptions s JOIN st_headless_apps a ON a.id=s.app_id JOIN oa_operators o ON o.id=s.issuer_id WHERE s.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>? AND o.status='active' AND o.role='owner' AND o.version=s.issuer_version AND a.issuer_version=o.version AND EXISTS(SELECT 1 FROM json_each(s.kinds_json) WHERE value='stock') LIMIT 1`).bind(Date.now()).first()) return
 const found=await catalogue(env),at=new Date().toISOString()
 for(const item of found.items) {
  const resource=await digest(item.sku),revision=crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO st_headless_stock(sku,resource_id,available,revision,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET available=excluded.available,revision=excluded.revision,observed_at=excluded.observed_at WHERE available<>excluded.available`).bind(item.sku,resource,item.available,revision,at).run()
 }
}
