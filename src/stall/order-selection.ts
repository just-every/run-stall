import { catalogue,decimal } from './pier'
import { fail,integer,text,type Line } from './model'
import type { Bindings } from '../auth.server'

export function selectLines(input:any):{sku:string;quantity:number}[] {
 if(!Array.isArray(input)||!input.length||input.length>50) fail('LINES','Choose between one and 50 products.',400)
 const seen=new Set<string>()
 return input.map((line:any)=>{
  const sku=text(line.sku,'SKU',100),quantity=integer(line.quantity,'Quantity',1,1000)
  if(seen.has(sku)) fail('LINES','Each product may appear only once.',400)
  seen.add(sku);return {sku,quantity}
 }).sort((a,b)=>a.sku.localeCompare(b.sku))
}

/** Both retail doors snapshot the same published prices, stock and shipping. */
export async function priceSelection(env:Bindings,selection:{sku:string;quantity:number}[],expectedTotalCents:unknown) {
 const stock=await catalogue(env)
 const lines:Line[]=selection.map(line=>{
  const product=stock.items.find(item=>item.sku===line.sku)
  if(!product) fail('PRODUCT','A selected product is no longer published.')
  if(BigInt(line.quantity)*1000000n>decimal(product.available)) fail('STOCK','There is not enough available stock. Refresh the shop.')
  integer(product.unitCents,'Product unit cents',1)
  return {...line,itemId:product.itemId,name:product.name,description:product.description,unitCents:product.unitCents}
 })
 const shippingCents=stock.shippingCents,totalCents=lines.reduce((sum,line)=>sum+line.quantity*line.unitCents,0)+shippingCents
 integer(totalCents,'Order total cents',50,99999999)
 if(expectedTotalCents!==undefined&&integer(expectedTotalCents,'Reviewed total cents',50,99999999)!==totalCents) fail('PRICE_CHANGED','A product price or shipping charge changed. Refresh the shop and review the total before paying.')
 return {lines,shippingCents,totalCents}
}
