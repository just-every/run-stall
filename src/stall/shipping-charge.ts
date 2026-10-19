import type { Bindings } from '../auth.server'
import { audit,commit } from './access'
import { fail,integer,requirePerson,type Actor } from './model'

/** One flat US shipping charge; each checkout keeps its own immutable amount. */
export async function shippingCharge(db:D1Database):Promise<number> {
 const row=await db.prepare('SELECT shipping_cents FROM st_shipping WHERE id=1').first<{shipping_cents:number}>()
 // An unconfigured installation charges zero and keeps the archive destination empty.
 return row?integer(row.shipping_cents,'Shipping cents',0,99999999):0
}
export async function configureShipping(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner') fail('FORBIDDEN','Only the owner may configure shipping.',403)
 const shippingCents=integer(p.shippingCents,'Shipping cents',0,99999999)
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_shipping(id,shipping_cents,updated_by,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET shipping_cents=excluded.shipping_cents,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(shippingCents,actor.id,new Date().toISOString()),audit(env.DB,actor,'shipping','shipping.configured')])
 return {shippingCents}
}
