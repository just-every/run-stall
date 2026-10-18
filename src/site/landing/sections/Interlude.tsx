import { Painting } from '../parts'
import { overnight, usd } from '../kiln'

/** 06 · The interlude: the tangerine counter after the drop, the card reader showing the last payment. The badge
 * and the reader's words are live text over a clean plate; the reader's text sits on its screen's perspective. */
export function Interlude() {
  return <section className="interlude" aria-label={`${overnight.orders} orders while you slept`}>
    <div className="interlude-art">
      <Painting name="interlude" widths={[1152, 1536, 2304, 3072]} sizes="max(100vw, 870px)" />
      <svg className="reader" viewBox="0 70 1536 884" aria-hidden="true">
        <g transform="matrix(0.9994 0.0299 -0.0450 0.9944 280.1 319.5)"><circle cx="21" cy="21" r="20" className="reader-dot" /><path d="m12.5 21.5 5.8 5.6 11-11.2" className="reader-tick" /></g>
        <text transform="matrix(0.9883 0.0404 -0.0371 0.9691 208.9 356.4)" x="80" y="23" className="reader-paid">Paid {usd(overnight.total)}</text>
      </svg>
      <p className="badge"><i aria-hidden="true" />{overnight.orders} orders while you slept</p>
    </div>
  </section>
}
