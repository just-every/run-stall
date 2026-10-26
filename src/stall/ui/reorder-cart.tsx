import { useEffect,useState } from 'react'
import { money,request,errorMessage } from './api'
import { Notice,Section } from './primitives'
import { CheckoutAnswers,useCheckoutAnswers } from './checkout-answers'
import { ShippingChoice,useShippingQuote } from './shipping-options'
import { AddressFields,blankAddress } from './address-book'
import type { Address,Cart,ReorderNotice } from './customer-types'
type Review={reviewToken:string;review:{lines:{sku:string;name:string;quantity:number;unitCents:number}[];shippingCents:number;taxCents:number;taxStatus:string;totalCents:number}}
export function ReorderCart({initial,close}:{initial:Cart;close:()=>void}) {
 const [cart,setCart]=useState(initial),[address,setAddress]=useState<Address>(initial.value.shopper?.address??blankAddress),[review,setReview]=useState<Review>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const questions=useCheckoutAnswers(),delivery=useShippingQuote(cart.value.lines,address.postal_code)
 useEffect(()=>setReview(undefined),[delivery.chosen?.quote])
 const notice:ReorderNotice|undefined=initial.value.reorder
 async function quote(){
  if(!questions.definition||!delivery.chosen)return
  setBusy(true);setError('')
  try {
   const shopper={address,answers:questions.answers,fieldsRevision:questions.definition.revision,note:questions.note,giftMessage:questions.giftMessage,giftReceipt:questions.giftReceipt}
   const saved=await request<{cart:Cart}>('/api/stall/cart',{cartId:cart.id,revision:cart.revision,lines:cart.value.lines,customerEmail:cart.value.customerEmail,shopper,shipping:{service:delivery.chosen.code,quote:delivery.chosen.quote,postalCode:address.postal_code}})
   setCart(saved.cart)
   setReview(await request<Review>('/api/stall/cart/review',{cartId:saved.cart.id,revision:saved.cart.revision}))
  }catch(error){setReview(undefined);setError(errorMessage(error))}finally{setBusy(false)}
 }
 async function pay(){if(!review||busy)return;setBusy(true);setError('');try{const result=await request<{url:string}>('/api/stall/cart/checkout',{cartId:cart.id,revision:cart.revision,reviewToken:review.reviewToken});const url=new URL(result.url,location.origin);if(!(url.protocol==='https:'&&url.hostname==='checkout.stripe.com')&&!(url.origin===location.origin&&url.pathname==='/order'))throw Error('Payment could not open. Contact the shop.');location.assign(url.href)}catch(error){setReview(undefined);setError(errorMessage(error));setBusy(false)}}
 return <Section title="Review your reorder"><p>Current prices and availability apply. Review delivery and the full total before payment.</p>{error&&<Notice error>{error}</Notice>}{!!notice?.priceChanges.length&&<Notice><strong>Prices changed</strong><ul>{notice.priceChanges.map(line=><li key={line.sku}>{line.sku}: {money(line.previousUnitCents)} → {money(line.currentUnitCents)} each</li>)}</ul></Notice>}{!!notice?.omissions.length&&<Notice><strong>Items left out</strong><ul>{notice.omissions.map(line=><li key={line.sku}>{line.sku}: {line.reason}</li>)}</ul></Notice>}<ul className="st-lines">{cart.value.lines.map(line=><li key={line.sku}><span>{line.sku} × {line.quantity}{Object.entries(line.personalization??{}).map(([key,value])=><span className="st-line-detail" key={key}>{key}: {value}</span>)}</span></li>)}</ul>{!cart.value.lines.length?<Notice>No items can be reordered. <a href="/shop">Choose products in the shop</a>.</Notice>:<><details open={!address.line1}><summary>Delivery address</summary><div className="st-stack"><AddressFields value={address} disabled={busy} change={value=>{setAddress(value);setReview(undefined)}}/></div></details><ShippingChoice state={delivery} zip={address.postal_code} setZip={postal_code=>{setAddress({...address,postal_code});setReview(undefined)}} busy={busy}/><CheckoutAnswers state={questions} disabled={busy} changed={()=>setReview(undefined)}/>{review&&<div className="st-stack" aria-label="Current order totals"><ul className="st-lines">{review.review.lines.map(line=><li key={line.sku}><span>{line.name} × {line.quantity}</span><strong>{money(line.unitCents*line.quantity)}</strong></li>)}</ul><div className="st-row"><span>Shipping</span><strong>{money(review.review.shippingCents)}</strong></div><div className="st-row"><span>Tax · {review.review.taxStatus==='no_tax_recorded'?'no tax recorded':'calculated'}</span><strong>{money(review.review.taxCents)}</strong></div><div className="st-total"><span>Total · USD</span><strong>{money(review.review.totalCents)}</strong></div></div>}<div className="st-actions">{review?<button disabled={busy} onClick={()=>void pay()}>{busy?'Opening payment…':`Pay ${money(review.review.totalCents)} with Stripe`}</button>:<button disabled={busy||cart.locked||!questions.definition||delivery.loading||!delivery.chosen} onClick={()=>void quote()}>{busy?'Checking…':'Review current total'}</button>}</div></>}<button className="st-secondary" disabled={busy} onClick={close}>Back to order history</button></Section>
}
