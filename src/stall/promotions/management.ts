import type { Bindings } from '../../auth.server'
import { audit,changed,commit,digest,live } from '../access'
import { fail,integer,requirePerson,text,type Actor } from '../model'
import { instant,promotionCode,type Promotion } from './model'

export function manager(actor:Actor) {
 requirePerson(actor)
 if(!['owner','admin'].includes(actor.role)||actor.staffRole) fail('FORBIDDEN','Only the owner or an administrator may manage promotions.',403)
}
export async function promotionList(env:Bindings,actor:Actor) {
 manager(actor);await live(env,actor)
 const rows=await env.DB.prepare(`SELECT p.id,p.revision,p.starts_at AS startsAt,p.ends_at AS endsAt,p.minimum_cents AS minimumBasketCents,p.max_customer_uses AS maxUsesPerCustomer,p.max_total_uses AS maxTotalUses,p.max_discount_cents AS maxShippingDiscountCents,p.revoked_at AS revokedAt,
  COUNT(CASE WHEN a.status='reserved' THEN 1 END) AS reservedUses,COUNT(CASE WHEN a.status='used' THEN 1 END) AS usedUses,
  COALESCE(SUM(CASE WHEN a.status='reserved' THEN a.discount_cents ELSE 0 END),0) AS reservedDiscountCents,COALESCE(SUM(CASE WHEN a.status='used' THEN a.discount_cents ELSE 0 END),0) AS usedDiscountCents
  FROM st_promotions p LEFT JOIN st_promotion_allocations a ON a.promotion_id=p.id GROUP BY p.id ORDER BY p.created_at,p.id`).all()
 return {promotions:rows.results,budgetPolicy:'Reserved and used checkouts both consume the limits. An unpaid checkout’s reservation is released a day later, once Stripe reports it expired or never created. Cancellation and refunds never release promotion budget automatically.'}
}
export async function savePromotion(env:Bindings,actor:Actor,p:any) {
 manager(actor)
 const previous=p.id?await env.DB.prepare('SELECT * FROM st_promotions WHERE id=?').bind(text(p.id,'Promotion ID',100)).first<Promotion>():null
 if(p.id&&!previous) fail('NOT_FOUND','Promotion not found.',404)
 if(previous?.revoked_at) fail('PROMOTION_REVOKED','A revoked promotion cannot be changed. Create a new promotion.')
 const id=previous?.id??crypto.randomUUID(),revision=crypto.randomUUID(),at=new Date().toISOString()
 const codeHash=p.code===undefined&&previous?previous.code_hash:await digest(promotionCode(p.code))
 const starts=instant(p.startsAt,'Start time'),ends=instant(p.endsAt,'End time')
 if(ends<=starts) fail('INPUT','The end time must follow the start time.',400)
 const minimum=integer(p.minimumBasketCents,'Minimum basket cents',0,99999999),perCustomer=integer(p.maxUsesPerCustomer,'Maximum uses per customer',1,1000000),total=integer(p.maxTotalUses,'Maximum total uses',1,1000000),budget=integer(p.maxShippingDiscountCents,'Maximum shipping discount budget cents',1,99999999)
 if(perCustomer>total) fail('INPUT','The customer limit cannot exceed the total limit.',400)
 const statement=previous?env.DB.prepare('UPDATE st_promotions SET revision=?,code_hash=?,starts_at=?,ends_at=?,minimum_cents=?,max_customer_uses=?,max_total_uses=?,max_discount_cents=?,updated_at=? WHERE id=? AND revision=? AND revoked_at IS NULL').bind(revision,codeHash,starts,ends,minimum,perCustomer,total,budget,at,id,text(p.revision,'Promotion revision',100)):env.DB.prepare('INSERT INTO st_promotions VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?)').bind(id,revision,codeHash,starts,ends,minimum,perCustomer,total,budget,'free_shipping',at,at)
 await commit(env.DB,actor,[statement,changed(env.DB),env.DB.prepare('INSERT INTO st_promotion_authority(promotion_id,revision,custodian_id,custodian_version) VALUES(?,?,?,?) ON CONFLICT(promotion_id) DO UPDATE SET revision=excluded.revision,custodian_id=excluded.custodian_id,custodian_version=excluded.custodian_version').bind(id,revision,actor.id,actor.version),audit(env.DB,actor,id,previous?'promotion.updated':'promotion.created')])
 return {id,revision}
}
export async function revokePromotion(env:Bindings,actor:Actor,p:any) {
 manager(actor)
 const id=text(p.id,'Promotion ID',100),revision=crypto.randomUUID(),at=new Date().toISOString()
 await commit(env.DB,actor,[env.DB.prepare('UPDATE st_promotions SET revision=?,revoked_at=?,updated_at=? WHERE id=? AND revision=? AND revoked_at IS NULL').bind(revision,at,at,id,text(p.revision,'Promotion revision',100)),changed(env.DB),env.DB.prepare('DELETE FROM st_promotion_authority WHERE promotion_id=?').bind(id),audit(env.DB,actor,id,'promotion.revoked')])
 return {id,revision,revokedAt:at}
}
