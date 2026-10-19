import { useEffect,useState } from 'react'
import type { Run } from './types'
import { Notice,Section } from './primitives'

// Parse the displayed decimal directly into cents, without rounding floats.
function cents(value:string):number|null {
 if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) return null
 const [whole,fraction='']=value.split('.')
 const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 return amount<=99999999?amount:null
}
export function ShippingCharge({shippingCents,busy,run}:{shippingCents:number;busy:boolean;run:Run}) {
 const [amount,setAmount]=useState((shippingCents/100).toFixed(2)),[error,setError]=useState('')
 useEffect(()=>setAmount((shippingCents/100).toFixed(2)),[shippingCents])
 return <Section title="Shipping charge"><form className="st-stack" aria-label="Shipping charge" onSubmit={event=>{
  event.preventDefault()
  const shippingCents=cents(amount)
  if(shippingCents===null) { setError('Enter a USD amount from 0 to 999999.99, with at most two decimal places.');return }
  setError('');void run('shipping.configure',{shippingCents})
 }}>
  <p>Charge one flat amount for domestic US shipping on new checkouts. Set zero for free shipping. Existing checkouts and orders keep their original charge.</p>
  <label>Domestic shipping · USD<input name="shippingAmount" type="number" min="0" max="999999.99" step="0.01" inputMode="decimal" required value={amount} disabled={busy} onChange={event=>{setAmount(event.target.value);setError('')}} /></label>
  {error && <Notice error>{error}</Notice>}
  <div className="st-actions"><button disabled={busy}>Save shipping charge</button></div>
 </form></Section>
}
