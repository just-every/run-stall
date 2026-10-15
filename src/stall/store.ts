import type { Bindings } from '../auth.server'
import { audit,changed,commit,systemAudit } from './access'
import { fail,type Actor,type Order,type Product } from './model'
export async function products(db:D1Database):Promise<Product[]> { const rows=await db.prepare('SELECT * FROM st_products ORDER BY id').all<any>();return rows.results.map(r=>({id:r.id,value:JSON.parse(r.value_json),revision:r.revision})) }
export async function readOrder(db:D1Database,id:string):Promise<Order> { const r=await db.prepare('SELECT value_json,revision FROM st_orders WHERE id=?').bind(id).first<any>();if(!r) fail('NOT_FOUND','Order not found.',404);return {...JSON.parse(r.value_json),revision:r.revision} }
export async function orders(db:D1Database):Promise<Order[]> { const rows=await db.prepare('SELECT value_json,revision FROM st_orders ORDER BY rowid DESC').all<any>();return rows.results.map(r=>({...JSON.parse(r.value_json),revision:r.revision})) }
export async function saveOrder(env:Bindings,order:Order,action:string,actor?:Actor):Promise<Order> {
 const next={...order,revision:crypto.randomUUID()}
 const statements=[env.DB.prepare('UPDATE st_orders SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(next),next.revision,next.id,order.revision),changed(env.DB),actor?audit(env.DB,actor,next.id,action):systemAudit(env.DB,next.id,action)]
 if(actor) await commit(env.DB,actor,statements)
 else await env.DB.batch([...statements,env.DB.prepare('DELETE FROM st_guard')])
 return next
}
