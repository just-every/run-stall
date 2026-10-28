import { useEffect, useRef, useState } from 'react'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'

type Input = { lines: { sku: string; quantity: number; personalization?: Record<string, string> }[]; customerEmail: string; shipping?: { service: string; postalCode?: string; quote: string }; subtotal: number; shippingCents: number }
type Quote = { applicable: boolean; message: string; discountCents: number; totalCents: number;reason:string;promotion?:{kind:string};messages?:{id:string;reason:string;message:string}[] }
export function usePromotionCode(input: Input) {
  const [code, setCode] = useState(''), [result, setResult] = useState<{ key: string; quote?: Quote; error?: string }>(), [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const invalidate = () => { generation.current++; setResult(undefined) }
  const key = JSON.stringify({ ...input, code: code.trim() }), current = result?.key === key ? result : undefined
  const applied = current?.quote?.applicable ? current.quote : undefined
  const ready=!!input.lines.length&&!!input.customerEmail&&!!input.shipping
  useEffect(()=>{invalidate();if(ready&&!code.trim())void check(false)},[key])
  async function check(explicit=true) {
    if (!ready || (explicit&&!code.trim())) return
    const attempt = ++generation.current
    setLoading(true); setResult(undefined)
    try {
      const quote = await request<Quote>('/api/stall/promotions/quote', { lines: input.lines, customerEmail: input.customerEmail, shipping: input.shipping, ...(code.trim()?{promotionCode:code.trim()}:{}) })
      if (quote.totalCents + quote.discountCents !== input.subtotal + input.shippingCents) throw new Error('Prices changed. Refresh availability and review your order again.')
      if (generation.current === attempt) setResult({ key, quote })
    } catch (error) { if (generation.current === attempt) setResult({ key, error: errorMessage(error) }) }
    finally { setLoading(false) }
  }
  return { code, setCode, current, applied, loading, apply:()=>check(),ready, blocked: code.trim()?!applied:ready&&(!current||!!current.error) }
}
export function PromotionCode({ state, busy, changed }: { state: ReturnType<typeof usePromotionCode>; busy: boolean; changed: () => void }) {
  return <div className="st-stack" aria-label="Promotion code">
    <label>Promotion code<input maxLength={64} autoComplete="off" value={state.code} disabled={busy} onChange={event => { changed(); state.setCode(event.target.value) }} /></label>
    <div className="st-actions"><button type="button" className="st-secondary" disabled={busy || state.loading || !state.code.trim() || !state.ready} onClick={() => { changed(); void state.apply() }}>{state.loading ? 'Checking code…' : 'Apply code'}</button>{state.code && <button type="button" className="st-link" disabled={busy} onClick={() => { changed(); state.setCode('') }}>Remove code</button>}</div>
    {state.current?.quote && (state.current.quote.reason!=='NO_PROMOTION'||state.current.quote.messages?.length) && <Notice error={!state.current.quote.applicable}>{state.current.quote.message}</Notice>}
    {state.applied?.messages?.some(m=>m.reason!=='QUALIFIED')&&<ul>{state.applied.messages.filter(m=>m.reason!=='QUALIFIED').map(m=><li key={m.id}>{m.message}</li>)}</ul>}
    {state.current?.error && <Notice error>{state.current.error}</Notice>}
    {state.code.trim() && !state.current && !state.loading && <p className="st-small" role="status">Enter your email, choose shipping and check this code before reviewing the order.</p>}
    {state.applied && <div className="st-row"><span>{state.applied.promotion?.kind==='free_shipping'?'Promotion · free shipping':'Promotion · merchandise'}</span><strong>−{money(state.applied.discountCents)}</strong></div>}
  </div>
}
