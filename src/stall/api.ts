import { runtimeBindings,type Bindings } from '../auth.server'
import { audit,commit,current,digest,live } from './access'
import { fail,Problem,requirePerson,requireSupplier,text } from './model'
import { catalogue,pierConfigured } from './pier'
import { products,orders } from './store'
import { productCommand } from './products'
import { shipmentCommand } from './fulfilment'
import { refreshShipments } from './shipment-sync'
import { refundCommand } from './refunds'
import { reconcileOrder } from './orders'
import { checkout } from './checkout'
import { uploadMedia,mediaResponse } from './media'
import { uploadPersonalization,uploadResponse } from './personalization'
import { validateLine } from './order-selection'
import { packingSlip } from './packing-slip'
import { checkAwaitingPayments,confirmReturn,webhook } from './payments'
import { localShop,rawBody } from './stripe'
import { operationsSnapshot,probeProviders } from './operations'
import { configureShipping,shippingCharge } from './shipping-charge'
import { businessTimeZone,configureShop } from './preferences'
import { orderNoteCommand } from './order-notes'
import { createManualOrder } from './manual-orders'
import { assignOrder } from './order-assignment'
import { orderHistory,searchOrders } from './order-search'
import { eraseCustomer } from './erasure'
import { connectionCommand,connectionDetails,withConnections } from './connections'
// Agent/connector readers retain commerce draft context, without staff annotations or staff-as-provider payment evidence.
function agentRecord({notes,tags,manualPayment,...record}:any) { return {...record,...(manualPayment?{manualPayment:{...manualPayment,reference:undefined},payment:undefined}:{})} }
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
async function body(request:Request):Promise<any> { try { const value=JSON.parse(await rawBody(request,100000));if(!value||typeof value!=='object'||Array.isArray(value)) fail('INPUT','A JSON object is required.',400);return value }catch(e) { if(e instanceof Problem) throw e;return fail('INPUT','Invalid JSON request.',400) } }
export async function stallResponse(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/stall/')) return null
 try {
  const base=runtimeBindings(original)
  // A demo uses its simulated providers; otherwise saved Settings connections fill unset secrets.
  const env=base.RER_DEMO==='1'?base:await withConnections(base)
  if(path==='/api/stall/webhook'&&request.method==='POST') return json(await webhook(request,env))
  if(path==='/api/stall/catalogue'&&request.method==='GET') return json(await catalogue(env))
  if(path.startsWith('/api/stall/media/')&&request.method==='GET') return mediaResponse(env,request,decodeURIComponent(path.slice(17)))
  if(path==='/api/stall/personalization/upload'&&request.method==='POST') return json(await uploadPersonalization(env,request))
  if(path==='/api/stall/catalogue/validate'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own product page.',403)
   return json(await validateLine(env,await body(request)))
  }
  if(path==='/api/stall/checkout'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own checkout page.',403)
   return json(await checkout(env,await body(request)))
  }
  if(path==='/api/stall/checkout/confirm'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own order page.',403)
   return json(await confirmReturn(env,text((await body(request)).orderId,'Order')))
  }
  const actor=await current(request,env)
  requireSupplier(actor)
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==env.AUTH_ORIGIN&&(!actor.agent||request.headers.has('origin'))) fail('ORIGIN','Use this installation’s own page to change records.',403)
  if(path==='/api/stall/media'&&request.method==='POST') return json(await uploadMedia(env,actor,request))
  if(path.startsWith('/api/stall/uploads/')&&request.method==='GET') { requirePerson(actor);return uploadResponse(env,decodeURIComponent(path.slice(19))) }
  if(path==='/api/stall/packing-slip'&&request.method==='GET') { requirePerson(actor);return packingSlip(env.DB,text(new URL(request.url).searchParams.get('orderId'),'Order')) }
  if(path==='/api/stall/operations'&&request.method==='GET') {
   requirePerson(actor);await live(env,actor)
   return json(await operationsSnapshot(env))
  }
  if(path==='/api/stall/operations/probe'&&request.method==='POST') {
   await probeProviders(env,actor)
   return json(await operationsSnapshot(env))
  }
  if(path==='/api/stall/state'&&request.method==='GET') {
   const [selected,history,logs,people]=await Promise.all([products(env.DB),orders(env.DB),env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all(),env.DB.prepare('SELECT id,display_name AS name,email,status FROM oa_operators').all<{id:string;name:string;email:string;status:string}>()])
   const shipping=await refreshShipments(env,actor,history)
   const historyChanged=shipping.orders.some((order,index)=>order.revision!==history[index].revision)
   const events=historyChanged?(await env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all()).results:logs.results
   return json({timeZone:await businessTimeZone(env.DB),staff:Object.fromEntries(people.results.filter(person=>person.status==='active').map(person=>[person.id,person.name||person.email])),people:Object.fromEntries(people.results.map(person=>[person.id,person.name||person.email])),actor,products:selected,shippingCents:await shippingCharge(env.DB),...shipping,orders:actor.agent?shipping.orders.map(agentRecord):shipping.orders,audit:events,connections:{pier:pierConfigured(env),stripe:Boolean(env.STRIPE_SECRET_KEY),webhook:Boolean(env.STRIPE_WEBHOOK_SECRET)||(localShop(env)&&Boolean(env.STRIPE_SECRET_KEY))},connectionDetails:await connectionDetails(base,env)})
  }
  if(path==='/api/stall/orders'&&request.method==='GET') { requirePerson(actor);return json(await searchOrders(env.DB,new URL(request.url).searchParams)) }
  if(path==='/api/stall/orders/history'&&request.method==='GET') { requirePerson(actor);return json(await orderHistory(env.DB,text(new URL(request.url).searchParams.get('orderId'),'Order'))) }
  if(path==='/api/stall/agent-token'&&request.method==='POST') {
   requirePerson(actor)
   if(actor.role!=='owner') fail('FORBIDDEN','Only the human owner may grant personal agent access.',403)
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),expiresAt=Date.now()+7*86400000
   await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_agent_tokens VALUES(?,?,?,?,?)').bind(id,await digest(token),actor.id,actor.version,expiresAt),audit(env.DB,actor,id,'agent.granted')])
   return json({id,token,expiresAt})
  }
  if(path==='/api/stall/agent-token'&&request.method==='GET') return json({grants:(await env.DB.prepare('SELECT id,actor_id AS actorId,expires_at AS expiresAt FROM st_agent_tokens WHERE actor_id=? ORDER BY expires_at DESC').bind(actor.id).all()).results})
  if(path==='/api/stall/agent-token/revoke'&&request.method==='POST') {
   requirePerson(actor)
   if(actor.role!=='owner') fail('FORBIDDEN','Only the human owner may revoke personal agent access.',403)
   const p=await body(request)
   const statement=p.grantId?env.DB.prepare('DELETE FROM st_agent_tokens WHERE actor_id=? AND id=?').bind(actor.id,text(p.grantId,'Grant ID')):env.DB.prepare('DELETE FROM st_agent_tokens WHERE actor_id=?').bind(actor.id)
   await commit(env.DB,actor,[statement,audit(env.DB,actor,actor.id,'agent.revoked')]);return json({revoked:true})
  }
  if(path==='/api/stall/commands'&&request.method==='POST') {
   const p=await body(request),type=p.type,payload=p.payload
   if(typeof type!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload)) fail('INPUT','A command has a type and payload.',400)
   if(actor.agent&&!['product.prepare','shipment.prepare','refund.prepare'].includes(type)) fail('PERSON_REQUIRED','Agents prepare drafts; a person must review and approve.',403)
   await live(env,actor)
   let result:unknown
   if(['product.prepare','product.approve'].includes(type)) result=await productCommand(env,actor,type,payload)
   else if(['shipment.prepare','shipment.approve'].includes(type)) result=await shipmentCommand(env,actor,type,payload)
   else if(['refund.prepare','refund.approve'].includes(type)) result=await refundCommand(env,actor,type,payload)
   else if(type==='order.reconcile') result=await reconcileOrder(env,actor,payload)
   else if(type==='shop.configure') result=await configureShop(env,actor,payload)
   else if(['order.note.add','order.note.redact','order.tag.add','order.tag.remove'].includes(type)) result=await orderNoteCommand(env,actor,type,payload)
   else if(type==='order.manual') result=await createManualOrder(env,actor,payload)
   else if(type==='order.assign') result=await assignOrder(env,actor,payload)
   else if(type==='shipping.configure') result=await configureShipping(env,actor,payload)
   else if(type==='customer.erase') result=await eraseCustomer(env,actor,payload)
   else if(['connection.pier','connection.stripe','connection.remove'].includes(type)) result=await connectionCommand(base,actor,type,payload)
   else fail('COMMAND','Unknown shop command.',404)
   return json({result:actor.agent&&result&&typeof result==='object'?agentRecord(result):result})
  }
  return json({error:{code:'NOT_FOUND',message:'Unknown shop endpoint.'}},404)
 } catch(error:any) {
  if(error instanceof Problem) return json({error:{code:error.code,message:error.message}},error.status)
  return json({error:{code:'CONFLICT',message:'The record or permissions changed. Refresh and reconcile the same operation before continuing.'}},path==='/api/stall/webhook'?503:409)
 }
}
/** The minute's scheduled run: confirm payments still awaiting Stripe. */
export async function stallScheduled(original:Bindings) {
 const base=runtimeBindings(original)
 if(base.RER_DEMO==='1') return
 await checkAwaitingPayments(await withConnections(base))
}
