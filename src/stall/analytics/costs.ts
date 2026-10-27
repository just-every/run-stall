import type { Bindings } from '../../auth.server'
import { audit,commit } from '../access'
import { fail,integer,text,type Actor } from '../model'
import { readOrder } from '../store'
import type { CostRecord } from './report-model'

export async function costState(db:D1Database):Promise<{enabled:boolean;records:CostRecord[]}> {
 const [preference,rows]=await Promise.all([db.prepare('SELECT enabled FROM st_analytics_cost_preferences WHERE id=1').first<{enabled:number}>(),db.prepare('SELECT value_json FROM st_analytics_costs ORDER BY rowid').all<{value_json:string}>()])
 return {enabled:preference?.enabled===1,records:rows.results.map(r=>JSON.parse(r.value_json))}
}
export async function recordCosts(env:Bindings,actor:Actor,input:any) {
 const at=new Date().toISOString()
 if(typeof input.enabled==='boolean') {
  await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_analytics_cost_preferences VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,by_actor=excluded.by_actor,at=excluded.at').bind(input.enabled?1:0,actor.id,at),audit(env.DB,actor,'analytics.costs',input.enabled?'analytics.costs.enabled':'analytics.costs.disabled')])
  return costState(env.DB)
 }
 if(!(await costState(env.DB)).enabled)fail('COST_CONSENT','Enable recorded cost reporting before saving an order cost snapshot.',409)
 const order=await readOrder(env.DB,text(input.orderId,'Order ID',160))
 if(!order.payment||order.revision!==input.orderRevision)fail('COST_REVISION','Review the current paid order before recording costs.',409)
 const cents=(key:string)=>input[key]===null?null:integer(input[key],key,0,999999999)
 const record:CostRecord={id:crypto.randomUUID(),orderId:order.id,orderRevision:order.revision,itemCostCents:cents('itemCostCents'),shippingCostCents:cents('shippingCostCents'),feesCents:cents('feesCents'),giftLiabilityCents:input.giftLiabilityCents===undefined?null:cents('giftLiabilityCents'),by:actor.id,at}
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_orders WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM st_analytics_cost_preferences WHERE id=1 AND enabled=1) THEN 1 ELSE 0 END').bind(order.id,order.revision),env.DB.prepare('INSERT INTO st_analytics_costs VALUES(?,?,?,?,?,?)').bind(record.id,order.id,order.revision,JSON.stringify(record),actor.id,at),audit(env.DB,actor,order.id,'analytics.costs.recorded')])
 return {record}
}

/** Business history includes recorded choices, never reusable consent authority. */
export async function analyticsBusinessRecords(db:D1Database) {
 const [costs,history,previews]=await Promise.all([costState(db),db.prepare('SELECT id,source,source_id,value_json,preview_id,imported_at,by_actor FROM st_analytics_history ORDER BY imported_at,id').all<any>(),db.prepare('SELECT id,source,digest,by_actor,created_at,applied_at FROM st_analytics_history_previews ORDER BY created_at,id').all()])
 return {costs:{consentRequired:true,records:costs.records},history:history.results.map(({value_json,...row})=>({...row,value:JSON.parse(value_json)})),previews:previews.results,exclusions:['Traffic session and visitor identifiers','Reusable cost-reporting consent','Unapplied historical preview contents']}
}
