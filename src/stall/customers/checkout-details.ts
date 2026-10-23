import type { Bindings } from '../../auth.server'
import { audit,changed,commit } from '../access'
import { fail,requirePerson,text,type Actor } from '../model'
import { addressValue } from './account'
export type CheckoutField={key:string;label:string;type:'text'|'choice'|'date';required:boolean;choices?:string[]}
export type ShopperDetails={note?:string;giftMessage?:string;giftReceipt?:boolean;address?:ReturnType<typeof addressValue>;answers:Record<string,string>;fieldLabels:Record<string,string>;fieldsRevision:string}
export async function checkoutFields(db:D1Database):Promise<{revision:string;fields:CheckoutField[]}> {const row=await db.prepare('SELECT revision,value_json FROM st_checkout_fields WHERE id=1').first<any>();return row?{revision:row.revision,fields:JSON.parse(row.value_json)}:{revision:'initial',fields:[]}}
export async function fieldSave(env:Bindings,a:Actor,p:any) {
 requirePerson(a);if(!['owner','admin'].includes(a.role))fail('FORBIDDEN','Only an owner or administrator may configure checkout fields.',403)
 const old=await checkoutFields(env.DB)
 if(p.revision!==old.revision||!Array.isArray(p.fields)||p.fields.length>20)fail('INPUT','Review current checkout fields and use at most 20.',400)
 const keys=new Set<string>(),fields:CheckoutField[]=p.fields.map((f:any)=>{
  const key=text(f.key,'Field key',40),label=text(f.label,'Field label',100)
  if(!/^[a-z][a-z0-9_]*$/.test(key)||keys.has(key)||!['text','choice','date'].includes(f.type)||typeof f.required!=='boolean')fail('INPUT','Use distinct lowercase field keys, a supported type and an explicit required choice.',400)
  keys.add(key)
  const choices=f.type==='choice'?(Array.isArray(f.choices)&&f.choices.length>0&&f.choices.length<=50?[...new Set<string>(f.choices.map((v:any)=>text(v,'Choice',100)))]:fail('INPUT','Use 1 to 50 choices.',400)):undefined
  return {key,label,type:f.type,required:f.required,...(choices?{choices}:{})}
 })
 await commit(env.DB,a,[env.DB.prepare('INSERT INTO st_checkout_fields VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value_json=excluded.value_json WHERE st_checkout_fields.revision=?').bind(crypto.randomUUID(),JSON.stringify(fields),old.revision),changed(env.DB),audit(env.DB,a,'checkout-fields','checkout.fields-saved')]);return checkoutFields(env.DB)
}
/** Called by every public Stripe checkout, including the older/headless doors.
 * Required fields cannot be bypassed by omitting the native cart step. */
export async function shopperDetails(db:D1Database,p:any):Promise<ShopperDetails|undefined> {
 const definition=await checkoutFields(db)
 if(p===undefined&&!definition.fields.length)return undefined
 if(p!==undefined&&(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['note','giftMessage','giftReceipt','address','answers','fieldsRevision'].includes(k))))fail('INPUT','Use the supported shopper fields only.',400)
 p??={}
 if(p.fieldsRevision!==undefined&&p.fieldsRevision!==definition.revision)fail('REVIEW_CHANGED','Checkout questions changed. Review them again.')
 const answers=p.answers??{}
 if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).some(k=>!definition.fields.some(f=>f.key===k)))fail('INPUT','Answer only the current checkout questions.',400)
 const values:Record<string,string>={},labels:Record<string,string>={}
 for(const field of definition.fields) {
  const value=answers[field.key]
  if(value===undefined||value==='') {if(field.required)fail('CHECKOUT_FIELD_REQUIRED',`Answer “${field.label}” before continuing.`,400);continue}
  const v=text(value,field.label,field.type==='text'?500:100)
  if(field.type==='choice'&&!field.choices!.includes(v))fail('INPUT',`Choose a current answer for “${field.label}”.`,400)
  if(field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v))fail('INPUT',`Use a valid calendar date for “${field.label}”.`,400)
  values[field.key]=v;labels[field.key]=field.label
 }
 if(p.giftReceipt!==undefined&&typeof p.giftReceipt!=='boolean')fail('INPUT','Choose whether to include a gift receipt.',400)
 return {answers:values,fieldLabels:labels,fieldsRevision:definition.revision,...(p.note?{note:text(p.note,'Order note',2000)}:{}),...(p.giftMessage?{giftMessage:text(p.giftMessage,'Gift message',1000)}:{}),...(p.giftReceipt!==undefined?{giftReceipt:p.giftReceipt}:{}),...(p.address?{address:addressValue(p.address)}:{})}
}
export async function fieldReport(db:D1Database,key:string) {
 const found=(await db.prepare(`SELECT id,value_json FROM st_orders WHERE json_extract(value_json,'$.payment') IS NOT NULL AND json_type(value_json,'$.shopper.answers')='object' ORDER BY id`).all<any>()).results
 const groups=new Map<string,{answer:string;orderIds:string[];paidCents:number;refundedCents:number}>()
 for(const row of found) {const o=JSON.parse(row.value_json),answer=o.shopper.answers[key];if(typeof answer!=='string')continue;const value=groups.get(answer)??{answer,orderIds:[],paidCents:0,refundedCents:0};value.orderIds.push(row.id);value.paidCents+=o.totalCents;value.refundedCents+=o.refunds.filter((r:any)=>r.status==='succeeded').reduce((sum:number,r:any)=>sum+r.amountCents,0);groups.set(answer,value)}
 return {field:key,currency:'usd',groups:[...groups.values()].sort((a,b)=>a.answer.localeCompare(b.answer)).map(g=>({...g,orderCount:g.orderIds.length,netCents:g.paidCents-g.refundedCents}))}
}
