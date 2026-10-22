import { observeStock } from './stock'
export { observeStock } from './stock'
import { runtimeBindings,type Bindings } from '../../auth.server'
import { digest } from '../access'
import { withConnections } from '../connections'
import { Problem } from '../model'
import { catalogue } from '../pier'
import { adminResponse } from './admin'
import { app,customer,fenced,rate } from './auth'
import { body,json,prefix } from './common'
import { buy,cartQuote,confirmCheckout,createCart,ownOrder,ownOrders,readCart,updateCart } from './commerce'
async function preflight(request:Request,env:Bindings) {
 const origin=request.headers.get('origin')??''
 const approved=await env.DB.prepare(`SELECT a.id FROM st_headless_apps a JOIN oa_operators o ON o.id=a.issuer_id WHERE a.origin=? AND a.revoked_at IS NULL AND a.expires_at>? AND o.role='owner' AND o.status='active' AND o.version=a.issuer_version LIMIT 1`).bind(origin,Date.now()).first()
 if(!approved) return json({error:{code:'ORIGIN',message:'Unknown storefront origin.'}},403)
 return new Response(null,{status:204,headers:{'cache-control':'no-store',vary:'Origin','access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, PUT, OPTIONS','access-control-allow-headers':'Authorization, Content-Type, Idempotency-Key','access-control-max-age':'60'}})
}
/** Dispatch before the private Stall API. An integration is a separate principal,
 * and never obtains its issuer's private session or staff authority. */
export async function headlessResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==prefix&&!path.startsWith(prefix+'/')) return null
 let allowedOrigin:string|undefined
 try {
  const base=runtimeBindings(original)
  await rate(base,'inbound:'+await digest(request.headers.get('cf-connecting-ip')??'unknown'),300)
  if(path.startsWith(prefix+'/admin/')) return await adminResponse(request,base,path)
  if(request.method==='OPTIONS') return await preflight(request,base)
  let scope:string|undefined
  if(path===prefix+'/catalog'&&request.method==='GET') scope='catalog:read'
  else if((path===prefix+'/carts'&&request.method==='POST')||(/^\/api\/stall\/v1\/carts\/[^/]+$/.test(path)&&['GET','PUT'].includes(request.method))) scope='cart:write'
  else if((path===prefix+'/checkout'||path===prefix+'/checkout/confirm')&&request.method==='POST') scope='checkout:write'
  else if(/^\/api\/stall\/v1\/carts\/[^/]+\/quote$/.test(path)&&request.method==='POST') scope='cart:write'
  else if(path===prefix+'/customer'&&request.method==='GET') scope='customer:read'
  else if((path===prefix+'/orders'||/^\/api\/stall\/v1\/orders\/[^/]+$/.test(path))&&request.method==='GET') scope='orders:read'
  if(!scope) return json({error:{code:'NOT_FOUND',message:'Unknown versioned storefront endpoint.'}},404)
  const grant=await app(request,base,scope);allowedOrigin=grant.origin
  if(scope==='catalog:read') {
   const env=base.RER_DEMO==='1'?base:await withConnections(base)
   await observeStock(env)
   const found=await catalogue(env)
   await fenced(base,grant,null);return json(found,200,allowedOrigin)
  }
  const c=await customer(request,base,grant)
  if(path===prefix+'/customer') {await fenced(base,grant,c);return json({id:c.id,email:c.actor.email},200,allowedOrigin)}
  if(path===prefix+'/carts') return json(await createCart(base,grant,c,request,await body(request)),201,allowedOrigin)
  const cartId=path.match(/^\/api\/stall\/v1\/carts\/([^/]+)$/)?.[1]
  if(cartId) return json(request.method==='GET'?await readCart(base,grant,c,cartId):await updateCart(base,grant,c,cartId,await body(request)),200,allowedOrigin)
  const quoteId=path.match(/^\/api\/stall\/v1\/carts\/([^/]+)\/quote$/)?.[1]
  if(quoteId) {const env=base.RER_DEMO==='1'?base:await withConnections(base);return json(await cartQuote(env,grant,c,quoteId,await body(request)),200,allowedOrigin)}
  if(path===prefix+'/checkout/confirm') {const env=base.RER_DEMO==='1'?base:await withConnections(base);return json(await confirmCheckout(env,grant,c,await body(request)),200,allowedOrigin)}
  if(path===prefix+'/checkout') {
   const env=base.RER_DEMO==='1'?base:await withConnections(base)
   return json(await buy(env,grant,c,request,await body(request)),200,allowedOrigin)
  }
  if(path===prefix+'/orders') return json(await ownOrders(base,grant,c,url),200,allowedOrigin)
  return json(await ownOrder(base,grant,c,path.split('/').at(-1)!),200,allowedOrigin)
 } catch(e:any) {
  if(e instanceof Problem) return json({error:{code:e.code,message:e.message}},e.status,allowedOrigin)
  return json({error:{code:'CONFLICT',message:'Authority or state changed. Reconcile the same operation before continuing.'}},409,allowedOrigin)
 }
}
export { subscriptionConsent } from './admin'
export { headlessErasureStatements } from './erasure'
