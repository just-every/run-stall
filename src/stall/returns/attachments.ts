import type { Bindings } from '../../auth.server'
import { changed,current } from '../access'
import { decode,encode,fileHeaders,rawBytes,safeName,sniff } from '../files'
import { fail,text } from '../model'
import { subject } from './cases'

const limit=700_000,types=['image/png','image/jpeg','image/webp'],day=86400000
const error=(code:string,message:string,status:number)=>Response.json({error:{code,message}},{status,headers:{'cache-control':'no-store'}})
/** A photo is bound to one order and read only by its customer or an owner or administrator. */
export async function attachmentResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname==='/api/stall/returns/attachments') {
  if(request.method!=='POST')fail('METHOD','Use POST.',405)
  const who=await subject(request,env,text(url.searchParams.get('orderId'),'Order ID',100),true)
  if(!await env.DB.prepare('SELECT 1 FROM st_return_policy WHERE id=1').first())fail('RETURN_POLICY_UNSET','This shop has not published its return policy yet.')
  const bytes=await rawBytes(request,limit),mime=sniff(bytes)
  if(!mime||!types.includes(mime)||request.headers.get('content-type')!==mime)fail('FILE_TYPE','Attach a PNG, JPEG or WebP photo of at most 700 KB.',415)
  const id=crypto.randomUUID(),at=new Date().toISOString(),name=safeName(url.searchParams.get('name'))
  await who.write([
   env.DB.prepare('DELETE FROM st_return_files WHERE case_id IS NULL AND created_at<?').bind(new Date(Date.now()-day).toISOString()),
   env.DB.prepare('INSERT INTO st_return_files(id,order_id,email,name,mime,size,data,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM st_return_files WHERE order_id=?)<9 AND (SELECT count(*) FROM st_return_files WHERE order_id=? AND case_id IS NULL)<3').bind(id,who.order.id,who.order.customerEmail!.toLowerCase(),name,mime,bytes.length,encode(bytes),at,who.order.id,who.order.id),
   changed(env.DB),
  ])
  return Response.json({id,name,size:bytes.length,type:mime},{status:201,headers:{'cache-control':'no-store'}})
 }
 const match=/^\/api\/stall\/returns\/attachments\/([^/]+)$/.exec(url.pathname)
 if(!match)return null
 if(request.method!=='GET')fail('METHOD','Use GET.',405)
 const row=await env.DB.prepare('SELECT id,order_id,name,mime,data FROM st_return_files WHERE id=?').bind(decodeURIComponent(match[1])).first<{id:string;order_id:string;name:string;mime:string;data:string}>()
 if(!row)return error('NOT_FOUND','Photo not found.',404)
 // Native staff reading private evidence; every other reader must own the order.
 const serve=()=>new Response(decode(row.data),{headers:fileHeaders(row.mime,{'content-disposition':`inline; filename="${safeName(row.name)}"`,'cache-control':'private, no-store'})})
 if(request.headers.get('x-stall-order-token')===null&&!request.headers.has('authorization')) {
  const actor=await current(request,env).catch(()=>null)
  if(actor&&!actor.agent&&['owner','admin'].includes(actor.role))return serve()
 }
 await subject(request,env,row.order_id,false)
 return serve()
}
