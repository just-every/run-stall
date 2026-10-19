import type { Bindings } from '../auth.server'
import { digest } from './access'
import { fail, Problem } from './model'

type Command =
 | { commandId:string; type:'order.create'; payload:{customerId:string;channel:'stall';currency:string;lines:{itemId:string;quantity:string;price:string}[]} }
 | { commandId:string; type:'order.channelPayment'; payload:{orderId:string;payment:{provider:'stripe';reference:string;amount:string;currency:string;paidAt:string;orderReference:string}} }
 | { commandId:string; type:'dispatch.create'; payload:{orderId:string;shipmentReference:string;lines:{orderLineId:string;quantity:string}[]} }
export type PierWork = {
 id:string; orderId:string; kind:Command['type']; intentHash:string;
 pierOrigin:string; pierCustomerId:string; providerCorrelation:string;
 status:'prepared'|'uncertain'|'response_observed'; attempts:number; attemptedAt:string;
 observedAt:string|null; providerId:string|null; errorCode:string|null;
}
const columns = 'id,order_id AS orderId,kind,intent_hash AS intentHash,pier_origin AS pierOrigin,pier_customer_id AS pierCustomerId,provider_correlation AS providerCorrelation,status,attempts,attempted_at AS attemptedAt,observed_at AS observedAt,provider_id AS providerId,error_code AS errorCode'
// Same JSON equivalence as Pier's command digest. Persist the fingerprint only.
function canonical(value:unknown):string {
 if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']'
 if (value!==null&&typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
 return JSON.stringify(value)
}
export async function pierWork(db:D1Database,limit?:number) {
 const query=`SELECT ${columns} FROM st_pier_work ORDER BY attempted_at DESC,id${limit===undefined?'':' LIMIT ?'}`
 return (await (limit===undefined?db.prepare(query):db.prepare(query).bind(limit)).all<PierWork>()).results
}
// Explicit fields for both operations and commercial CSV/JSON exports.
export const pierWorkFields=['id','orderId','kind','pierOrigin','pierCustomerId','providerCorrelation','status','attempts','attemptedAt','observedAt','providerId','errorCode'] as const
export function pierWorkRecord(work:PierWork) {
 return Object.fromEntries(pierWorkFields.map(field=>[field,work[field]])) as Pick<PierWork,typeof pierWorkFields[number]>
}
/** Pier atomically stores command ID + canonical payload + actor ID with its
 * effect/receipt. A same-owner key rotation retains actor ID; a different owner
 * is rejected by Pier. A general state read is not a command receipt.
 * The caller must retain the original deterministic command, assert the saved
 * Pier/customer configuration, and read current state before any replay. */
export async function pierWrite(env:Bindings,intent:{orderId:string;pierOrigin:string;pierCustomerId:string;providerCorrelation:string},command:Command,send:(command:Command)=>Promise<any>,observeBeforeReplay:()=>Promise<unknown>) {
 const hash=await digest(canonical({type:command.type,payload:command.payload})),at=new Date().toISOString()
 await env.DB.prepare("INSERT OR IGNORE INTO st_pier_work(id,order_id,kind,intent_hash,pier_origin,pier_customer_id,provider_correlation,status,attempts,attempted_at) VALUES(?,?,?,?,?,?,?,'prepared',0,?)")
  .bind(command.commandId,intent.orderId,command.type,hash,intent.pierOrigin,intent.pierCustomerId,intent.providerCorrelation,at).run()
 const work=await env.DB.prepare(`SELECT ${columns} FROM st_pier_work WHERE id=?`).bind(command.commandId).first<PierWork>()
 if(!work||work.intentHash!==hash||work.orderId!==intent.orderId||work.kind!==command.type||work.pierOrigin!==intent.pierOrigin||work.pierCustomerId!==intent.pierCustomerId||work.providerCorrelation!==intent.providerCorrelation)
  fail('IDEMPOTENCY','This Pier command belongs to a different commercial intent.')
 try {
  if(work.attempts>0) await observeBeforeReplay()
  // No network command runs until its attempt has committed. Response history
  // is monotonic even if a later attempt fails or concurrent replies overlap.
  await env.DB.prepare("UPDATE st_pier_work SET status=CASE WHEN status='prepared' THEN 'uncertain' ELSE status END,attempts=attempts+1,attempted_at=?,error_code=NULL WHERE id=?")
   .bind(new Date().toISOString(),command.commandId).run()
  const result=await send(command)
  if(typeof result?.id!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(result.id)||(work.providerId!==null&&work.providerId!==result.id))
   fail('PIER_RESPONSE','Pier did not return the original command result. Reconcile the same operation.',502)
  await env.DB.prepare("UPDATE st_pier_work SET status='response_observed',provider_id=?,observed_at=?,error_code=NULL WHERE id=? AND (provider_id IS NULL OR provider_id=?)")
   .bind(result.id,new Date().toISOString(),command.commandId,result.id).run()
  return result
 } catch(error) {
  // Provider-supplied error codes and text are untrusted, even when uppercase.
  const code=error instanceof Problem&&['PIER_CREDENTIAL','PIER_RESPONSE','PIER_CHANGED','PIER_UNAVAILABLE','PIER_IDEMPOTENCY'].includes(error.code)?error.code:'PIER_COMMAND_UNCERTAIN'
  await env.DB.prepare('UPDATE st_pier_work SET error_code=? WHERE id=?').bind(code,command.commandId).run()
  throw error
 }
}

/** Only after the caller validates the original order, shipment reference and
 * complete quantities against an actual Pier response. This records evidence,
 * never a fabricated command receipt or a new business effect. */
export async function observePierWork(db:D1Database,id:string,providerId:string) {
 if(!/^[-A-Za-z0-9_]{1,160}$/.test(providerId)) fail('PIER_RESPONSE','Pier returned an invalid operation reference.',502)
 await db.prepare("UPDATE st_pier_work SET status='response_observed',provider_id=?,observed_at=?,error_code=NULL WHERE id=? AND (provider_id IS NULL OR provider_id=?)")
  .bind(providerId,new Date().toISOString(),id,providerId).run()
}
