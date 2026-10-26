import type { Bindings } from '../../auth.server'
import { digest,commit } from '../access'
import { fail,type Actor } from '../model'
import { handleOf } from '../listing-checks'
import { products } from '../store'
import { parseReviews,type ReviewSource } from './parse'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
export type ReviewInput={source:ReviewSource;csv:string;mappings?:Record<string,string>;excludedRows?:number[];fingerprint?:string}
export function reviewOwner(actor:Actor) {
 if(actor.agent||actor.staffRole||!['owner','admin'].includes(actor.role))fail('FORBIDDEN','A current human owner or administrator must review imported reviews.',403)
}
export async function reviewPlan(env:Bindings,actor:Actor,input:ReviewInput) {
 reviewOwner(actor)
 const parsed=parseReviews(input.csv,input.source)
 if(parsed.length>100)fail('REVIEW_LIMIT','Import at most 100 reviews per reviewed file.',400)
 const mappings=input.mappings??{}
 if(!mappings||typeof mappings!=='object'||Array.isArray(mappings)||Object.entries(mappings).some(([key,value])=>!parsed.some(row=>String(row.row)===key)||typeof value!=='string'))fail('REVIEW_MAPPING','Mappings must name a source row and an existing product.',400)
 const [state,stored,mapped,erased,catalogue]=await Promise.all([
  env.DB.prepare('SELECT revision FROM st_review_state WHERE id=1').first<{revision:number}>(),
  env.DB.prepare('SELECT source_id FROM st_reviews WHERE source=?').bind(input.source).all<{source_id:string}>(),
  env.DB.prepare('SELECT source_ref,product_id FROM st_review_product_map WHERE source=?').bind(input.source).all<{source_ref:string;product_id:string}>(),
  env.DB.prepare('SELECT email_hash FROM st_review_erasures').all<{email_hash:string}>(),products(env.DB),
 ])
 const existing=new Set(stored.results.map(row=>row.source_id)),seen=new Set<string>(),sourceMap=new Map(mapped.results.map(row=>[row.source_ref,row.product_id])),erasedHashes=new Set(erased.results.map(row=>row.email_hash))
 const rows=[]
 for(const review of parsed) {
  const references=[review.productId,review.productHandle,review.sku].filter(Boolean) as string[]
  const chosen=mappings[String(review.row)]
  if(chosen&&!catalogue.some(row=>row.id===chosen))fail('REVIEW_MAPPING','Choose an existing product before reviewing the mapping.',400)
  const candidates=new Set(catalogue.filter(row=>references.some(ref=>row.id===ref||row.value.sku===ref||row.value.details?.variants?.some(variant=>variant.sku===ref)||handleOf(row.value)===ref||sourceMap.get(ref)===row.id)).map(row=>row.id))
  const productId=chosen??(candidates.size===1?[...candidates][0]:null),emailHash=review.reviewerEmail?await digest(review.reviewerEmail.toLowerCase()):''
  const erased=erasedHashes.has(emailHash),duplicate=existing.has(review.sourceId)||seen.has(review.sourceId)
  seen.add(review.sourceId)
  const status=duplicate?'duplicate':!productId||erased?'orphan':'ready'
  rows.push({review,emailHash,row:review.row,sourceId:review.sourceId,productId,productReference:references.join(' · '),rating:review.rating,title:review.title,reviewerName:review.reviewerName,date:review.date,sourceVerified:review.sourceVerified,status,
   ...(status==='orphan'?{reason:erased?'This reviewer was erased. Re-import is refused.':candidates.size>1?'Multiple products match. Choose one explicitly.':'No matching product. Re-map this row or explicitly exclude it.'}:{}),references})
 }
 const counts={total:rows.length,mapped:rows.filter(row=>row.status==='ready').length,orphans:rows.filter(row=>row.status==='orphan').length,duplicates:rows.filter(row=>row.status==='duplicate').length}
 const fingerprint=await digest(canonicalJson({source:input.source,csv:input.csv,mappings,rows,revision:state!.revision,catalogue}))
 await commit(env.DB,actor,[])
 return {rows,counts,fingerprint,revision:state!.revision,catalogue}
}
export function publicPlan(plan:Awaited<ReturnType<typeof reviewPlan>>) {
 return {fingerprint:plan.fingerprint,counts:plan.counts,rows:plan.rows.map(({review,emailHash,references,...row})=>row)}
}
