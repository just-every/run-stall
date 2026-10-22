import type { Bindings } from '../auth.server'
import { audit,changed,commit,digest,live,systemAudit } from './access'
import { fail,integer,requirePerson,requireSupplier,text,type Actor,type Order } from './model'
import { readOrder } from './store'

type Rules={enabled:boolean;holdElevated:boolean;holdHighest:boolean;holdAddressMismatch:boolean;holdPaymentMismatch:boolean;scoreThreshold:number|null}
type Signal={provider:'stripe';objectId:string;field:string;value:string|number}
type Risk={orderId:string;revision:string;paymentIntentId:string;rulesRevision:string|null;observedAt:string;signalHash:string;signals:Signal[];reasons:string[];status:'clear'|'advisory'|'held'|'released'|'canceled';reviewer?:{id:string;version:number;at:string;decision:'release'|'cancel'}}
const defaults:Rules={enabled:false,holdElevated:true,holdHighest:true,holdAddressMismatch:true,holdPaymentMismatch:true,scoreThreshold:null}
async function rules(db:D1Database):Promise<{revision:string|null;value:Rules}> {
 const row=await db.prepare('SELECT revision,value_json FROM st_risk_rules WHERE id=1').first<{revision:string;value_json:string}>()
 return row?{revision:row.revision,value:JSON.parse(row.value_json)}:{revision:null,value:{...defaults}}
}
export async function riskEnabled(db:D1Database) { return (await rules(db)).value.enabled }
/** SQL predicate for the st_orders write boundary; orderIdSql is trusted source SQL only. */
export function riskBlock(orderIdSql='st_orders.id') {
 return `(EXISTS(SELECT 1 FROM st_risk r WHERE r.order_id=${orderIdSql} AND json_extract(r.value_json,'$.status') IN ('held','canceled')) OR (EXISTS(SELECT 1 FROM st_risk_rules rr WHERE rr.id=1 AND json_extract(rr.value_json,'$.enabled')=1) AND EXISTS(SELECT 1 FROM st_orders ro WHERE ro.id=${orderIdSql} AND json_extract(ro.value_json,'$.payment.intentId') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM st_risk r JOIN st_risk_rules rr ON rr.id=1 WHERE r.order_id=${orderIdSql} AND json_extract(r.value_json,'$.rulesRevision')=rr.revision)))`
}
async function risk(db:D1Database,id:string):Promise<Risk|null> {
 const row=await db.prepare('SELECT revision,value_json FROM st_risk WHERE order_id=?').bind(id).first<{revision:string;value_json:string}>()
 return row?{...JSON.parse(row.value_json),revision:row.revision}:null
}
function restricted(actor:Actor) { requireSupplier(actor);requirePerson(actor);if(!['owner','admin'].includes(actor.role)) fail('FORBIDDEN','Risk review is restricted to the owner and administrators.',403) }
/** Private human owner/admin door; the queue never joins contact or staff notes. */
export async function riskSnapshot(env:Bindings,actor:Actor) {
 restricted(actor);await live(env,actor)
 const [configuration,rows,notifications,counts,decisions]=await Promise.all([
  rules(env.DB),
  env.DB.prepare("SELECT value_json,revision FROM st_risk ORDER BY CASE json_extract(value_json,'$.status') WHEN 'held' THEN 0 WHEN 'advisory' THEN 1 ELSE 2 END, json_extract(value_json,'$.observedAt') DESC,order_id LIMIT 100").all<{value_json:string;revision:string}>(),
  env.DB.prepare('SELECT id,order_id AS orderId,created_at AS createdAt,read_by AS readBy,read_at AS readAt FROM st_risk_notifications ORDER BY created_at DESC,id LIMIT 100').all(),
  env.DB.prepare("SELECT count(*) AS total,coalesce(sum(json_extract(value_json,'$.status')='held'),0) AS held,coalesce(sum(json_extract(value_json,'$.status')='canceled'),0) AS canceled FROM st_risk").first<{total:number;held:number;canceled:number}>(),
  env.DB.prepare('SELECT id,order_id AS orderId,risk_revision AS riskRevision,decision,reviewer_id AS reviewerId,reviewer_version AS reviewerVersion,decided_at AS decidedAt FROM st_risk_decisions ORDER BY decided_at DESC,id LIMIT 100').all(),
 ])
 return {rules:{...configuration.value,revision:configuration.revision},queue:rows.results.map(row=>({...JSON.parse(row.value_json),revision:row.revision})),notifications:notifications.results,decisions:decisions.results,counts,limit:100,truncated:(counts?.total??0)>100,advisory:true}
}
function bool(value:unknown,name:string) { if(typeof value!=='boolean') fail('INPUT',`${name} must be true or false.`,400);return value }
function matched(signals:Signal[],config:Rules):string[] {
 if(!config.enabled) return []
 const has=(field:string,value:string)=>signals.some(signal=>signal.field===field&&signal.value===value)
 const reasons:string[]=[]
 if(config.holdElevated&&has('outcome.risk_level','elevated')) reasons.push('elevated_processor_risk')
 if(config.holdHighest&&has('outcome.risk_level','highest')) reasons.push('highest_processor_risk')
 if(config.holdAddressMismatch&&signals.some(signal=>['payment_method_details.card.checks.address_line1_check','payment_method_details.card.checks.address_postal_code_check'].includes(signal.field)&&signal.value==='fail')) reasons.push('address_check_mismatch')
 if(config.holdPaymentMismatch&&has('payment_method_details.card.checks.cvc_check','fail')) reasons.push('payment_check_mismatch')
 if(config.scoreThreshold!==null&&signals.some(signal=>signal.field==='outcome.risk_score'&&typeof signal.value==='number'&&signal.value>=config.scoreThreshold!)) reasons.push('configured_score_threshold')
 return reasons
}
/** The caller supplies a canonical PaymentIntent fetched server-side from Stripe,
 * after authenticating any callback. Never pass event.data.object to this helper. */
