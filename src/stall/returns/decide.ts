import type { Bindings } from '../../auth.server'
import { audit,changed,commit,live } from '../access'
import { fail,text,type Actor } from '../model'
import { reserveExchange } from '../pier'
import { readOrder } from '../store'
import type { CaseLine } from './eligibility'
import { loadPolicy,policyCommand,requireDecider } from './policy'

const lead={
 cancellation:'Accepted. The shop will cancel the order and refund it through its separate reviewed steps; no money has moved yet.',
 return:'Accepted. Send the items back as the return policy describes. A refund is decided only after the goods are received and reviewed.',
 exchange:'Accepted. Your replacement is set aside. Send the original items back as the return policy describes; any price difference is settled by the shop separately.',
}
/** The owner or an administrator decides every case. No rule, score or agent accepts or refuses. */
export async function staffReturns(env:Bindings,actor:Actor) {
 requireDecider(actor);await live(env,actor)
 const [policy,cases,events]=await Promise.all([
  loadPolicy(env.DB),
  env.DB.prepare(`SELECT c.* FROM st_return_cases c JOIN st_orders o ON o.id=c.order_id WHERE json_extract(o.value_json,'$.erasedAt') IS NULL ORDER BY CASE c.state WHEN 'requested' THEN 0 ELSE 1 END,c.created_at DESC,c.id LIMIT 100`).all<any>(),
  env.DB.prepare('SELECT case_id,at,text FROM st_return_events ORDER BY at,rowid').all<{case_id:string;at:string;text:string}>(),
 ])
 return {policy:policy?{revision:policy.revision,...policy.value}:null,cases:cases.results.map(row=>({id:row.id,orderId:row.order_id,kind:row.kind,state:row.state,revision:row.revision,channel:row.channel,lines:JSON.parse(row.lines_json) as CaseLine[],note:row.note,createdAt:row.created_at,
  decidedAt:row.decided_at,decidedBy:row.decided_by,decision:row.decision_note,replacementReserved:!!row.reservation_json,policyAtRequest:JSON.parse(row.policy_json),progress:events.results.filter(e=>e.case_id===row.id).map(({at,text})=>({at,text}))}))}
}
export async function returnCommand(env:Bindings,actor:Actor,type:string,p:any) {
 if(type==='return.policy.save') return policyCommand(env,actor,p)
 if(type!=='return.decide') fail('COMMAND','Unknown return command.',404)
 requireDecider(actor);await live(env,actor)
 if(!p||typeof p!=='object'||Object.keys(p).some(key=>!['caseId','revision','decision','explanation'].includes(key))) fail('INPUT','Supply the case, its reviewed revision, a decision and an explanation.',400)
 const row=await env.DB.prepare('SELECT * FROM st_return_cases WHERE id=?').bind(text(p.caseId,'Case',100)).first<any>()
 if(!row) fail('NOT_FOUND','Request not found.',404)
 if(p.revision!==row.revision) fail('CHANGED','This request changed. Review its current state.')
 if(row.state!=='requested') fail('DECIDED','This request already has a recorded decision.')
 if(!['accept','refuse'].includes(p.decision)) fail('INPUT','Choose accept or refuse.',400)
 const explanation=text(p.explanation,'Explanation for the customer',500),order=await readOrder(env.DB,row.order_id)
 if(order.erasedAt) fail('NOT_FOUND','Request not found.',404)
 let reservation:unknown=null
 if(p.decision==='accept') {
  if(row.kind==='cancellation'&&order.shipment&&order.shipment.status!=='draft') fail('FULFILLMENT_STARTED','Fulfillment has started, so this cancellation cannot be accepted. Refuse it and explain the return path.')
  if(row.kind==='exchange') {
   const lines=(JSON.parse(row.lines_json) as CaseLine[]).map(line=>({sku:line.toSku!,quantity:line.quantity,unitCents:order.lines.find(l=>l.sku===line.sku)!.unitCents}))
   reservation=await reserveExchange(env,order,row.id,lines)
  }
 }
 const at=new Date().toISOString(),state=p.decision==='accept'?'accepted':'refused',message=`${p.decision==='accept'?lead[row.kind as keyof typeof lead]:'Refused. No goods, money or order changes follow from this request.'} Shop's explanation: ${explanation}`
 await commit(env.DB,actor,[
  env.DB.prepare("UPDATE st_return_cases SET state=?,revision=?,decided_at=?,decided_by=?,decision_note=?,reservation_json=? WHERE id=? AND revision=? AND state='requested'").bind(state,crypto.randomUUID(),at,actor.id,explanation,reservation?JSON.stringify(reservation):null,row.id,row.revision),
  changed(env.DB),
  env.DB.prepare('INSERT INTO st_return_events(id,case_id,at,text) VALUES(?,?,?,?)').bind(crypto.randomUUID(),row.id,at,message),
  audit(env.DB,actor,row.order_id,`${row.kind}.${state}`),
 ])
 return {id:row.id,state,reservation}
}
