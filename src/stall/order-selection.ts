import { catalogue,decimal } from './pier'
import { fail,integer,text,type Line } from './model'
import { personalize } from './personalization'
import type { Bindings } from '../auth.server'

export type Selected={sku:string;quantity:number;personalization?:Record<string,string>}
export function selectLines(input:any):Selected[] {
 if(!Array.isArray(input)||!input.length||input.length>50) fail('LINES','Choose between one and 50 products.',400)
 const seen=new Set<string>()
 return input.map((line:any)=>{
  const sku=text(line.sku,'SKU',100),quantity=integer(line.quantity,'Quantity',1,1000)
  if(seen.has(sku)) fail('LINES','Each product may appear only once.',400)
  seen.add(sku);return {sku,quantity,...(line.personalization!==undefined?{personalization:line.personalization}:{})}
 }).sort((a,b)=>a.sku.localeCompare(b.sku))
}

/** Both retail doors snapshot the same published prices, stock and shipping. */
export async function priceSelection(env:Bindings,selection:Selected[],expectedTotalCents:unknown) {
 const stock=await catalogue(env)
 const lines:Line[]=[]
 for(const line of selection) {
  const product=stock.items.find(item=>item.sku===line.sku)
  if(!product) fail('PRODUCT','A selected product is no longer published.')
  if(BigInt(line.quantity)*1000000n>decimal(product.available)) fail('STOCK','There is not enough available stock. Refresh the shop.')
  integer(product.unitCents,'Product unit cents',1)
  const personalization=await personalize(env,product.personalization,line.sku,line.personalization),addOnCents=personalization.reduce((sum,answer)=>sum+answer.addOnCents,0)
  lines.push({sku:line.sku,quantity:line.quantity,itemId:product.itemId,name:product.name,description:product.description,unitCents:product.unitCents+addOnCents,...(product.productSku!==line.sku?{productSku:product.productSku}:{}),...(product.variant?{variant:product.variant.options}:{}),...(personalization.length?{personalization,addOnCents}:{})})
 }
 const shippingCents=stock.shippingCents,totalCents=lines.reduce((sum,line)=>sum+line.quantity*line.unitCents,0)+shippingCents
 integer(totalCents,'Order total cents',50,99999999)
 if(expectedTotalCents!==undefined&&integer(expectedTotalCents,'Reviewed total cents',50,99999999)!==totalCents) fail('PRICE_CHANGED','A product price or shipping charge changed. Refresh the shop and review the total before paying.')
 return {lines,shippingCents,totalCents}
}

/** The shopper's pre-basket check: the exact line and add-on price the shop will charge, or the reason it will not. */
export async function validateLine(env:Bindings,p:any) {
 const [selected]=selectLines([{sku:p.sku,quantity:p.quantity??1,personalization:p.personalization}])
 const [line]=(await priceSelection(env,[selected],undefined)).lines
 return {sku:line.sku,name:line.name,quantity:line.quantity,unitCents:line.unitCents,addOnCents:line.addOnCents??0,personalization:(line.personalization??[]).map(({label,value,addOnCents})=>({label,value,addOnCents})),lineTotalCents:line.quantity*line.unitCents}
}
