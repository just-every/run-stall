import { useEffect, useRef, useState } from 'react'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'

type Input = { lines: { sku: string; quantity: number; personalization?: Record<string, string> }[]; customerEmail: string; shipping?: { service: string; postalCode?: string; quote: string }; subtotal: number; shippingCents: number }
type Quote = { applicable: boolean; message: string; discountCents: number; totalCents: number;promotion?:{kind:string};lineDiscounts?:{sku:string;discountCents:number}[];explanations?:{id:string;applied:boolean;reason:string}[] }
export function usePromotionCode(input: Input) {
  const [code, setCode] = useState(''), [result, setResult] = useState<{ key: string; quote?: Quote; error?: string }>(), [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const invalidate = () => { generation.current++; setResult(undefined) }
  const key = JSON.stringify({ ...input, code: code.trim() }), current = result?.key === key ? result : undefined
  const applied = current?.quote?.applicable ? current.quote : undefined
  useEffect(()=>{invalidate();if(!code.trim()&&input.lines.length&&input.customerEmail&&input.shipping)void apply()}, [key])
  async function apply() {
    if (!input.lines.length || !input.customerEmail || !input.shipping) return
    const attempt = ++generation.current
    setLoading(true); setResult(undefined)
    try {
      const quote = await request<Quote>('/api/stall/promotions/quote', { lines: input.lines, customerEmail: input.customerEmail, shipping: input.shipping, ...(code.trim()?{promotionCode:code.trim()}:{}) })
      if (quote.totalCents + quote.discountCents !== input.subtotal + input.shippingCents) throw new Error('Prices changed. Refresh availability and review your order again.')
      if (generation.current === attempt) setResult({ key, quote })
    } catch (error) { if (generation.current === attempt) setResult({ key, error: errorMessage(error) }) }
    finally { setLoading(false) }
  }
  return { code, setCode, current, applied, loading, apply, ready: !!input.lines.length && !!input.customerEmail && !!input.shipping, blocked: (!!code.trim() && !applied)||(!code.trim()&&!!input.lines.length&&!!input.customerEmail&&!!input.shipping&&(!current||loading)) }
}
export function PromotionCode({ state, busy, changed }: { state: ReturnType<typeof usePromotionCode>; busy: boolean; changed: () => void }) {
  return <div className="st-stack" aria-label="Promotion code">
    <label>Promotion code<input maxLength={320} autoComplete="off" value={state.code} disabled={busy} onChange={event => { changed(); state.setCode(event.target.value) }} /></label>
    <div className="st-actions"><button type="button" className="st-secondary" disabled={busy || state.loading || !state.code.trim() || !state.ready} onClick={() => { changed(); void state.apply() }}>{state.loading ? 'Checking code…' : 'Apply code'}</button>{state.code && <button type="button" className="st-link" disabled={busy} onClick={() => { changed(); state.setCode('') }}>Remove code</button>}</div>
    {state.current?.quote && <Notice error={!state.current.quote.applicable}>{state.current.quote.message}</Notice>}
    {state.current?.error && <Notice error>{state.current.error}</Notice>}
    {state.code.trim() && !state.current && !state.loading && <p className="st-small" role="status">Enter your email, choose shipping and check this code before reviewing the order.</p>}
    {state.applied?.lineDiscounts?.filter(l=>l.discountCents>0).map(l=><div className="st-row" key={l.sku}><span>{l.sku} discount</span><strong>−{money(l.discountCents)}</strong></div>)}
    {state.current?.quote?.explanations?.filter(e=>!e.applied).map(e=><p key={e.id}>Automatic promotion not applied: {e.reason.toLowerCase().replaceAll('_',' ')}.</p>)}
    {state.applied && <div className="st-row"><span>{state.applied.promotion?.kind==='free_shipping'?'Promotion · free shipping':'Promotion discounts'}</span><strong>−{money(state.applied.discountCents)}</strong></div>}
  </div>
}
