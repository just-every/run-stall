import type { Bindings } from '../../auth.server'
import type { ToolDefinition, ToolContext } from '../../modules/agent-door/index.ts'
import { authorizeCommand } from '../permissions'
import { productCommand } from '../products'
import { shipmentCommand } from '../fulfilment'
import { refundCommand } from '../refunds'
import { proposalCommand } from '../proposals'
import { products } from '../store'
import { nativeActor, nativeCall } from './principal'
import { productRecord, nativeOrder, orderRecord, sources } from './records'
import { object, string, product, order, proposal } from './schemas'
import { productDraftInput } from './product-schema'
import { productSummary, refundSummary, proposalSummary } from './draft-summaries'

async function admitted(env: Bindings, ctx: ToolContext, command: string, effect = false) {
 return nativeCall(async()=>{const actor=await nativeActor(env,ctx,effect);authorizeCommand(actor,command);return actor})
}
export function draftTools(env: Bindings): ToolDefinition[] {
 return [
  {name:'stall.catalog1.edit',title:'Prepare a product draft',description:'Prepare one internal product draft with native listing, variant, media, personalization and merchant-fact validation. Details and archived status retain prior values when omitted; publishAt may be cleared with null. A person publishes the exact draft.',scope:'catalog:write',readOnly:false,inputSchema:productDraftInput,outputSchema:product,classes:['standard'],clauses:['CATALOG-001','AGENT-001'],untrusted:true,
   classify:async(_args,ctx)=>{await admitted(env,ctx,'product.prepare');return [{class:'standard',facts:{measure:1}}]},
   target:async(args,ctx)=>{await admitted(env,ctx,'product.prepare');const row=(await products(env.DB)).find(row=>row.id===args.sku);return row?{kind:'product',id:row.id}:null},
   revisionType:'string',revision:async(args,ctx)=>{await admitted(env,ctx,'product.prepare');return (await products(env.DB)).find(row=>row.id===args.sku)?.revision??null},
   summary:(args,ctx)=>productSummary(env,args,ctx),
   run:async(args,ctx)=>nativeCall(async()=>({result:await productCommand(env,await admitted(env,ctx,'product.prepare',true),'product.prepare',args)}))},
  {name:'stall.order2.manage',title:'Prepare a shipment draft',description:'Prepare a shipment for one paid reserved order, observing its original Pier stock authority. Does not dispatch or approve it.',scope:'orders:write',readOnly:false,inputSchema:object({orderId:string,revision:string,reference:string}),outputSchema:order,classes:['standard'],clauses:['ORDER-002','AGENT-001'],untrusted:true,
   classify:async(args,ctx)=>{await admitted(env,ctx,'shipment.prepare');await nativeOrder(env,ctx,args.orderId);return [{class:'standard',facts:{measure:1}}]},
   target:async(args,ctx)=>({kind:'order',id:(await nativeOrder(env,ctx,args.orderId)).id}),
   revisionType:'string',revision:async(args,ctx)=>(await nativeOrder(env,ctx,args.orderId)).revision,
   summary:async(args,ctx)=>{const row=await nativeOrder(env,ctx,args.orderId);return {target:{id:row.id,name:String(args.reference)},items:row.lines.map(line=>`${line.quantity} × ${line.sku}`)}},
   run:async(args,ctx)=>nativeCall(async()=>({result:orderRecord(await shipmentCommand(env,await admitted(env,ctx,'shipment.prepare',true),'shipment.prepare',args))}))},
  {name:'stall.order3.manage',title:'Prepare a refund draft',description:'Prepare a native lines (default), shipping, goodwill or address_change refund. Lines use original paid quantities; shipping and goodwill require amountCents. Taxed goodwill requires taxUnchanged:true. Address changes refund the whole eligible unshipped payment after native Stripe address verification. A person approves money movement.',scope:'orders:write',readOnly:false,inputSchema:object({orderId:string,revision:string,reason:{...string,maxLength:500},kind:{type:'string',enum:['lines','shipping','goodwill','address_change']},lines:{type:'array',items:object({sku:{...string,maxLength:100},quantity:{type:'integer',minimum:1,maximum:1000}})},amountCents:{type:'integer',minimum:1,maximum:100000000},taxUnchanged:{type:'boolean'}},['orderId','revision','reason']),outputSchema:order,classes:['standard'],clauses:['ORDER-003','AGENT-001'],untrusted:true,
   classify:async(args,ctx)=>{await admitted(env,ctx,'refund.prepare');await nativeOrder(env,ctx,args.orderId);return [{class:'standard',facts:{measure:1}}]},
   target:async(args,ctx)=>({kind:'order',id:(await nativeOrder(env,ctx,args.orderId)).id}),
   revisionType:'string',revision:async(args,ctx)=>(await nativeOrder(env,ctx,args.orderId)).revision,
   summary:(args,ctx)=>refundSummary(env,args,ctx),
   run:async(args,ctx)=>nativeCall(async()=>({result:orderRecord(await refundCommand(env,await admitted(env,ctx,'refund.prepare',true),'refund.prepare',args))}))},
  {name:'stall.ai5.operate',title:'Prepare a cited merchandising proposal',description:'Prepare up to forty internal merchandising changes from exact approved merchant facts. Questions remain unanswered when evidence is missing. No channel submission or publication.',scope:'catalog:write',readOnly:false,inputSchema:object({sku:string,revision:string,changes:{type:'array',minItems:1,maxItems:40,items:object({field:{type:'string',enum:['name','description','seoTitle','seoDescription','alt','attribute','collection','channel']},value:{type:'string',maxLength:4000},citations:{type:'array',minItems:1,maxItems:20,items:string},target:{...string,maxLength:100}},['field','value','citations'])},requests:{type:'array',maxItems:3,items:{type:'string',enum:['inventory','certification','reviews']}}},['sku','revision','changes']),outputSchema:proposal,classes:['standard'],clauses:['AI-005','AGENT-001'],untrusted:true,
   classify:async(args,ctx)=>{await admitted(env,ctx,'merch.prepare');await sources(env,ctx,args.sku);return [{class:'standard',facts:{measure:1}}]},
   target:async(args,ctx)=>({kind:'product',id:(await productRecord(env,ctx,args.sku)).id}),
   revisionType:'string',revision:async(args,ctx)=>(await productRecord(env,ctx,args.sku)).revision,
   summary:(args,ctx)=>proposalSummary(env,args,ctx),
   run:async(args,ctx)=>nativeCall(async()=>({result:await proposalCommand(env,await admitted(env,ctx,'merch.prepare',true),'merch.prepare',args)}))},
 ]
}
