import { Tick } from '../parts'
import { order, rates, taxStates, taxTotal, usd } from '../sample'

// A Code 128-like run of bars from the tracking number's digits: the same
// number always draws the same label.
function Barcode({ digits }: { digits: string }) {
  const widths = [...digits.replace(/\D/g, '')].flatMap((digit, i) => { const n = Number(digit); return [1 + (n % 3), 1 + ((n + i) % 2), 1 + ((n * 7 + i) % 4), 1 + (i % 2)] })
  let x = 0
  const bars = widths.map((width, i) => { const bar = i % 2 === 0 ? <rect key={i} x={x} width={width} height="40" /> : null; x += width; return bar })
  return <svg className="barcode" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none">{bars}</svg>
}

/** The shipping label printed from the order, the live rates and the tracking email. */
export function LabelCard() {
  return <div className="card label">
    <span className="label-corner" />
    <p className="label-head"><b>{order.carrier}</b> · <span className="mono-num">{order.tracking}</span></p>
    <Barcode digits={order.tracking} />
    <ul className="rates">
      {rates.map((rate, i) => <li key={rate.carrier} className={i === 0 ? 'on' : undefined}><i className="radio" /><span>{rate.carrier}</span><b>{usd(rate.cents)}</b>{i === 0 ? <Tick /> : <span className="tick-space" />}</li>)}
    </ul>
    <span className="chip">Tracking email sent <Tick /></span>
  </div>
}

/** October's sales tax by state, ready to file. */
export function TaxCard() {
  return <div className="card tax">
    <p className="tax-head"><b>October</b> · collected</p>
    <ul className="tax-rows">{taxStates.map(row => <li key={row.state}><span>{row.state} · {row.rate}</span><span>{usd(row.cents)}</span></li>)}</ul>
    <p className="tax-total"><b>{taxTotal}</b><span className="chip">Ready to file</span></p>
  </div>
}