function signalsFrom(order:Order,intent:any):Signal[] {
 if(!order.payment?.intentId||intent?.object!=='payment_intent'||intent.id!==order.payment.intentId||intent.metadata?.stall_order_id!==order.id||intent.amount!==order.totalCents||intent.currency!==order.currency||intent.status!=='succeeded') fail('RISK_PAYMENT_MISMATCH','Risk observations must match the verified order payment.',409)
 const charge=intent.latest_charge
 // Stripe returns a string until latest_charge is expanded. Absence cannot count as low risk.
 if(!charge||typeof charge!=='object'||charge.object!=='charge'||typeof charge.id!=='string'||charge.payment_intent!==intent.id) fail('RISK_UNAVAILABLE','Retrieve the payment with its latest charge before reviewing risk.',503)
 const signals:Signal[]=[]
 const add=(field:string,value:unknown,allowed:readonly string[])=>{if(typeof value==='string'&&allowed.includes(value)) signals.push({provider:'stripe',objectId:charge.id,field,value})}
 add('outcome.risk_level',charge.outcome?.risk_level,['normal','elevated','highest','not_assessed','unknown'])
 if(Number.isInteger(charge.outcome?.risk_score)&&charge.outcome.risk_score>=0&&charge.outcome.risk_score<=100) signals.push({provider:'stripe',objectId:charge.id,field:'outcome.risk_score',value:charge.outcome.risk_score})
 for(const field of ['address_line1_check','address_postal_code_check','cvc_check']) add('payment_method_details.card.checks.'+field,charge.payment_method_details?.card?.checks?.[field],['pass','fail','unavailable','unchecked'])
 return signals
}
function isFlagged(signals:Signal[]) { return !signals.some(signal=>signal.field==='outcome.risk_level'&&signal.value==='normal')||signals.some(signal=>['elevated','highest','fail'].includes(String(signal.value))) }
function observation(previous:Risk|null,orderId:string,paymentIntentId:string,signals:Signal[],signalHash:string,configuration:Rules,rulesRevision:string|null):Risk {
 const reasons=matched(signals,configuration),same=previous?.signalHash===signalHash
 const status=previous?.status==='canceled'?'canceled':previous?.status==='held'?'held':same&&previous?.status==='released'?'released':reasons.length?'held':isFlagged(signals)?'advisory':'clear'
 return {orderId,revision:crypto.randomUUID(),paymentIntentId,rulesRevision,observedAt:new Date().toISOString(),signalHash,signals,reasons,status,...(previous?.reviewer?{reviewer:previous.reviewer}:{})}
}
/** Idempotent across event IDs: repeats preserve a reviewer's release. A new
 * flagged signal set may hold again; a cancellation always blocks fulfillment. */
