import { fail,type Actor } from './model'
export const staffRoles=['catalog','fulfillment','customer_support','marketing','finance','administrator'] as const
export type StaffRole=typeof staffRoles[number]
export const commandPermission:Record<string,string>={
 'product.prepare':'catalog','product.approve':'catalog','collection.save':'catalog','collection.delete':'catalog',
 'menu.save':'marketing','search.synonyms':'marketing','search.pin':'marketing',
 'shipment.prepare':'fulfillment','shipment.approve':'fulfillment','order.assign':'fulfillment',
 'order.note.add':'support','order.tag.add':'support','order.tag.remove':'support',
 'order.manual':'finance','refund.prepare':'finance','refund.approve':'finance',
}
const rights:Record<StaffRole,string[]>={catalog:['catalog','bulk'],fulfillment:['fulfillment','orders','support'],customer_support:['orders','support'],marketing:['marketing'],finance:['finance','orders'],administrator:['catalog','bulk','fulfillment','orders','support','marketing','finance','admin']}
export function permits(actor:Pick<Actor,'role'|'agent'|'staffRole'>,right:string) {
 if(['owner','admin'].includes(actor.role)) return true
 return !actor.agent&&!!actor.staffRole&&rights[actor.staffRole].includes(right)
}
export function authorize(actor:Actor,right:string) {
 if(!permits(actor,right)) fail('FORBIDDEN','Your current staff permissions do not allow this action.',403)
}
export function authorizeCommand(actor:Actor,type:string) { authorize(actor,commandPermission[type]??'admin') }
/** Financial limits are checked again immediately before the recorded or provider effect. */
export function refundAuthority(actor:Actor,amount:number,preparedBy:string) {
 authorize(actor,'finance')
 if(actor.role==='owner') return
 if(actor.refundLimitCents!==undefined&&amount>actor.refundLimitCents) fail('REFUND_LIMIT','The refund exceeds your configured approval limit.',403)
 if(actor.separateApproval===true&&preparedBy===actor.id) fail('SEPARATE_APPROVAL','Another authorized person must approve this refund.',403)
}
