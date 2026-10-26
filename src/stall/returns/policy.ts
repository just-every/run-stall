import type { Bindings } from '../../auth.server'
import { audit,changed,commit,live } from '../access'
import { fail,integer,requirePerson,requireSupplier,text,type Actor } from '../model'

export type Policy={windowDays:number;condition:string;feeCents:number;returnShipping:string;finalSaleSkus:string[];exchanges:boolean}
export type StoredPolicy={revision:string;value:Policy}
export const reasons={wrong_size:'Wrong size or fit',defective:'Damaged or defective',not_as_described:'Not as described',changed_mind:'Changed my mind',other:'Another reason'} as const
export async function loadPolicy(db:D1Database):Promise<StoredPolicy|null> {
 const row=await db.prepare('SELECT revision,value_json FROM st_return_policy WHERE id=1').first<{revision:string;value_json:string}>()
 return row?{revision:row.revision,value:JSON.parse(row.value_json)}:null
}
/** What a shopper may read before asking. Nothing here is a promise of acceptance. */
export const policyView=(stored:StoredPolicy|null)=>stored
 ?{configured:true as const,revision:stored.revision,...stored.value,cancellation:'An order can be canceled only until its fulfillment starts.',decisions:'Every request is decided by a person, who explains the decision. Refunds and any fee are settled separately after the goods are received.'}
 :{configured:false as const,message:'This shop has not published its return policy yet. Contact the shop to arrange a return or exchange.'}
export function requireDecider(actor:Actor) {
 requireSupplier(actor);requirePerson(actor)
 if(!['owner','admin'].includes(actor.role)) fail('FORBIDDEN','Return policy and decisions are restricted to the owner and administrators.',403)
}
function parse(p:any):Policy {
 const skus:unknown=p.finalSaleSkus??[]
 if(!Array.isArray(skus)||skus.length>200) fail('INPUT','List at most 200 final-sale SKUs.',400)
 return {windowDays:integer(p.windowDays,'Return window days',0,365),condition:text(p.condition,'Required condition',500),feeCents:integer(p.feeCents??0,'Return fee cents',0,1000000),
  returnShipping:text(p.returnShipping,'Return shipping explanation',300),finalSaleSkus:[...new Set(skus.map(sku=>text(sku,'Final-sale SKU',100)))].sort(),exchanges:p.exchanges===true}
}
export async function policyCommand(env:Bindings,actor:Actor,p:any) {
 requireDecider(actor);await live(env,actor)
 const previous=await loadPolicy(env.DB),value=parse(p),revision=crypto.randomUUID()
 if((p.revision??null)!==(previous?.revision??null)) fail('CHANGED','The return policy changed. Review the current policy.')
 await commit(env.DB,actor,[previous
  ?env.DB.prepare('UPDATE st_return_policy SET revision=?,value_json=? WHERE id=1 AND revision=?').bind(revision,JSON.stringify(value),previous.revision)
  :env.DB.prepare('INSERT OR IGNORE INTO st_return_policy(id,revision,value_json) VALUES(1,?,?)').bind(revision,JSON.stringify(value)),
  changed(env.DB),audit(env.DB,actor,'return-policy','return.policy.saved')])
 return {revision,...value}
}
