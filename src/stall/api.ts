import { registrationResponse,expireCustomerRegistrations } from './customers/registration'
import { balanceResponse } from './customers/balances'
import { proposalBundle, previewProposal, proposalCommand } from './proposals'
import { recoverTaxTransaction } from './tax/transactions'
import { taxCommerceState,ownerTaxCommerceState,publicTaxCommerce,ownerTaxCommerce } from './tax/commerce'
import { quoteTax } from './tax/commerce-quote'
import { marketplaceState,recordMarketplaceSales } from './tax/marketplace'
import { readTaxConfiguration,saveTaxConfiguration,readTaxExemptions,saveTaxExemption } from './tax/configuration'
import { taxLiability,taxReportCsv,taxNexus } from './tax/reports'
import { taxOwner,taxBoundaryFor,taxReadiness,taxHistory,previewTax } from './tax'
import { cartResponse } from './customers/cart'
import { guestOrderResponse } from './customers/guest-orders'
import { privacyResponse } from './customers/privacy'
import { customerResponse } from './customers'
import { customerCommit,requireProvenEmail } from './customers/account'
import { workflowResponse,runWorkflows } from './workflows'
import { returnsResponse } from './returns'
import { promotionRoutes } from './promotions'
import { headlessResponse,observeStock } from './headless'
import { riskCommand,riskSnapshot } from './risk'
import { refreshRisk } from './payments'
import { authorize,authorizeCommand,permits } from './permissions'
import { staffCommand,staffSnapshot } from './staff'
import { runtimeBindings,type Bindings } from '../auth.server'
import { audit,clientKey,commit,current,digest,live } from './access'
import { releaseExpiredHolds } from './promotions/holds'
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
import { priceLines,selectLines,validateLine } from './order-selection'
import { packingSlip } from './packing-slip'
import { collectionCommand,collections } from './collections'
import { merchandising,merchandisingCommand } from './merchandising'
import { discover,readFilters,suggest,type Source } from './discover'
import { recordSearch,searchReport } from './search-report'
import { menuLinks } from './menu-links'
import { checkAwaitingPayments,confirmReturn,webhook } from './payments'
import { localShop,rawBody } from './stripe'
import { operationsSnapshot,probeProviders } from './operations'
import { configureShipping,generalFlatCents } from './shipping-charge'
import { assignCommand,assignableSkus,placeCommand,profileCommand,shippingAssignments,shippingPlaces,shippingProfiles } from './shipping-profiles'
import { postalCodeOf,quoteShipping } from './shipping-quote'
import { businessTimeZone,configureShop } from './preferences'
import { orderNoteCommand } from './order-notes'
import { createManualOrder } from './manual-orders'
import { assignOrder } from './order-assignment'
import { orderHistory,searchOrders } from './order-search'
import { eraseCustomer } from './erasure'
import { connectionCommand,connectionDetails,withConnections } from './connections'
// Agent/connector readers retain commerce draft context, without staff annotations or staff-as-provider payment evidence.
function agentRecord({notes,tags,manualPayment,...record}:any) { return {...record,...(manualPayment?{manualPayment:{...manualPayment,reference:undefined},payment:undefined}:{})} }
function privateOrder(actor:import('./model').Actor,{requestDigest,checkoutKey,checkout,...record}:any) {
 if(actor.agent)return agentRecord(record)
 if(permits(actor,'support'))return record
 const {notes,tags,manualPayment,...visible}=record
 return {...visible,...(manualPayment?{manualPayment:{...manualPayment,reference:undefined}}:{})}
}
async function verifiedTaxCustomer(request:Request,env:Bindings) {
 if(!request.headers.get('cookie')||request.headers.has('authorization'))return undefined
 const actor=await current(request,env)
 requirePerson(actor);await requireProvenEmail(env,actor.sessionId!,actor.id);await customerCommit(env,actor)
 return actor.email
}
async function discoverySource(env:Bindings):Promise<Source> {
 const [stock,saved,config]=await Promise.all([catalogue(env),collections(env.DB),merchandising(env.DB)])
 return {products:stock.products,items:stock.items,collections:saved,config:config.value}
}
async function shippingState(db:D1Database) {
 const [profiles,places,assignments,known]=await Promise.all([shippingProfiles(db),shippingPlaces(db),shippingAssignments(db),assignableSkus(db)])
 return {profiles,places,assignments,skus:[...known].map(([sku,item])=>({sku,...item}))}
}
/** The shopper's shipping options for a basket and ZIP code, priced from current published lines. */
async function shippingQuote(env:Bindings,p:any) {
 return quoteShipping(env.DB,await priceLines(env,selectLines(p.lines)),postalCodeOf(p.postalCode))
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
async function body(request:Request):Promise<any> { try { const value=JSON.parse(await rawBody(request,100000));if(!value||typeof value!=='object'||Array.isArray(value)) fail('INPUT','A JSON object is required.',400);return value }catch(e) { if(e instanceof Problem) throw e;return fail('INPUT','Invalid JSON request.',400) } }
export async function stallResponse(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/stall/')) return null
 try {
  const base=runtimeBindings(original)
  // A demo uses its simulated providers; otherwise saved Settings connections fill unset secrets.
  const env=base.RER_DEMO==='1'?base:await withConnections(base)
  const registration=await registrationResponse(request,env);if(registration)return registration
  const balances=await balanceResponse(request,env);if(balances)return balances
  const guest=await guestOrderResponse(request,env);if(guest)return guest
  const cart=await cartResponse(request,env);if(cart)return cart
  const privacy=await privacyResponse(request,env);if(privacy)return privacy
  const customer=await customerResponse(request,env);if(customer)return customer
  const promotionResponse=await promotionRoutes(request,env,path);if(promotionResponse)return promotionResponse
  const returns=await returnsResponse(request,env);if(returns)return returns
  const workflows=await workflowResponse(request,env);if(workflows)return workflows
  const headless=await headlessResponse(request,env);if(headless)return headless
  if(path==='/api/stall/webhook'&&request.method==='POST') return json(await webhook(request,env))
  if(path==='/api/stall/catalogue'&&request.method==='GET') return json(await catalogue(env))
  if(path.startsWith('/api/stall/media/')&&request.method==='GET') return await mediaResponse(env,request,decodeURIComponent(path.slice(17)))
  if(path==='/api/stall/personalization/upload'&&request.method==='POST') return json(await uploadPersonalization(env,request))
  if(path==='/api/stall/catalogue/validate'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own product page.',403)
   return json(await validateLine(env,await body(request)))
  }
  if(path==='/api/stall/menus'&&request.method==='GET') return json({menus:await menuLinks(env.DB)})
  if(path==='/api/stall/discover'&&['GET'].includes(request.method)) {
   const params=new URL(request.url).searchParams,found=await discoverySource(env),result=discover(found,readFilters(params))
   if(params.get('report')==='1'&&result.query) await recordSearch(env.DB,result.query,result.total)
   return json(result)
  }
  if(path==='/api/stall/discover/suggest'&&request.method==='GET') return json({suggestions:suggest(await discoverySource(env),(new URL(request.url).searchParams.get('q')??'').slice(0,100))})
  if(path==='/api/stall/shipping/quote'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own checkout page.',403)
   return json(await shippingQuote(env,await body(request)))
  }
  if(path==='/api/stall/tax/mode'&&request.method==='GET')return json(await publicTaxCommerce(env))
  if(path==='/api/stall/tax/quote'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s checkout to review tax.',403)
   return json(await quoteTax(env,await body(request),await verifiedTaxCustomer(request,env)))
  }
  if(path==='/api/stall/checkout'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own checkout page.',403)
   const input=await body(request)
   return json(await checkout(env,input,undefined,await clientKey(env,request),input.taxQuoteId?await verifiedTaxCustomer(request,env):undefined))
  }
  if(path==='/api/stall/checkout/confirm'&&request.method==='POST') {
   if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own order page.',403)
   return json(await confirmReturn(env,text((await body(request)).orderId,'Order')))
  }
  const actor=await current(request,env)
  if(path==='/api/stall/customer/orders'&&request.method==='GET') { requirePerson(actor);await requireProvenEmail(env,actor.sessionId!,actor.id);return json({orders:(await orders(env.DB)).filter(o=>!o.erasedAt&&o.customerEmail===actor.email).map(({id,createdAt,status,lines,totalCents,currency})=>({id,createdAt,status,lines:lines.map(({sku,name,quantity,unitCents})=>({sku,name,quantity,unitCents})),totalCents,currency}))}) }
  requireSupplier(actor)
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==env.AUTH_ORIGIN&&(!actor.agent||request.headers.has('origin'))) fail('ORIGIN','Use this installation’s own page to change records.',403)
  if(path.startsWith('/api/stall/tax/')) {
   taxOwner(actor);await live(env,actor)
   const search=new URL(request.url).searchParams
   if(path==='/api/stall/tax/recover'&&request.method==='POST')return json(await recoverTaxTransaction(env,actor,await body(request)))
   if(path==='/api/stall/tax/commerce'&&request.method==='GET')return json(await (search.get('review')==='1'?ownerTaxCommerceState(env):taxCommerceState(env)))
   if(path==='/api/stall/tax/commerce'&&request.method==='POST')return json(await ownerTaxCommerce(env,actor,await body(request)))
   if(path==='/api/stall/tax/configuration'&&request.method==='GET')return json(await readTaxConfiguration(env))
   if(path==='/api/stall/tax/configuration'&&request.method==='POST')return json(await saveTaxConfiguration(env,actor,await body(request)))
   if(path==='/api/stall/tax/exemptions'&&request.method==='GET')return json(await readTaxExemptions(env))
   if(path==='/api/stall/tax/exemptions'&&request.method==='POST')return json(await saveTaxExemption(env,actor,await body(request)))
   if(path==='/api/stall/tax/liability'&&request.method==='GET')return json(await taxLiability(env,search))
   if(path==='/api/stall/tax/liability.csv'&&request.method==='GET')return taxReportCsv(env,search)
   if(path==='/api/stall/tax/nexus'&&request.method==='GET')return json(await taxNexus(env,search))
   if(path==='/api/stall/tax/marketplace'&&request.method==='GET')return json(await marketplaceState(env))
   if(path==='/api/stall/tax/marketplace'&&request.method==='POST')return json(await recordMarketplaceSales(env,actor,await body(request)))
   if(path==='/api/stall/tax/boundary'&&request.method==='GET')return json(await taxBoundaryFor(env))
   if(path==='/api/stall/tax/readiness'&&request.method==='GET')return json(await taxReadiness(env))
   if(path==='/api/stall/tax/previews'&&request.method==='GET')return json(await taxHistory(env))
   if(path==='/api/stall/tax/preview'&&request.method==='POST')return json(await previewTax(env,actor,await body(request)))
  }
  if(path==='/api/stall/risk'&&request.method==='GET') return json(await riskSnapshot(env,actor))
  if(path==='/api/stall/staff'&&request.method==='GET') return json(await staffSnapshot(env,actor))

  if(path.startsWith('/api/stall/merchandising')) {
   if(!['owner','admin'].includes(actor.role)||actor.staffRole) fail('FORBIDDEN','Only the owner or administrator may read merchandising proposals.',403)
   await live(env,actor)
   if(path==='/api/stall/merchandising'&&request.method==='GET')return json(await proposalBundle(env.DB,text(new URL(request.url).searchParams.get('sku'),'Product SKU',100)))
   if(path==='/api/stall/merchandising/preview'&&request.method==='POST')return json(await previewProposal(env,await body(request)))
  }
  if(path==='/api/stall/search-report'&&request.method==='GET') { authorize(actor,'marketing');requirePerson(actor);return json(await searchReport(env.DB)) }
  if(path==='/api/stall/media'&&request.method==='POST') { authorize(actor,'catalog');return json(await uploadMedia(env,actor,request)) }
  if(path.startsWith('/api/stall/uploads/')&&request.method==='GET') { authorize(actor,'orders');requirePerson(actor);return await uploadResponse(env,decodeURIComponent(path.slice(19))) }
  if(path==='/api/stall/packing-slip'&&request.method==='GET') { authorize(actor,'fulfillment');requirePerson(actor);return await packingSlip(env.DB,text(new URL(request.url).searchParams.get('orderId'),'Order')) }
  if(path==='/api/stall/operations'&&request.method==='GET') {
   authorize(actor,'admin');requirePerson(actor);await live(env,actor)
   return json(await operationsSnapshot(env))
  }
  if(path==='/api/stall/operations/probe'&&request.method==='POST') {
   authorize(actor,'admin');await probeProviders(env,actor)
   return json(await operationsSnapshot(env))
  }
  if(path==='/api/stall/state'&&request.method==='GET') {
   if(!['owner','admin'].includes(actor.role)) {
    await live(env,actor)
    const records=permits(actor,'orders')?await orders(env.DB):[]
    const clean=records.map(record=>privateOrder(actor,record))
    return json({actor,timeZone:await businessTimeZone(env.DB),people:{[actor.id]:actor.email},staff:{},products:permits(actor,'catalog')?await products(env.DB):permits(actor,'marketing')?(await products(env.DB)).filter(p=>p.value.active&&!p.value.archived&&(!p.value.publishAt||Date.parse(p.value.publishAt)<=Date.now())).map(({id,revision,value:{draft,approval,...value}})=>({id,revision,value})):[],orders:clean,audit:[],...((permits(actor,'marketing')||permits(actor,'catalog'))?{merchandising:{collections:await collections(env.DB),config:await merchandising(env.DB)}}:{}),...(permits(actor,'admin')?{shipping:await shippingState(env.DB)}:{}),connections:{pier:false,stripe:false,webhook:false}})
   }
   const [selected,history,logs,people]=await Promise.all([products(env.DB),orders(env.DB),env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all(),env.DB.prepare('SELECT id,display_name AS name,email,status FROM oa_operators').all<{id:string;name:string;email:string;status:string}>()])
   const shipping=await refreshShipments(env,actor,history)
   const historyChanged=shipping.orders.some((order,index)=>order.revision!==history[index].revision)
   const events=historyChanged?(await env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all()).results:logs.results
   return json({timeZone:await businessTimeZone(env.DB),staff:Object.fromEntries(people.results.filter(person=>person.status==='active').map(person=>[person.id,person.name||person.email])),people:Object.fromEntries(people.results.map(person=>[person.id,person.name||person.email])),actor,products:selected,merchandising:{collections:await collections(env.DB),config:await merchandising(env.DB)},shippingCents:await generalFlatCents(env.DB),shipping:await shippingState(env.DB),...shipping,orders:actor.agent?shipping.orders.map(agentRecord):shipping.orders,audit:events,connections:{pier:pierConfigured(env),stripe:Boolean(env.STRIPE_SECRET_KEY),webhook:Boolean(env.STRIPE_WEBHOOK_SECRET)||(localShop(env)&&Boolean(env.STRIPE_SECRET_KEY))},connectionDetails:await connectionDetails(base,env)})
  }
  if(path==='/api/stall/orders'&&request.method==='GET') { authorize(actor,'orders');requirePerson(actor);const found=await searchOrders(env.DB,new URL(request.url).searchParams);return json({...found,orders:found.orders.map(record=>privateOrder(actor,record))}) }
  if(path==='/api/stall/orders/history'&&request.method==='GET') { authorize(actor,'orders');requirePerson(actor);return json(await orderHistory(env.DB,text(new URL(request.url).searchParams.get('orderId'),'Order'))) }
  if(path==='/api/stall/agent-token'&&request.method==='POST') {
   requirePerson(actor)
   if(actor.role!=='owner') fail('FORBIDDEN','Only the human owner may grant personal agent access.',403)
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),expiresAt=Date.now()+7*86400000
   await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_agent_tokens VALUES(?,?,?,?,?)').bind(id,await digest(token),actor.id,actor.version,expiresAt),audit(env.DB,actor,id,'agent.granted')])
   return json({id,token,expiresAt})
  }
  if(path==='/api/stall/agent-token'&&request.method==='GET') { authorize(actor,'admin');return json({grants:(await env.DB.prepare('SELECT id,actor_id AS actorId,expires_at AS expiresAt FROM st_agent_tokens WHERE actor_id=? ORDER BY expires_at DESC').bind(actor.id).all()).results}) }
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
   if(actor.agent&&!['product.prepare','shipment.prepare','refund.prepare','merch.prepare'].includes(type)) fail('PERSON_REQUIRED','Agents prepare drafts; a person must review and approve.',403)
   authorizeCommand(actor,type)
   await live(env,actor)
   let result:unknown
   if(type==='risk.refresh') { await riskSnapshot(env,actor);result=await refreshRisk(env,await (await import('./store')).readOrder(env.DB,text(payload.orderId,'Order'))) }
   else if(type.startsWith('risk.')) result=await riskCommand(env,actor,type,payload)
   else if(type==='staff.configure') result=await staffCommand(env,actor,payload)
   else if(['merch.prepare','merch.approve'].includes(type)) result=await proposalCommand(env,actor,type,payload)
   else if(['product.prepare','product.approve'].includes(type)) result=await productCommand(env,actor,type,payload)
   else if(['shipment.prepare','shipment.approve'].includes(type)) result=await shipmentCommand(env,actor,type,payload)
   else if(['refund.prepare','refund.approve'].includes(type)) result=await refundCommand(env,actor,type,payload)
   else if(type==='order.reconcile') result=await reconcileOrder(env,actor,payload)
   else if(type==='shop.configure') result=await configureShop(env,actor,payload)
   else if(['order.note.add','order.note.redact','order.tag.add','order.tag.remove'].includes(type)) result=await orderNoteCommand(env,actor,type,payload)
   else if(type==='order.manual') result=await createManualOrder(env,actor,payload)
   else if(type==='order.assign') result=await assignOrder(env,actor,payload)
   else if(type==='shipping.configure') result=await configureShipping(env,actor,payload)
   else if(['shipping.profile.save','shipping.profile.delete'].includes(type)) result=await profileCommand(env,actor,type,payload)
   else if(type==='shipping.place') result=await placeCommand(env,actor,payload)
   else if(type==='shipping.assign') result=await assignCommand(env,actor,payload)
   else if(['collection.save','collection.delete'].includes(type)) result=await collectionCommand(env,actor,type,payload)
   else if(['menu.save','search.synonyms','search.pin'].includes(type)) result=await merchandisingCommand(env,actor,type,payload)
   else if(type==='customer.erase') result=await eraseCustomer(env,actor,payload)
   else if(['connection.pier','connection.stripe','connection.remove'].includes(type)) result=await connectionCommand(base,actor,type,payload)
   else fail('COMMAND','Unknown shop command.',404)
   return json({result:result&&typeof result==='object'&&'customerEmail' in result?privateOrder(actor,result):result})
  }
  return json({error:{code:'NOT_FOUND',message:'Unknown shop endpoint.'}},404)
 } catch(error:any) {
  if(error instanceof Problem) return json({error:{code:error.code,message:error.message}},error.status)
  return json({error:{code:'CONFLICT',message:'The record or permissions changed. Refresh and reconcile the same operation before continuing.'}},path==='/api/stall/webhook'?503:409)
 }
}
/** The minute's scheduled run: confirm payments still awaiting Stripe and release lapsed promotion holds. */
export async function stallScheduled(original:Bindings) {
 const base=runtimeBindings(original)
 if(base.RER_DEMO==='1') return
 const env=await withConnections(base)
 await expireCustomerRegistrations(env)
 await checkAwaitingPayments(env)
 await releaseExpiredHolds(env)
 await runWorkflows(env)
 await observeStock(env)
}
