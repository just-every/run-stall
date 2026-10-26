import { useEffect,useState } from 'react'
import { request,errorMessage,money } from './api'
import { Chrome,Notice,Section } from './primitives'
import { ReorderCart } from './reorder-cart'
import type { Cart } from './customer-types'
/** Checkout links use the existing native cart and review controls. */
export function BuyLink({id,close}:{id:string;close:()=>void}) {
 const [preview,setPreview]=useState<{label:string;lines:{sku:string;name:string;quantity:number;unitCents:number}[];promotionCode:string|null}>(),[cart,setCart]=useState<Cart>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const params=typeof location==='undefined'?'':new URLSearchParams([...new URL(location.href).searchParams].filter(([key])=>['sku','quantity'].includes(key))).toString(),suffix=params?'?'+params:''
 useEffect(()=>{setPreview(undefined);setCart(undefined);setError('');void request<typeof preview>('/api/stall/buy-links/'+encodeURIComponent(id)+suffix).then(setPreview).catch(error=>setError(errorMessage(error)))},[id,suffix])
 async function start(){setBusy(true);setError('');try{setCart((await request<{cart:Cart}>('/api/stall/buy-links/'+encodeURIComponent(id)+'/cart'+suffix,{})).cart)}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
 return <div className="st-app st-store"><Chrome/><main id="main" className="st-store-main">{error&&<Notice error>{error}</Notice>}{cart?<ReorderCart initial={cart} checkoutLink close={close}/>:<Section title={preview?.label??'Checkout link'}>{preview&&<><ul className="st-lines">{preview.lines.map(line=><li key={line.sku}><span>{line.name} × {line.quantity}</span><strong>{money(line.unitCents*line.quantity)}</strong></li>)}</ul>{preview.promotionCode&&<p>Promotion code: {preview.promotionCode}</p>}<p>Review delivery, any eligible discount and the full total in Stall before payment.</p><button disabled={busy} onClick={()=>void start()}>{busy?'Opening cart…':'Continue to native cart'}</button></>}<button className="st-secondary" disabled={busy} onClick={close}>Back to shop</button></Section>}</main></div>
}
