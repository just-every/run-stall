import type { Bindings } from '../../auth.server'
import { fail,integer,Problem,text } from '../model'
import { catalogue,decimal } from '../pier'
import { personalize } from '../personalization'
import { ownOrder,addressValue } from './account'
import { cartCreate,cartPublic,type CartContext } from './cart'
import type { Selected } from '../order-selection'

/** Reorder copies a verified customer's own past purchase into a new unreviewed
 * cart. It reads stock only; checkout alone may create payment/reservation work. */
export async function reorder(env:Bindings,ctx:CartContext,p:any) {
 if(!ctx.actor)fail('CUSTOMER_AUTH','Sign in to reorder your own purchase.',401)
 if(Object.keys(p).some(k=>k!=='orderId'))fail('INPUT','Supply only your own past order ID.',400)
 const original=await ownOrder(env,ctx.actor,text(p.orderId,'Order ID',100))
 if(!original.payment)fail('PAST_ORDER_REQUIRED','Only a paid past order can be reordered.')
 const catalog=await catalogue(env),lines:Selected[]=[],omissions:{sku:string;reason:string}[]=[],priceChanges:{sku:string;previousUnitCents:number;currentUnitCents:number}[]=[]
 for(const old of original.lines) {
  const product=catalog.items.find(item=>item.sku===old.sku)
  if(!product){omissions.push({sku:old.sku,reason:'This variant is archived, unpublished or no longer available.'});continue}
  if(BigInt(old.quantity)*1000000n>decimal(product.available)){omissions.push({sku:old.sku,reason:'There is not enough stock for the original quantity.'});continue}
  // A past file upload is order-bound private material, never a fresh upload
  // capability. Require the shopper to supply it again instead of copying it.
  if(old.personalization?.some(answer=>answer.type==='file')){omissions.push({sku:old.sku,reason:'Upload the personalization file again before adding this variant.'});continue}
  const given=Object.fromEntries((old.personalization??[]).map(answer=>[answer.key,answer.value]))
  let answers
  try {answers=await personalize(env,product.personalization,old.sku,given)}
  catch(error){if(!(error instanceof Problem))throw error;omissions.push({sku:old.sku,reason:error.message});continue}
  const currentUnitCents=integer(product.unitCents+answers.reduce((sum,answer)=>sum+answer.addOnCents,0),'Current unit cents',1)
  if(currentUnitCents!==old.unitCents)priceChanges.push({sku:old.sku,previousUnitCents:old.unitCents,currentUnitCents})
  lines.push({sku:old.sku,quantity:old.quantity,...(answers.length?{personalization:given}:{})})
 }
 let address
 const previous=original.shippingDetails?{name:original.shippingDetails.name,...original.shippingDetails.address}:original.shopper?.address
 if(previous){try{address=addressValue(previous)}catch(error){if(!(error instanceof Problem))throw error}}
 const notice={sourceOrderId:original.id,omissions,priceChanges,requiresCheckoutReview:true}
 const sourceGuard=env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_orders WHERE id=? AND revision=? AND lower(json_extract(value_json,'$.customerEmail'))=? AND json_extract(value_json,'$.erasedAt') IS NULL) THEN 1 ELSE 0 END`).bind(original.id,original.revision,ctx.actor.email.toLowerCase())
 const cart=await cartCreate(env,ctx,{lines,customerEmail:ctx.actor.email.toLowerCase(),...(address?{shopper:{address}}:{}),reorder:notice},[sourceGuard])
 return {cart:cartPublic(cart),...notice}
}
