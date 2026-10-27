import type { Bindings } from '../../auth.server'
import { audit,changed,commit,digest } from '../access'
import { fail,type Actor } from '../model'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import { copyReviewMedia } from './media'
import { reviewOwner,reviewPlan,type ReviewInput } from './plan'
export type ReviewJob={id:string;source:string;count:number;state:string;createdAt:string}
const jobColumns='id,source,count,state,created_at AS createdAt'
export async function reviewImports(env:Bindings,actor:Actor,offset=0) {
 reviewOwner(actor);await commit(env.DB,actor,[])
 if(!Number.isSafeInteger(offset)||offset<0)fail('INPUT','Choose a nonnegative review history offset.',400)
 const [page,count]=await env.DB.batch<ReviewJob&{total:number}>([
  env.DB.prepare(`SELECT ${jobColumns} FROM st_review_imports ORDER BY rowid DESC LIMIT 100 OFFSET ?`).bind(offset),
  env.DB.prepare('SELECT COUNT(*) AS total FROM st_review_imports'),
 ])
 const jobs:ReviewJob[]=page.results,total=count.results[0].total
 return {jobs,total,nextOffset:offset+jobs.length<total?offset+jobs.length:null}
}
const inputHash=(input:ReviewInput)=>digest(canonicalJson({source:input.source,csv:input.csv,mappings:input.mappings??{},excludedRows:input.excludedRows??[]}))
export async function applyReviews(env:Bindings,actor:Actor,input:ReviewInput) {
 reviewOwner(actor)
 if(typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))fail('REVIEW_CHANGED','Approve the exact dry run before importing.')
 const hash=await inputHash(input)
 const prior=await env.DB.prepare(`SELECT ${jobColumns},input_hash FROM st_review_imports WHERE fingerprint=?`).bind(input.fingerprint).first<ReviewJob&{input_hash:string}>()
 if(prior) {
  await commit(env.DB,actor,[])
  if(prior.input_hash!==hash||prior.state!=='completed')fail('REVIEW_CHANGED','This approval has changed or was undone. Run a fresh dry run.')
  const {input_hash,...job}=prior;return job
 }
 const plan=await reviewPlan(env,actor,input)
 if(plan.fingerprint!==input.fingerprint)fail('REVIEW_CHANGED','Source or catalog changed. Run a fresh dry run before importing.')
 const excluded=input.excludedRows??[],orphans=plan.rows.filter(row=>row.status==='orphan').map(row=>row.row)
 if(!Array.isArray(excluded)||canonicalJson([...excluded].sort((a,b)=>a-b))!==canonicalJson(orphans.sort((a,b)=>a-b)))fail('REVIEW_ORPHANS','Explicitly exclude exactly the orphan rows, or re-map them before applying.')
 const ready=plan.rows.filter(row=>row.status==='ready')
 if(ready.reduce((count,row)=>count+row.review.media.length,0)>20)fail('REVIEW_MEDIA','Import at most 20 media files per reviewed batch.',400)
 const files=[]
 for(const row of ready) {
  const media=[]
  for(const url of row.review.media)media.push(await copyReviewMedia(url))
  files.push({row,id:crypto.randomUUID(),media})
 }
 const job:ReviewJob={id:crypto.randomUUID(),source:input.source,count:ready.length,state:'completed',createdAt:new Date().toISOString()}
 const statements=[
  env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM st_review_state WHERE id=1').bind(plan.revision),
  env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM st_products)=? THEN 1 ELSE 0 END').bind(plan.catalogue.length),
  ...plan.catalogue.map(row=>env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_products WHERE id=? AND revision=? AND json(value_json)=json(?)) THEN 1 ELSE 0 END').bind(row.id,row.revision,JSON.stringify(row.value))),
  env.DB.prepare('INSERT INTO st_review_imports VALUES(?,?,?,?,?,?,?)').bind(job.id,input.fingerprint,input.source,job.count,job.state,job.createdAt,hash),
 ]
 for(const {row,id,media} of files) {
  const {rating,title,body,reviewerName,date,reply,sourceVerified,reviewerEmail}=row.review
  const value={rating,title,body,reviewerName,date,reply,sourceVerified,verifiedPurchase:false,media:media.map(file=>({id:file.id,kind:file.kind,url:`/api/stall/review-media/${file.id}`}))}
  statements.push(env.DB.prepare('INSERT INTO st_reviews VALUES(?,?,?,?,?,?,?,?)').bind(id,row.productId,input.source,row.sourceId,reviewerEmail.toLowerCase(),row.emailHash,JSON.stringify(value),job.id))
  for(const file of media)statements.push(env.DB.prepare('INSERT INTO st_review_media VALUES(?,?,?,?,?)').bind(file.id,id,file.kind,file.mime,file.data))
  if(input.mappings?.[String(row.row)])for(const reference of row.references)statements.push(env.DB.prepare('INSERT INTO st_review_product_map VALUES(?,?,?) ON CONFLICT(source,source_ref) DO UPDATE SET product_id=excluded.product_id').bind(input.source,reference,row.productId))
 }
 statements.push(audit(env.DB,actor,job.id,'reviews.imported'))
 await commit(env.DB,actor,statements)
 return job
}
export async function undoReviews(env:Bindings,actor:Actor,id:string) {
 reviewOwner(actor)
 const job=await env.DB.prepare(`SELECT ${jobColumns} FROM st_review_imports WHERE id=?`).bind(id).first<ReviewJob>()
 if(!job)fail('NOT_FOUND','Review import was not found.',404)
 if(job.state==='undone'){await commit(env.DB,actor,[]);return job}
 await commit(env.DB,actor,[
  env.DB.prepare("UPDATE st_review_imports SET state='undone' WHERE id=? AND state='completed'").bind(id),changed(env.DB),
  env.DB.prepare('DELETE FROM st_review_media WHERE review_id IN (SELECT id FROM st_reviews WHERE import_id=?)').bind(id),
  env.DB.prepare('DELETE FROM st_reviews WHERE import_id=?').bind(id),audit(env.DB,actor,id,'reviews.import-undone'),
 ])
 return {...job,state:'undone'}
}