export async function inspectRisk(env:Bindings,order:Order,canonicalPaymentIntent:unknown) {
 const signals=signalsFrom(order,canonicalPaymentIntent),signalHash=await digest(JSON.stringify(signals))
 const [previous,configuration]=await Promise.all([risk(env.DB,order.id),rules(env.DB)])
 const next=observation(previous,order.id,order.payment!.intentId!,signals,signalHash,configuration.value,configuration.revision)
 if(previous&&previous.signalHash===signalHash&&previous.status===next.status&&previous.rulesRevision===configuration.revision&&JSON.stringify(previous.reasons)===JSON.stringify(next.reasons)) return previous
 const db=env.DB,statements:D1PreparedStatement[]=[
  // Fence a configuration change while Stripe was being read.
  db.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN (SELECT revision FROM st_risk_rules WHERE id=1) IS ? THEN 1 ELSE 0 END').bind(configuration.revision),
  previous?db.prepare('UPDATE st_risk SET revision=?,value_json=? WHERE order_id=? AND revision=?').bind(next.revision,JSON.stringify(next),order.id,previous.revision):db.prepare('INSERT OR IGNORE INTO st_risk(order_id,revision,value_json) VALUES(?,?,?)').bind(order.id,next.revision,JSON.stringify(next)),
  changed(db),systemAudit(db,order.id,'risk.observed'),
 ]
 if(next.status==='held') statements.push(db.prepare('INSERT OR IGNORE INTO st_risk_notifications(id,order_id,signal_hash,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),order.id,signalHash,next.observedAt))
 await db.batch([...statements,db.prepare('DELETE FROM st_guard')])
 return next
}
export async function assertRiskClear(env:Bindings,orderId:string) {
 const value=await risk(env.DB,orderId)
 if(value?.status==='held') fail('RISK_HELD','Fulfillment is held for an authorized risk review.')
 if(value?.status==='canceled') fail('RISK_CANCELED','An authorized reviewer canceled fulfillment. Payment and reserved stock require their own authorized actions.')
 const configuration=await rules(env.DB)
 if(configuration.value.enabled&&(!value||value.rulesRevision!==configuration.revision)) {
  const order=await readOrder(env.DB,orderId)
  if(order.payment?.intentId) fail('RISK_PENDING','Refresh the canonical provider risk observation before fulfillment.')
 }
}
export async function riskCommand(env:Bindings,actor:Actor,type:string,p:any) {
 restricted(actor);await live(env,actor)
 const db=env.DB
 if(type==='risk.configure') {
  const previous=await rules(db)
  if((p.revision??null)!==previous.revision) fail('CHANGED','Risk rules changed. Review the current rules.')
  const value:Rules={enabled:bool(p.enabled,'Enabled'),holdElevated:bool(p.holdElevated,'Hold elevated risk'),holdHighest:bool(p.holdHighest,'Hold highest risk'),holdAddressMismatch:bool(p.holdAddressMismatch,'Hold address mismatches'),holdPaymentMismatch:bool(p.holdPaymentMismatch,'Hold payment mismatches'),scoreThreshold:p.scoreThreshold===null?null:integer(p.scoreThreshold,'Risk score threshold',0,100)},revision=crypto.randomUUID()
  await commit(db,actor,[previous.revision?db.prepare('UPDATE st_risk_rules SET revision=?,value_json=? WHERE id=1 AND revision=?').bind(revision,JSON.stringify(value),previous.revision):db.prepare('INSERT OR IGNORE INTO st_risk_rules(id,revision,value_json) VALUES(1,?,?)').bind(revision,JSON.stringify(value)),changed(db),audit(db,actor,'shop','risk.configured')])
  return {...value,revision}
 }
 if(type==='risk.notification.read') {
  const id=text(p.id,'Notification')
  await commit(db,actor,[db.prepare('UPDATE st_risk_notifications SET read_by=coalesce(read_by,?),read_at=coalesce(read_at,?) WHERE id=?').bind(actor.id,new Date().toISOString(),id),changed(db),audit(db,actor,id,'risk.notification.read')])
  return {id,read:true}
 }
 if(!['risk.release','risk.cancel'].includes(type)) fail('COMMAND','Unknown risk command.',404)
 const orderId=text(p.orderId,'Order'),previous=await risk(db,orderId)
 if(!previous) fail('NOT_FOUND','No provider risk observation exists for this order.',404)
 if(p.revision!==previous.revision) fail('CHANGED','Risk signals changed. Review the current observation.')
 if(!['held','advisory'].includes(previous.status)) fail('RISK_DECISION','This observation has no pending review.')
 const order=await readOrder(db,orderId)
 if(type==='risk.cancel'&&(order.status==='shipped'||['pending','partial','shipped'].includes(order.shipment?.status??''))) fail('FULFILLMENT_STARTED','Fulfillment has already been approved or shipped. Reconcile its existing shipment before canceling.')
 const decision=type==='risk.release'?'release' as const:'cancel' as const,at=new Date().toISOString()
 const next:Risk={...previous,revision:crypto.randomUUID(),status:decision==='release'?'released':'canceled',reviewer:{id:actor.id,version:actor.version,at,decision}}
 await commit(db,actor,[
  // Fence fulfillment changes concurrent with the review.
  db.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM st_orders WHERE id=?').bind(order.revision,orderId),
  db.prepare('UPDATE st_risk SET revision=?,value_json=? WHERE order_id=? AND revision=?').bind(next.revision,JSON.stringify(next),orderId,previous.revision),changed(db),
  db.prepare('INSERT INTO st_risk_decisions(id,order_id,risk_revision,decision,reviewer_id,reviewer_version,decided_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),orderId,previous.revision,decision,actor.id,actor.version,at),
  audit(db,actor,orderId,type==='risk.release'?'risk.released':'risk.canceled'),
 ])
 return next
}
