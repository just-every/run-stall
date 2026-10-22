import { riskBlock } from './risk'
import type { Bindings } from '../auth.server'
import { audit,changed,commit,systemAudit } from './access'
import { fail,type Actor,type Order,type Product } from './model'
export async function products(db:D1Database):Promise<Product[]> { const rows=await db.prepare('SELECT * FROM st_products ORDER BY id').all<any>();return rows.results.map(r=>({id:r.id,value:JSON.parse(r.value_json),revision:r.revision})) }
export async function readOrder(db:D1Database,id:string):Promise<Order> { const r=await db.prepare('SELECT value_json,revision FROM st_orders WHERE id=?').bind(id).first<any>();if(!r) fail('NOT_FOUND','Order not found.',404);return {...JSON.parse(r.value_json),revision:r.revision} }
export async function orders(db:D1Database):Promise<Order[]> { const rows=await db.prepare('SELECT value_json,revision FROM st_orders ORDER BY rowid DESC').all<any>();return rows.results.map(r=>({...JSON.parse(r.value_json),revision:r.revision})) }
export type OrderWriteContext={before:D1PreparedStatement[];after?:(next:Order)=>D1PreparedStatement[]}
export async function saveOrder(env:Bindings,order:Order,action:string,actor?:Actor,source='stripe',context?:OrderWriteContext):Promise<Order> {
 const next={...order,revision:crypto.randomUUID()}
 const statements=[...(context?.before??[]),env.DB.prepare('UPDATE st_orders SET value_json=?,revision=? WHERE id=? AND revision=?'+(action==='shipment.approved'?` AND NOT ${riskBlock()}`:'')).bind(JSON.stringify(next),next.revision,next.id,order.revision),changed(env.DB),...(context?.after?.(next)??[]),actor?audit(env.DB,actor,next.id,action):systemAudit(env.DB,next.id,action,source)]
 if(actor) await commit(env.DB,actor,statements)
 else await env.DB.batch([...statements,env.DB.prepare('DELETE FROM st_guard')])
 return next
}
