import type { Bindings } from '../../auth.server'
import type { ToolContext, ApprovalSummary } from '../../modules/agent-door/index.ts'
import { products } from '../store'
import { productDraft } from '../products'
import { refundValue } from '../refund-values'
import { authorizeCommand } from '../permissions'
import { nativeActor, nativeCall } from './principal'
import { nativeOrder, sources } from './records'

/** Saved summaries expose the proposed values, rather than only the record ID. */
export async function productSummary(env:Bindings,args:Record<string,unknown>,ctx:ToolContext):Promise<ApprovalSummary> {
 return nativeCall(async()=>{
  authorizeCommand(await nativeActor(env,ctx),'product.prepare')
  const prior=(await products(env.DB)).find(row=>row.id===args.sku), draft=productDraft(prior,args)
  return {target:{id:draft.sku,name:draft.name},amount:{value:draft.unitCents/100,currency:'USD'},items:[
   `Description: ${draft.description}`,`Active when published: ${draft.active}`,`Archived: ${draft.archived===true}`,
   `Publication: ${draft.publishAt??'not scheduled'}`,
   ...Object.entries(draft.details??{}).map(([field,value])=>`${field}: ${JSON.stringify(value)}`),
  ]}
 })
}
export async function refundSummary(env:Bindings,args:Record<string,unknown>,ctx:ToolContext):Promise<ApprovalSummary> {
 return nativeCall(async()=>{
  const order=await nativeOrder(env,ctx,args.orderId), proposed=refundValue(order,args)
  return {target:{id:order.id},amount:{value:proposed.amountCents/100,currency:order.currency.toUpperCase()},items:[
   `Refund kind: ${proposed.kind}`,`Reason: ${String(args.reason)}`,`Tax: ${proposed.taxTreatment}`,
   ...proposed.lines.map(line=>`${line.quantity} × ${line.sku}`),
  ]}
 })
}
export async function proposalSummary(env:Bindings,args:Record<string,unknown>,ctx:ToolContext):Promise<ApprovalSummary> {
 const source=await sources(env,ctx,args.sku)
 const changes=args.changes as {field:string;value:string;target?:string;citations:string[]}[]
 return {target:{id:source.sku},items:[
  ...changes.map(change=>`${change.field}${change.target?` (${change.target})`:''}: ${change.value} — sources: ${change.citations.join(', ')}`),
  `Evidence requests: ${(args.requests as string[]??[]).join(', ')||'none'}`,
 ]}
}
