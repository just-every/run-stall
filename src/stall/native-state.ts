import type { Bindings } from '../auth.server'
import type { Actor } from './model'
import { analyticsLabels } from './analytics/model'
import { live } from './access'
import { permits } from './permissions'
import { products, orders } from './store'
import { collections } from './collections'
import { merchandising } from './merchandising'
import { refreshShipments } from './shipment-sync'
import { businessTimeZone } from './preferences'
import { generalFlatCents } from './shipping-charge'
import { assignableSkus, shippingAssignments, shippingPlaces, shippingProfiles } from './shipping-profiles'
import { pierConfigured } from './pier'
import { localShop } from './stripe'
import { connectionDetails } from './connections'

// Agent/connector readers retain commerce draft context, without staff annotations or staff-as-provider payment evidence.
function agentRecord({notes,tags,manualPayment,...record}:any) { return {...record,...(manualPayment?{manualPayment:{...manualPayment,reference:undefined},payment:undefined}:{})} }
export function privateOrder(actor:import('./model').Actor,{requestDigest,checkoutKey,checkout,analytics,...rest}:any) {
 const record={...rest,...(analytics&&!actor.agent&&!actor.staffRole?{analytics:analyticsLabels(analytics)}:{})}
 if(actor.agent)return agentRecord(record)
 if(permits(actor,'support'))return record
 const {notes,tags,manualPayment,...visible}=record
 return {...visible,...(manualPayment?{manualPayment:{...manualPayment,reference:undefined}}:{})}
}
async function shippingState(db:D1Database) {
 const [profiles,places,assignments,known]=await Promise.all([shippingProfiles(db),shippingPlaces(db),shippingAssignments(db),assignableSkus(db)])
 return {profiles,places,assignments,skus:[...known].map(([sku,item])=>({sku,...item}))}
}
/** Native desk refresh. Provider observations persist through the usual order service. */
export async function stallState(env: Bindings, actor: Actor, base: Bindings = env) {
   if(!['owner','admin'].includes(actor.role)) {
    await live(env,actor)
    const records=permits(actor,'orders')?await orders(env.DB):[]
    const clean=records.map(record=>privateOrder(actor,record))
    return ({actor,timeZone:await businessTimeZone(env.DB),people:{[actor.id]:actor.email},staff:{},products:permits(actor,'catalog')?await products(env.DB):permits(actor,'marketing')?(await products(env.DB)).filter(p=>p.value.active&&!p.value.archived&&(!p.value.publishAt||Date.parse(p.value.publishAt)<=Date.now())).map(({id,revision,value:{draft,approval,...value}})=>({id,revision,value})):[],orders:clean,audit:[],...((permits(actor,'marketing')||permits(actor,'catalog'))?{merchandising:{collections:await collections(env.DB),config:await merchandising(env.DB)}}:{}),...(permits(actor,'admin')?{shipping:await shippingState(env.DB)}:{}),connections:{pier:false,stripe:false,webhook:false}})
   }
   const [selected,history,logs,people]=await Promise.all([products(env.DB),orders(env.DB),env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all(),env.DB.prepare('SELECT id,display_name AS name,email,status FROM oa_operators').all<{id:string;name:string;email:string;status:string}>()])
   const shipping=await refreshShipments(env,actor,history)
   const historyChanged=shipping.orders.some((order,index)=>order.revision!==history[index].revision)
   const events=historyChanged?(await env.DB.prepare('SELECT * FROM st_audit ORDER BY rowid DESC LIMIT 200').all()).results:logs.results
   return ({timeZone:await businessTimeZone(env.DB),staff:Object.fromEntries(people.results.filter(person=>person.status==='active').map(person=>[person.id,person.name||person.email])),people:Object.fromEntries(people.results.map(person=>[person.id,person.name||person.email])),actor,products:selected,merchandising:{collections:await collections(env.DB),config:await merchandising(env.DB)},shippingCents:await generalFlatCents(env.DB),shipping:await shippingState(env.DB),...shipping,orders:actor.agent?shipping.orders.map(agentRecord):shipping.orders,audit:events,connections:{pier:pierConfigured(env),stripe:Boolean(env.STRIPE_SECRET_KEY),webhook:Boolean(env.STRIPE_WEBHOOK_SECRET)||(localShop(env)&&Boolean(env.STRIPE_SECRET_KEY))},connectionDetails:await connectionDetails(base,env)})
}
