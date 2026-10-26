import { CustomerBalances } from './customer-balances'
import { CustomerRegistrationForm } from './customer-registration'
import { useEffect,useState } from 'react'
import { request,errorMessage,money } from './api'
import { Notice,Section } from './primitives'
import { AddressBook } from './address-book'
import { ReorderCart } from './reorder-cart'
import type { AccountData,Cart,OwnOrder } from './customer-types'
const status=(value:string)=>value.replaceAll('_',' ')
export function CustomerAccount() {
 const [account,setAccount]=useState<AccountData>(),[guest,setGuest]=useState<{order:OwnOrder;expiresAt:string}>(),[token,setToken]=useState(''),[cart,setCart]=useState<Cart>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[link,setLink]=useState('')
 useEffect(()=>{
  let generation=0
  const load=()=>{
   const current=++generation
   setAccount(undefined);setGuest(undefined);setCart(undefined);setToken('');setError('');setLoading(true)
   const saved=new URLSearchParams(location.search).get('cartId'),capability=new URLSearchParams(location.hash.slice(1)).get('orderLink')
   let pending:Promise<void>
   if(saved)pending=request<{cart:Cart}>('/api/stall/cart?cartId='+encodeURIComponent(saved)).then(data=>{if(current===generation)setCart(data.cart)})
   else if(capability){
    setToken(capability);history.replaceState(null,'',location.pathname+location.search)
    pending=fetch('/api/stall/guest-order',{headers:{'X-Stall-Order-Token':capability},cache:'no-store'}).then(async response=>{
     const data=await response.json() as {order:OwnOrder;expiresAt:string;error?:{message?:string}}
     if(!response.ok)throw Error(data.error?.message??'This order link is unavailable or expired.')
     if(current===generation)setGuest(data)
    })
   }else pending=request<AccountData>('/api/stall/account').then(data=>{if(current===generation)setAccount(data)})
   void pending.catch(error=>{if(current===generation)setError(errorMessage(error))}).finally(()=>{if(current===generation)setLoading(false)})
  }
  load();addEventListener('hashchange',load)
  return()=>{generation++;removeEventListener('hashchange',load)}
 },[])
 async function reorder(orderId:string){setBusy(true);setError('');setLink('');try{const result=await request<{cart:Cart}>('/api/stall/cart/reorder',{orderId,...(token?{guestToken:token}:{})});setCart(result.cart);history.replaceState(null,'','/order?cartId='+encodeURIComponent(result.cart.id))}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
 async function guestLink(orderId:string){setBusy(true);setError('');try{const result=await request<{token:string;expiresAt:string}>('/api/stall/account/guest-order-link',{orderId});setLink(`${location.origin}/order#orderLink=${encodeURIComponent(result.token)}`)}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
 async function revoke(orderId:string){setBusy(true);setError('');try{await request('/api/stall/account/guest-order-link',{orderId},'DELETE');setLink('')}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
 const orders=guest?[guest.order]:account?.orders??[]
 if(cart)return <ReorderCart key={cart.id} initial={cart} close={()=>{setCart(undefined);history.replaceState(null,'','/order'+(token?'#orderLink='+encodeURIComponent(token):''));location.reload()}}/>
 return <><Section title={guest?'Your guest order':'Your account'}>{loading&&<p role="status">Loading your orders…</p>}{error&&<Notice error>{error}{!token&&<> <a href="/signin?returnTo=%2Forder">Sign in or recover access</a></>}</Notice>}{account&&<p>{account.email} · <a href="/auth/settings/identity">Sign-in settings</a></p>}{guest&&<p>This private link opens only this order. It expires {new Date(guest.expiresAt).toLocaleString()}.</p>}{!loading&&!account&&!guest&&!token&&<p>Use the verified email on your orders, or request an account below.</p>}{(account||guest)&&<><h3>Order history</h3>{!orders.length&&<p>No orders are recorded for this verified email.</p>}{orders.map(order=><article key={order.id} className="st-stack st-account-order" aria-label={`Order ${order.id}`}><div className="st-row"><div><h3>{order.imported?'Imported order '+order.source?.recordId:'Order '+order.id.slice(0,8)}</h3><p><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time> · {status(order.status)}</p></div><strong>{money(order.totalCents)}</strong></div><ul className="st-lines">{order.lines.map(line=><li key={line.sku}><span>{line.name} × {line.quantity}</span><strong>{money(line.unitCents*line.quantity)}</strong></li>)}</ul><div className="st-actions"><button disabled={busy} onClick={()=>void reorder(order.id)}>{busy?'Preparing…':'Reorder'}<span className="st-sr-only"> order {order.id.slice(0,8)}</span></button>{account&&!order.imported&&<button className="st-secondary" disabled={busy} onClick={()=>void guestLink(order.id)}>Create guest order link<span className="st-sr-only"> for {order.id.slice(0,8)}</span></button>}{account&&!order.imported&&<button className="st-secondary" disabled={busy} onClick={()=>void revoke(order.id)}>Revoke guest links<span className="st-sr-only"> for {order.id.slice(0,8)}</span></button>}</div><details><summary>Delivery, refunds and requests</summary>{order.shippingDetails&&<address>{order.shippingDetails.name}<br/>{order.shippingDetails.address.line1}<br/>{order.shippingDetails.address.city}, {order.shippingDetails.address.state} {order.shippingDetails.address.postal_code}</address>}{order.shipment?<><p>Shipment: {status(order.shipment.status)}</p>{order.shipment.dispatches?.map((dispatch,i)=><p key={i}>{dispatch.deliveryStatus&&status(dispatch.deliveryStatus)} {dispatch.tracking?.map((tracking,j)=><span key={j}> {tracking.trackingCode&&<>Tracking: {tracking.trackingCode}</>}{tracking.trackingUrl&&/^https:\/\//.test(tracking.trackingUrl)&&<> · <a href={tracking.trackingUrl} rel="noreferrer" target="_blank">Track shipment</a></>}</span>)}</p>)}</>:<p>No shipment recorded.</p>}{order.refunds.length?<ul>{order.refunds.map(refund=><li key={refund.id}>{money(refund.amountCents)} · {status(refund.status)}</li>)}</ul>:<p>No refunds recorded.</p>}{account?.requests.filter(item=>item.orderId===order.id).map(item=><p key={item.id}>{status(item.kind)} request received {new Date(item.createdAt).toLocaleString()} · {item.goodsReceivedAt?'Goods received '+new Date(item.goodsReceivedAt).toLocaleString():'Awaiting staff review'}</p>)}</details></article>)}</>}{link&&<Notice><label>Private guest order link<input readOnly value={link} onFocus={event=>event.target.select()}/></label><p>Anyone with this link can view and reorder this order until it expires.</p><a href={link}>Open guest order link</a></Notice>}</Section>{!loading&&!account&&!guest&&!token&&<CustomerRegistrationForm/>}{account&&<><AddressBook account={account} updated={setAccount}/><CustomerBalances/></>}</>
}
