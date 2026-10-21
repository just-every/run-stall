import type { Bindings } from '../auth.server'
import { audit,changed,commit } from './access'
import { actorLabel,fail,requirePerson,text,type Actor,type Order } from './model'
import { readOrder } from './store'

/** Assignment names responsibility only; it never grants commerce authority. */
export async function assignOrder(env:Bindings,actor:Actor,p:any):Promise<Order> {
 requirePerson(actor)
 const order=await readOrder(env.DB,text(p.orderId,'Order'))
 if(p.revision!==order.revision) fail('CHANGED','The order changed. Review its current exact revision.')
 const assigneeId=p.assigneeId===null?null:text(p.assigneeId,'Staff member')
 if(assigneeId!==null&&!await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active'").bind(assigneeId).first()) fail('ASSIGNEE','Choose an active staff member, or unassign this order.',400)
 if((order.assignments?.at(-1)?.assigneeId??null)===assigneeId) return order
 const next={...order,revision:crypto.randomUUID(),assignments:[...(order.assignments??[]),{id:crypto.randomUUID(),assigneeId,by:actorLabel(actor),at:new Date().toISOString()}]}
 // Recheck both the order revision and staff status in the write transaction.
 await commit(env.DB,actor,[env.DB.prepare(`UPDATE st_orders SET value_json=?,revision=? WHERE id=? AND revision=? AND (? IS NULL OR EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active'))`).bind(JSON.stringify(next),next.revision,order.id,order.revision,assigneeId,assigneeId),changed(env.DB),audit(env.DB,actor,order.id,'order.assigned')])
 return next
}
