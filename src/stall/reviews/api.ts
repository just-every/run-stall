import type { Bindings } from '../../auth.server'
import { audit,commit,current,digest } from '../access'
import { email,fail,Problem,text } from '../model'
import { rawBody } from '../stripe'
import { products } from '../store'
import { handleOf } from '../listing-checks'
import { publicPlan,reviewOwner,reviewPlan } from './plan'
import { applyReviews,reviewImports,undoReviews } from './service'
import { aggregateReviews,publishedReviews,reviewMedia } from './store'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
async function input(request:Request) {
 try {const value=JSON.parse(await rawBody(request,2*1024*1024));if(value&&typeof value==='object'&&!Array.isArray(value))return value}catch(error){if(error instanceof Problem)throw error}
 return fail('INPUT','Supply a review import object.',400)
}
export async function reviewResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(!['/api/stall/reviews','/api/stall/review-imports'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))&&!path.startsWith('/api/stall/review-media/'))return null
 try {
  if(path.startsWith('/api/stall/review-media/')&&request.method==='GET')return await reviewMedia(env.DB,decodeURIComponent(path.slice('/api/stall/review-media/'.length)))
  if(path==='/api/stall/reviews'&&request.method==='GET') {
   const found=await publishedReviews(env.DB,url.searchParams.get('handle')??'')
   if(!found)fail('NOT_FOUND','Product is not published.',404)
   return json({reviews:found.reviews,aggregate:aggregateReviews(found.reviews)})
  }
  const actor=await current(request,env);reviewOwner(actor)
  if(request.method!=='GET'&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s review import desk.',403)
  if(path==='/api/stall/review-imports'&&request.method==='GET')return json({jobs:await reviewImports(env,actor),products:(await products(env.DB)).map(row=>({id:row.id,name:row.value.name,handle:handleOf(row.value)}))})
  if(path==='/api/stall/review-imports/preview'&&request.method==='POST')return json(publicPlan(await reviewPlan(env,actor,await input(request))))
  if(path==='/api/stall/review-imports/apply'&&request.method==='POST')return json(await applyReviews(env,actor,await input(request)))
  const undo=path.match(/^\/api\/stall\/review-imports\/([^/]+)\/undo$/)
  if(undo&&request.method==='POST')return json(await undoReviews(env,actor,undo[1]))
  // Merchant-entered native reviews are explicitly unverified. Verified purchase
  // collection and moderation remain the later REVIEWS-001 flow.
  if(path==='/api/stall/reviews'&&request.method==='POST') {
   const value=await input(request),productId=text(value.productId,'Product',100),rating=value.rating,date=text(value.date,'Review date',50)
   if(!(await products(env.DB)).some(row=>row.id===productId))fail('NOT_FOUND','Choose an existing product.',404)
   if(!Number.isInteger(rating)||rating<1||rating>5||!/^\d{4}-\d{2}-\d{2}T/.test(date)||!Number.isFinite(Date.parse(date)))fail('INPUT','Use one to five stars and an ISO review timestamp.',400)
   const address=value.reviewerEmail?email(value.reviewerEmail):'',hash=address?await digest(address):''
   if(hash&&await env.DB.prepare('SELECT 1 FROM st_review_erasures WHERE email_hash=?').bind(hash).first())fail('REVIEW_ERASED','This reviewer was erased. Recording their contact again is refused.')
   const id=crypto.randomUUID(),body=text(value.body,'Review',10000),reviewerName=text(value.reviewerName,'Reviewer display name',200),title=typeof value.title==='string'?value.title.slice(0,500):''
   await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_review_erasures WHERE email_hash=?) THEN 1 ELSE 0 END').bind(hash),env.DB.prepare('INSERT INTO st_reviews VALUES(?,?,\'native\',?,?,?,?,NULL)').bind(id,productId,id,address,hash,JSON.stringify({rating,title,body,reviewerName,date:new Date(date).toISOString(),reply:'',sourceVerified:false,verifiedPurchase:false,media:[]})),audit(env.DB,actor,id,'reviews.recorded')])
   return json({id})
  }
  return json({error:{code:'NOT_FOUND',message:'Review endpoint not found.'}},404)
 }catch(error:any) {
  if(typeof error.status==='number'&&typeof error.code==='string')return json({error:{code:error.code,message:error.message}},error.status)
  return json({error:{code:'REVIEW_CONFLICT',message:'Review or catalog records changed. Run a fresh dry run; no partial import was applied.'}},409)
 }
}
