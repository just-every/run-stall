import { operatorAuth,type Bindings } from '../../auth.server'
import { fail,text } from '../model'
/** Customer identity comes only from native verified sign-in. Contact supplied
 * in a body, an app token or an actor assertion can never authorize this door. */
export async function customerRequest(request:Request,env:Bindings,p:any) {
 if(request.headers.has('authorization')) fail('CUSTOMER_AUTH','Use your independent native customer session.',401)
 if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s customer page.',403)
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['orderId','kind'].includes(k))) fail('INPUT','Supply only an order ID and request kind.',400)
 const session=await operatorAuth(env).getSession(request)
 if(!session) fail('CUSTOMER_AUTH','Sign in independently to request help with your order.',401)
 const id=text(p.orderId,'Order ID',100),kind=p.kind,email=session.operator.email.toLowerCase()
 if(!['return','cancellation'].includes(kind)) fail('INPUT','Choose a return or cancellation request.',400)
 const owns=`SELECT 1 FROM st_orders o WHERE o.id=? AND lower(json_extract(o.value_json,'$.customerEmail'))=? AND json_extract(o.value_json,'$.erasedAt') IS NULL`
 if(!await env.DB.prepare(owns).bind(id,email).first()) fail('NOT_FOUND','Order not found.',404)
 const stamp=new Date().toISOString(),requestId=crypto.randomUUID()
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.status='active' AND lower(o.email)=? AND s.revoked_at IS NULL AND s.expires_at>?) AND EXISTS(${owns}) THEN 1 ELSE 0 END`).bind(session.id,session.operator.id,session.operator.version,email,Date.now(),id,email),
  env.DB.prepare('INSERT OR IGNORE INTO st_workflow_requests(id,order_id,kind,created_at) VALUES(?,?,?,?)').bind(requestId,id,kind,stamp),
  env.DB.prepare('INSERT INTO st_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM st_workflow_requests WHERE id=?)').bind(crypto.randomUUID(),id,'customer:'+session.operator.id,kind+'.requested',stamp,requestId),
  env.DB.prepare('DELETE FROM st_guard'),
 ])
 const found=await env.DB.prepare('SELECT id,order_id AS orderId,kind,created_at AS createdAt FROM st_workflow_requests WHERE order_id=? AND kind=?').bind(id,kind).first()
 return {request:found,status:'requested',message:'Staff review is required. No refund, return receipt, restock or cancellation has been performed.'}
}
