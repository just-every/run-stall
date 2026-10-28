import type { Bindings } from '../../auth.server'
import { audit,commit,digest,live } from '../access'
import { fail,integer,text,type Actor } from '../model'
import { manager } from './management'
import { storedRule } from './rules'
import type { Promotion } from './model'
export async function promotionCodes(env:Bindings,actor:Actor,params:URLSearchParams) {
 manager(actor);await live(env,actor)
 const id=text(params.get('promotionId'),'Promotion ID',100)
 return {codes:(await env.DB.prepare(`SELECT c.label,c.created_at AS createdAt,COUNT(a.order_id) AS uses,COALESCE(SUM(a.discount_cents),0) AS discountCents,MAX(a.status) AS status FROM st_promotion_codes c LEFT JOIN st_promotion_allocations a ON a.code_hash=c.code_hash WHERE c.promotion_id=? GROUP BY c.code_hash ORDER BY c.created_at,c.label`).bind(id).all()).results,notice:'Codes are shown only when generated. Keep the downloaded CSV securely. Each code permits one reserved or paid checkout; refunds do not make it reusable.'}
}
export async function generateCodes(env:Bindings,actor:Actor,p:any) {
 manager(actor)
 const id=text(p.id,'Promotion ID',100),revision=text(p.revision,'Promotion revision',100),count=integer(p.count,'Code count',1,100)
 const promotion=await env.DB.prepare('SELECT * FROM st_promotions WHERE id=? AND revision=? AND revoked_at IS NULL').bind(id,revision).first<Promotion>()
 if(!promotion)fail('CHANGED','Review the current promotion before generating codes.')
 if(storedRule(promotion).method!=='code')fail('INPUT','Only code promotions can generate single-use codes.',400)
 const stamp=new Date().toISOString(),batch=crypto.randomUUID(),codes=await Promise.all(Array.from({length:count},async(_,i)=>{
  const code='STALL-'+[...crypto.getRandomValues(new Uint8Array(12))].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()
  return {label:batch+'-'+(i+1),code,hash:await digest(code)}
 }))
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_guard(value) SELECT COUNT(*) FROM st_promotions WHERE id=? AND revision=? AND revoked_at IS NULL').bind(id,revision),...codes.map(c=>env.DB.prepare('INSERT INTO st_promotion_codes VALUES(?,?,?,?)').bind(c.hash,id,c.label,stamp)),audit(env.DB,actor,id,'promotion.codes-generated')])
 return {codes:codes.map(({label,code})=>({label,code})),csv:'label,code\r\n'+codes.map(c=>c.label+','+c.code).join('\r\n')+'\r\n',notice:'Save this CSV now. Codes cannot be read back.'}
}
