import { Actions, Dot } from '../../shell/Actions'
import { Painting } from '../parts'
import { theoOrder, reship } from '../kiln'

// A fine Code 128-like run of 46 bars from the order number, thin guard bars at each end: the same number always
// draws the same barcode.
function Barcode({ code }: { code: string }) {
  const seed = [...code.replace(/\D/g, '')].map(Number)
  const widths = [1, 1, ...Array.from({ length: 42 }, (_, i) => [1, 1.6, 2.4, 1][(seed[i % seed.length] + i * 7) % 4]), 1, 1]
  let x = 0
  const bars = widths.map((w, i) => { const bar = <rect key={i} x={x} width={w} height="26" />; x += w + [1.4, 1, 2, 1.2][(i * 3 + seed[i % seed.length]) % 4]; return bar })
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
