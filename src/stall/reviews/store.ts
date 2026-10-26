import { listingState } from '../listing'
import { handleOf } from '../listing-checks'
import { products } from '../store'
import { fail } from '../model'
import { decode, fileHeaders } from '../files'

import type { PublicReview } from './model'
export { aggregateReviews } from './model'
export async function productReviews(db:D1Database,productId:string):Promise<PublicReview[]> {
 return (await db.prepare('SELECT id,source,value_json,import_id FROM st_reviews WHERE product_id=? ORDER BY json_extract(value_json,\'$.date\') DESC,id').bind(productId).all<{id:string;source:string;value_json:string;import_id:string|null}>()).results.map(row=>({id:row.id,source:row.source,...JSON.parse(row.value_json),imported:!!row.import_id,verifiedPurchase:false}))
}
export async function publishedReviews(db:D1Database,handle:string) {
 const product=(await products(db)).find(row=>listingState(row.value)==='published'&&handleOf(row.value)===handle)
 return product?{product,reviews:await productReviews(db,product.id)}:null
}
export async function reviewMedia(db:D1Database,id:string) {
 const file=await db.prepare('SELECT m.mime,m.data,r.product_id FROM st_review_media m JOIN st_reviews r ON r.id=m.review_id WHERE m.id=?').bind(id).first<{mime:string;data:string;product_id:string}>()
 if(!file||!(await products(db)).some(row=>row.id===file.product_id&&listingState(row.value)==='published'))fail('NOT_FOUND','Review media is not available.',404)
 return new Response(decode(file.data),{headers:fileHeaders(file.mime,{'cache-control':'public, max-age=300'})})
}
export async function reviewBusinessRecords(db:D1Database) {
 const rows=(await db.prepare('SELECT id,product_id,source,source_id,reviewer_email,value_json,import_id FROM st_reviews ORDER BY id').all<{id:string;product_id:string;source:string;source_id:string;reviewer_email:string;value_json:string;import_id:string|null}>()).results
 return {reviews:rows.map(({value_json,...row})=>({...row,value:JSON.parse(value_json)})),imports:(await db.prepare('SELECT * FROM st_review_imports ORDER BY created_at,id').all()).results,productMap:(await db.prepare('SELECT * FROM st_review_product_map ORDER BY source,source_ref').all()).results}
}
export function reviewErasureStatements(db:D1Database,address:string,hash:string) {
 return [db.prepare('INSERT OR IGNORE INTO st_review_erasures VALUES(?)').bind(hash),db.prepare('DELETE FROM st_review_media WHERE review_id IN (SELECT id FROM st_reviews WHERE reviewer_email=?)').bind(address),db.prepare('DELETE FROM st_reviews WHERE reviewer_email=?').bind(address)]
}
