import { useEffect, useState } from 'react'
import { errorMessage, money, request } from './api'

export interface QuoteService { code: string; name: string; kind: 'ship' | 'pickup' | 'delivery'; cents: number; quote: string; detail?: string }
export interface ShippingQuote { postalCode?: string; services: QuoteService[]; notes: string[]; unserved: { sku: string; name: string; profile: string }[]; needsPostalCode: boolean }
type QuoteLine = { sku: string; quantity: number; personalization?: Record<string, string> }
export const zipOf = (value: string) => /^\d{5}(-\d{4})?$/.test(value.trim()) ? value.trim().slice(0, 5) : undefined
/** The shop's shipping options for a basket and ZIP code. A single unambiguous service needs no choice. */
export function useShippingQuote(lines: QuoteLine[], zip: string) {
  const [quote, setQuote] = useState<ShippingQuote | null>(null), [picked, setPicked] = useState(''), [problem, setProblem] = useState(''), [loading, setLoading] = useState(false)
  const key = JSON.stringify(lines) + '|' + (zipOf(zip) ?? '')
  useEffect(() => {
    setQuote(null); setProblem('')
    if (!lines.length) return
    let current = true
    setLoading(true)
    request<ShippingQuote>('/api/stall/shipping/quote', { lines, ...(zipOf(zip) ? { postalCode: zipOf(zip) } : {}) })
      .then(result => { if (current) setQuote(result) }).catch(error => { if (current) setProblem(errorMessage(error)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [key])
  // One shipped service with nothing to ask needs no choice; pickup and delivery are always chosen by the shopper.
  const unasked = !!quote && quote.services.length === 1 && quote.services[0].kind === 'ship' && !quote.needsPostalCode
  const chosen = quote?.services.find(service => service.code === picked) ?? (unasked ? quote!.services[0] : undefined)
  return { quote, chosen, picked, setPicked, problem, loading, unasked }
}
export function ShippingChoice({ state, zip, setZip, busy }: { state: ReturnType<typeof useShippingQuote>; zip: string; setZip: (value: string) => void; busy: boolean }) {
  const { quote, chosen, setPicked, problem, loading, unasked } = state
  return <div className="st-stack" role="group" aria-label="Shipping options">
    {(quote?.needsPostalCode || zip) && <label>ZIP code for shipping options<input inputMode="numeric" autoComplete="postal-code" maxLength={10} value={zip} disabled={busy} onChange={event => setZip(event.target.value)} /></label>}
    {zip && !zipOf(zip) && <p className="st-small" role="status">Enter a five-digit US ZIP code.</p>}
    {loading && <p role="status" className="st-small">Checking shipping options…</p>}
    {problem && <div className="st-notice st-error" role="alert">{problem}</div>}
    {quote?.notes.map(note => <div className="st-notice" role="status" key={note}>{note}</div>)}
    {!!quote?.unserved.length && <ul className="st-small">{quote.unserved.map(line => <li key={line.sku}>{line.name} is not served at this ZIP code ({line.profile}).</li>)}</ul>}
    {quote && !unasked && !!quote.services.length && <fieldset className="st-stack" disabled={busy}><legend>Delivery option</legend>
      {quote.services.map(service => <label className="st-checkbox" key={service.code}><input type="radio" name="shipping-service" checked={chosen?.code === service.code} onChange={() => setPicked(service.code)} />{service.name} · {money(service.cents)}{service.detail && <small> {service.detail}</small>}</label>)}</fieldset>}
  </div>
}
