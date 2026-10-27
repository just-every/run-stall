import type { Bindings } from '../../auth.server'
import { audit,commit,digest } from '../access'
import { fail,integer,text,type Actor } from '../model'
import { orders } from '../store'
import { instant } from '../promotions/model'
import type { HistoricalRow,HistoricalSale } from './report-model'

const schema='stall-analytics-history-v1'
export async function historicalRows(db:D1Database):Promise<HistoricalRow[]> {
 const rows=await db.prepare('SELECT id,source,source_id,value_json,imported_at FROM st_analytics_history ORDER BY imported_at,id').all<any>()
 return rows.results.map(row=>({...JSON.parse(row.value_json),id:row.id,source:row.source,sourceId:row.source_id,importedAt:row.imported_at}))
}
export async function historyState(db:D1Database) {
 const jobs=await db.prepare('SELECT id,source,digest,by_actor AS by,created_at AS createdAt,applied_at AS appliedAt FROM st_analytics_history_previews ORDER BY created_at DESC').all()
 return {format:{schema,description:'Owner-reviewed historical USD sales only. Each immutable source and sourceId pair identifies one sale. No customer contact, sessions, live payment, stock or conversion is created. For a positive refund, supply refundTaxCents, refundShippingCents and each line’s refundedCents; supply refundedQuantity when recorded, otherwise null. Missing positive-refund allocations are refused. Zero-refund rows may omit those fields. Export commercial references, never credentials. No live order or processor reference may be imported twice.',example:{schema,source:'synthetic-stall-1',rows:[{sourceId:'synthetic-stall-2',createdAt:'2026-01-15T12:00:00Z',channel:'historical',lines:[{sku:'HAT',productSku:'HAT',name:'Wool hat',quantity:2,unitCents:2500}],shippingCents:500,taxCents:0,discountCents:0,totalCents:5500,refundsCents:0,processorReference:null,accountingReference:null}]}},imports:jobs.results,rows:await historicalRows(db)}
}
function parseSale(input:any):HistoricalSale {
 if(!input||typeof input!=='object'||Array.isArray(input))fail('HISTORY_FORMAT','Each history row must be a sale object.',400)
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)fail('HISTORY_FORMAT','Each historical sale needs one to 100 lines.',400)
 const seen=new Set<string>(),hasRefund=typeof input.refundsCents==='number'&&input.refundsCents>0
 const lines=input.lines.map((line:any)=>{
  if(!line||typeof line!=='object'||Array.isArray(line))fail('HISTORY_FORMAT','Each historical line must be an item object.',400)
  const sku=text(line.sku,'Historical SKU',100)
  if(seen.has(sku))fail('HISTORY_FORMAT','Historical sale SKUs must be distinct.',400)
  seen.add(sku)
  const quantity=integer(line.quantity,'Quantity',1,100000),unitCents=integer(line.unitCents,'Unit cents',0,99999999)
  const refundedCents=hasRefund?integer(line.refundedCents,'Line refunded cents',0,quantity*unitCents):0
  const refundedQuantity=hasRefund?(line.refundedQuantity===null||line.refundedQuantity===undefined?null:integer(line.refundedQuantity,'Refunded quantity',0,quantity)):0
  return {sku,productSku:line.productSku?text(line.productSku,'Product SKU',100):sku,name:text(line.name,'Historical item name',200),quantity,unitCents,refundedCents,refundedQuantity}
 })
 const cents=(key:string)=>integer(input[key],key,0,999999999)
 const shippingCents=cents('shippingCents'),taxCents=cents('taxCents'),discountCents=cents('discountCents'),totalCents=cents('totalCents'),refundsCents=cents('refundsCents')
 const refundTaxCents=hasRefund?cents('refundTaxCents'):0,refundShippingCents=hasRefund?cents('refundShippingCents'):0
 const lineRefunds=lines.reduce((n:number,line:any)=>n+line.refundedCents,0)
 if(refundTaxCents>taxCents||refundShippingCents>shippingCents||lineRefunds+refundTaxCents+refundShippingCents!==refundsCents)fail('HISTORY_REFUND','Historical refund allocations must reconcile to the recorded refund total.',400)
 const gross=lines.reduce((n:number,line:any)=>n+line.quantity*line.unitCents,0)
 if(!Number.isSafeInteger(gross)||discountCents>gross||gross-discountCents+shippingCents+taxCents!==totalCents||refundsCents>totalCents)fail('HISTORY_TOTAL','Historical USD totals or refunds do not reconcile.',400)
 const reference=(key:string)=>input[key]===null||input[key]===undefined?null:text(input[key],key,200)
 return {sourceId:text(input.sourceId,'Immutable source ID',160),createdAt:instant(input.createdAt,'Historical timestamp'),channel:text(input.channel,'Historical channel',80),lines,shippingCents,taxCents,discountCents,totalCents,refundsCents,refundTaxCents,refundShippingCents,processorReference:reference('processorReference'),accountingReference:reference('accountingReference')}
}
async function rejectLiveDuplicates(db:D1Database,rows:HistoricalSale[]) {
 const live=await orders(db),held=new Set<string>()
 for(const order of live) {held.add(order.id);if(order.payment?.source!=='staff'&&order.payment?.intentId)held.add(order.payment.intentId);if(order.manualPayment?.reference)held.add(order.manualPayment.reference)}
 for(const row of rows)if(held.has(row.sourceId)||(row.processorReference&&held.has(row.processorReference)))fail('HISTORY_DUPLICATE','This historical source or processor reference already belongs to a live order.',409)
}
export async function previewHistory(env:Bindings,actor:Actor,input:any) {
 if(input.schema!==schema||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>1000)fail('HISTORY_FORMAT','Supply the documented historical schema and one to 1000 sales.',400)
 const source=text(input.source,'Historical source',160),rows:HistoricalSale[]=input.rows.map(parseSale),seen=new Set<string>(),processors=new Set<string>()
 for(const row of rows) {if(seen.has(row.sourceId)||(row.processorReference&&processors.has(row.processorReference)))fail('HISTORY_DUPLICATE','Each source ID and processor reference may appear only once in a preview.',400);seen.add(row.sourceId);if(row.processorReference)processors.add(row.processorReference)}
 await rejectLiveDuplicates(env.DB,rows)
 const existing=await historicalRows(env.DB)
 for(const row of rows) {
  const previous=existing.find(r=>r.source===source&&r.sourceId===row.sourceId)
  if(previous) {const {id:ignoredId,source:ignoredSource,importedAt:ignoredAt,...value}=previous;if(JSON.stringify(value)!==JSON.stringify(row))fail('HISTORY_IMMUTABLE','A previously imported source sale cannot be replaced.',409)}
  if(row.processorReference&&existing.some(r=>r.processorReference===row.processorReference&&(r.source!==source||r.sourceId!==row.sourceId)))fail('HISTORY_DUPLICATE','This processor reference is already held by another historical sale.',409)
 }
 const previewId=crypto.randomUUID(),createdAt=new Date().toISOString(),encoded=JSON.stringify(rows),hash=await digest(encoded)
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_analytics_history_previews VALUES(?,?,?,?,?,?,NULL)').bind(previewId,source,hash,encoded,actor.id,createdAt),audit(env.DB,actor,previewId,'analytics.history.previewed')])
 return {previewId,source,rows,totals:{sales:rows.length,totalCents:rows.reduce((n,r)=>n+r.totalCents,0),refundsCents:rows.reduce((n,r)=>n+r.refundsCents,0)},effects:'Historical reporting records only. No live order, payment, stock, session or conversion.'}
}
export async function applyHistory(env:Bindings,actor:Actor,input:any) {
 if(input.reviewed!==true)fail('HISTORY_REVIEW','Review the historical sales and confirm this exact preview.',400)
 const id=text(input.previewId,'Historical preview ID',160),preview=await env.DB.prepare('SELECT * FROM st_analytics_history_previews WHERE id=?').bind(id).first<any>()
 if(!preview||preview.by_actor!==actor.id)fail('HISTORY_PREVIEW','Review your own saved historical preview.',404)
 const rows:HistoricalSale[]=JSON.parse(preview.value_json)
 if(await digest(preview.value_json)!==preview.digest)fail('HISTORY_PREVIEW','Historical preview provenance failed.',409)
 await rejectLiveDuplicates(env.DB,rows)
 const at=preview.applied_at??new Date().toISOString()
 const statements:D1PreparedStatement[]=[]
 for(const row of rows) {
  statements.push(env.DB.prepare("INSERT INTO st_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_orders WHERE id=? OR (? IS NOT NULL AND (json_extract(value_json,'$.payment.intentId')=? OR json_extract(value_json,'$.manualPayment.reference')=?))) THEN 1 ELSE 0 END").bind(row.sourceId,row.processorReference,row.processorReference,row.processorReference))
  if(row.processorReference)statements.push(env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_analytics_history WHERE json_extract(value_json,\'$.processorReference\')=? AND (source<>? OR source_id<>?)) THEN 1 ELSE 0 END').bind(row.processorReference,preview.source,row.sourceId))
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO st_analytics_history VALUES(?,?,?,?,?,?,?)').bind(await digest(JSON.stringify([preview.source,row.sourceId])),preview.source,row.sourceId,JSON.stringify(row),id,at,actor.id))
 }
 statements.push(env.DB.prepare('UPDATE st_analytics_history_previews SET applied_at=COALESCE(applied_at,?) WHERE id=?').bind(at,id),audit(env.DB,actor,id,'analytics.history.applied'))
 await commit(env.DB,actor,statements)
 return {previewId:id,applied:true,rows:rows.length,replayed:!!preview.applied_at}
}
