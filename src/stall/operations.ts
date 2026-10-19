import type { Bindings } from '../auth.server'
import { stripeWork,workRecord } from './integration-work'
import { providerConfiguration,providerObservations } from './ops-providers'
export { probeProviders } from './ops-providers'

export type SchedulerResult={checked:number;confirmed:number;failed:number;lastErrorCode?:string}
export type SchedulerObservation=SchedulerResult&{attemptId:string;attemptedAt:string;completedAt?:string;status:'running'|'complete'|'failed'|'not_configured'}
export async function startPaymentCheck(env:Bindings) {
 const observation:SchedulerObservation={attemptId:crypto.randomUUID(),attemptedAt:new Date().toISOString(),status:'running',checked:0,confirmed:0,failed:0}
 await env.DB.prepare("INSERT INTO st_operations(key,value_json) VALUES('scheduler',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").bind(JSON.stringify(observation)).run()
 return observation
}
export async function completePaymentCheck(env:Bindings,observation:SchedulerObservation,result:SchedulerResult,status:SchedulerObservation['status']='complete') {
 const next={...observation,...result,status,completedAt:new Date().toISOString()}
 // An older overlapping run cannot replace a newer run's heartbeat.
 await env.DB.prepare("UPDATE st_operations SET value_json=? WHERE key='scheduler' AND json_extract(value_json,'$.attemptId')=?").bind(JSON.stringify(next),observation.attemptId).run()
}
export async function databaseReadiness(env:Bindings) {
 const checkedAt=new Date().toISOString()
 try {
  const result=await env.DB.prepare('SELECT 1 AS ready').all<{ready:number}>()
  const ok=result.results[0]?.ready===1
  const sizeBytes=Number.isSafeInteger(result.meta.size_after)&&result.meta.size_after>=0?result.meta.size_after:null
  return {ok,checkedAt,sizeBytes,message:ok?'The database answered.':'The database did not answer the readiness check.'}
 } catch { return {ok:false,checkedAt,sizeBytes:null,message:'The database is unavailable.'} }
}
const overdue="json_extract(o.value_json,'$.status')='awaiting_payment'"
const checkout="json_extract(o.value_json,'$.status')='checkout_pending'"
const reservation="json_extract(o.value_json,'$.status') IN ('paid','shortfall')"
const shipment="json_extract(o.value_json,'$.shipment.status') IN ('draft','pending','partial')"
const refund="EXISTS(SELECT 1 FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status') IN ('draft','pending','failed'))"
const needs=`(${checkout} OR ${overdue} OR ${reservation} OR ${shipment} OR ${refund})`
type OutstandingRow={id:string;revision:string;status:string;createdAt:string;checkoutSessionId:string|null;paymentIntentId:string|null;reservationId:string|null;reservationReference:string|null;shipmentId:string|null;shipmentReference:string|null;shipmentStatus:string|null;refunds:string}
const safeCode=(value:unknown)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:undefined
/** Human-only caller is enforced by the operations HTTP door; no provider calls. */
export async function operationsSnapshot(env:Bindings) {
 const database=await databaseReadiness(env),configured=providerConfiguration(env)
 const empty={observedAt:new Date().toISOString(),database,providers:{pier:{configured:configured.pier,lastObservation:null},stripe:{configured:configured.stripe,lastObservation:null}},scheduler:null,outstanding:null,imports:null,stripeWork:null,storage:null,limits:operationLimits}
 if(!database.ok) return empty
 const since=new Date(Date.now()-25*3600000).toISOString()
 const [observations,heartbeat,counts,rows,importCounts,importRows,workRows,workCounts]=await Promise.all([
  providerObservations(env),
  env.DB.prepare("SELECT value_json FROM st_operations WHERE key='scheduler'").first<{value_json:string}>(),
  env.DB.prepare(`SELECT count(*) AS total,
   coalesce(sum(CASE WHEN ${checkout} THEN 1 ELSE 0 END),0) AS checkout,
   coalesce(sum(CASE WHEN ${overdue} THEN 1 ELSE 0 END),0) AS awaitingPayment,
   coalesce(sum(CASE WHEN ${overdue} AND json_extract(o.value_json,'$.createdAt')>? THEN 1 ELSE 0 END),0) AS eligiblePayment,
   coalesce(sum(CASE WHEN ${overdue} AND json_extract(o.value_json,'$.createdAt')<=? THEN 1 ELSE 0 END),0) AS outsideAutoConfirmationAge,
   coalesce(sum(CASE WHEN ${reservation} THEN 1 ELSE 0 END),0) AS reservation,
   coalesce(sum(CASE WHEN ${shipment} THEN 1 ELSE 0 END),0) AS shipment,
   coalesce(sum(CASE WHEN ${refund} THEN 1 ELSE 0 END),0) AS refund
   FROM st_orders o WHERE ${needs}`).bind(since,since).first<Record<string,number>>(),
  env.DB.prepare(`SELECT o.id,o.revision,json_extract(o.value_json,'$.status') AS status,json_extract(o.value_json,'$.createdAt') AS createdAt,
   json_extract(o.value_json,'$.checkout.id') AS checkoutSessionId,json_extract(o.value_json,'$.payment.intentId') AS paymentIntentId,
   json_extract(o.value_json,'$.reservation.id') AS reservationId,json_extract(o.value_json,'$.reservation.reference') AS reservationReference,
   json_extract(o.value_json,'$.shipment.id') AS shipmentId,json_extract(o.value_json,'$.shipment.reference') AS shipmentReference,
   json_extract(o.value_json,'$.shipment.status') AS shipmentStatus,
   (SELECT json_group_array(json_object('id',json_extract(r.value,'$.id'),'status',json_extract(r.value,'$.status'),'stripeId',json_extract(r.value,'$.stripeId'))) FROM json_each(o.value_json,'$.refunds') r WHERE json_extract(r.value,'$.status') IN ('draft','pending','failed')) AS refunds
   FROM st_orders o WHERE ${needs} ORDER BY json_extract(o.value_json,'$.createdAt'),o.id LIMIT 100`).all<OutstandingRow>(),
  env.DB.prepare('SELECT state,count(*) AS count FROM ik_jobs GROUP BY state ORDER BY state').all<{state:string;count:number}>(),
  env.DB.prepare("SELECT id,state,checkpoint,total,CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END AS hasError FROM ik_jobs WHERE state NOT IN ('completed','undone','rolled_back') ORDER BY rowid LIMIT 100").all<{id:string;state:string;checkpoint:number;total:number;hasError:number}>(),
  stripeWork(env.DB,100),
  env.DB.prepare("SELECT count(*) AS total,coalesce(sum(CASE WHEN status='uncertain' THEN 1 ELSE 0 END),0) AS uncertain FROM st_stripe_work").first<{total:number;uncertain:number}>(),
 ])
 let scheduler:SchedulerObservation|null=null
 if(heartbeat) {
  const value=JSON.parse(heartbeat.value_json)
  if(['running','complete','failed','not_configured'].includes(value.status)) scheduler={attemptId:value.attemptId,attemptedAt:value.attemptedAt,completedAt:value.completedAt,status:value.status,checked:value.checked,confirmed:value.confirmed,failed:value.failed,lastErrorCode:safeCode(value.lastErrorCode)}
 }
 const total=counts?.total??0,importTotal=importCounts.results.reduce((n,row)=>n+row.count,0)
 const importOutstanding=importCounts.results.filter(row=>!['completed','undone','rolled_back'].includes(row.state)).reduce((n,row)=>n+row.count,0)
 return {...empty,providers:{pier:{configured:configured.pier,lastObservation:observations.pier},stripe:{configured:configured.stripe,lastObservation:observations.stripe}},scheduler,
  outstanding:{total,limit:100,offset:0,truncated:total>100,counts,orders:rows.results.map(row=>({...row,refunds:JSON.parse(String(row.refunds??'[]'))}))},
  imports:{total:importTotal,outstanding:importOutstanding,byState:importCounts.results,jobs:importRows.results,limit:100,offset:0,truncated:importOutstanding>100},
  stripeWork:{total:workCounts?.total??0,uncertain:workCounts?.uncertain??0,limit:100,truncated:(workCounts?.total??0)>100,records:workRows.map(workRecord)},
  storage:{usedBytes:database.sizeBytes,source:'D1 query metadata size_after'},
 }
}
export const operationLimits={outstandingList:100,importList:100,automaticPaymentsPerRun:20,automaticPaymentAgeHours:25,commerceBodyBytes:100000,stripeWebhookBodyBytes:1000000,importBodyBytes:1000000,importCsvBytes:262144,archiveHttpBodyBytes:25165824,archivePartBytes:16777216,importBatchSize:10,importBatchesPerRequest:1,checkoutLines:50,quantityPerLine:1000}
