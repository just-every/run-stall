import { Actions, Dot } from '../../shell/Actions'
import { Painting } from '../parts'

/** Desk page 9: the parcel on a sunny doorstep under the last promise. The sticker on the parcel carries the
 * final mark, laid on the painted sticker. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="closing-art">
      <Painting name="closing" widths={[768, 1152, 1536]} sizes="100vw" />
      <svg className="sticker" viewBox="0 0 1536 916" aria-hidden="true">
        <g transform="rotate(2 966 710)"><image href="/brand/mark.svg" x="944" y="676" width="44" height="45" /><text x="966" y="740" className="sticker-word">Stall</text></g>
      </svg>
    </div>
    <div className="closing-copy site-wrap">
      <h2 id="closing-title">Leave the lights on<Dot /></h2>
      <p className="closing-sub">Open source online shops for makers.</p>
      <Actions demo={false} />
      <p className="hero-note">Free and open source, MIT licensed.</p>
    </div>
  </section>
}
