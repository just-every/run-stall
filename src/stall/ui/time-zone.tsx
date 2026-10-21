import { useEffect, useState } from 'react'
import type { Run } from './types'
import { Section } from './primitives'

export function ShopTimeZone({ timeZone, busy, run }: { timeZone: string; busy: boolean; run: Run }) {
  const [value, setValue] = useState(timeZone), [zones, setZones] = useState<string[]>([])
  useEffect(() => setValue(timeZone), [timeZone])
  useEffect(() => { if (typeof Intl.supportedValuesOf === 'function') setZones(Intl.supportedValuesOf('timeZone')) }, [])
  return <Section title="Shop time zone"><form className="st-stack" aria-label="Shop time zone" onSubmit={event => {
    event.preventDefault()
    void run('shop.configure', { timeZone: value.trim() })
  }}>
    <p>Choose the IANA time zone used for shop timestamps.</p>
    <label>Time zone<input name="timeZone" list="shop-time-zones" required maxLength={100} value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="America/Chicago" /></label>
    <datalist id="shop-time-zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
    <div className="st-actions"><button disabled={busy || !value.trim()}>Save time zone</button></div>
  </form></Section>
}
