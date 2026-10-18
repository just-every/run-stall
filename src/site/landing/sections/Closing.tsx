import { Actions, Dot } from '../../shell/Actions'
import { Painting } from '../parts'
import { theoOrder, reship } from '../kiln'

// A Code 128-like run of bars from the order number: the same number always draws the same barcode.
function Barcode({ code }: { code: string }) {
  const digits = [...code.replace(/\D/g, '').repeat(4)].map(Number)
  let x = 0
  const bars = digits.flatMap((n, i) => { const w = 1 + (n % 3), gap = 1 + ((n + i) % 2), bar = <rect key={i} x={x} width={w} height="26" />; x += w + gap; return [bar] })
  return <svg className="barcode" viewBox={`0 0 ${x} 26`} preserveAspectRatio="none">{bars}</svg>
}

/** 12 · The closing: Theo's replacement parcel on a sunny doorstep, its printed label set as live text on the
 * plate's blank label, under the last promise. The plate never shrinks below its own size, so the label stays
 * legible: narrower screens crop its sides around the parcel. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="closing-art">
      <div className="closing-plate">
        <Painting name="closing" widths={[1536, 2304, 3072]} sizes="max(100vw, 1536px)" />
        <div className="parcel-label" aria-hidden="true">
          <p className="service">USPS Ground Advantage</p>
          <p>{theoOrder.name}</p>
          <p>{theoOrder.city}</p>
          <p>#{reship.order}</p>
          <Barcode code={reship.order} />
        </div>
      </div>
    </div>
    <div className="closing-copy site-wrap">
      <h2 id="closing-title">Leave the lights on<Dot /></h2>
      <p className="closing-sub">Open source online shops for makers.</p>
      <Actions demo={false} />
      <p className="hero-note">Free and open source, MIT licensed.</p>
    </div>
  </section>
}
