/** First-party events contain no mailbox, address or payment fields. */
export async function recordAnalytics(kind:'visit'|'product_view'|'add_to_cart'|'checkout',sku?:string) {
 if(typeof window==='undefined'||!location.pathname.startsWith('/shop'))return
 try {
  const response=await fetch('/api/stall/analytics/events',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),kind,path:location.pathname+location.search,referrer:document.referrer,...(sku?{sku}:{})})})
  return response.ok
 } catch { return false }
}
