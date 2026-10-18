import { Dot } from '../../shell/Actions'
import { links } from '../../shell/links'
import '../../styles/sections/limits.css'

/** 11 · Honest limits: one slim strip in Stall's own voice, the parcel-and-bow icon, and the contract's boundaries. */
export function Limits() {
  return <section id="limits" className="limits" aria-labelledby="limits-title">
    <div className="column">
      <div className="card limit">
        <span className="limit-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="8" y="17" width="32" height="24" rx="2.5" /><path d="M8 26.5h32M24 17v24M24 17c-2.4-5.6-8.6-7.4-9.4-3.6-.7 3.3 5 3.6 9.4 3.6 4.4 0 10.1-.3 9.4-3.6-.8-3.8-7-2-9.4 3.6z" /></svg></span>
        <div className="limit-copy">
          <h2 id="limits-title">Not behind this counter<Dot /></h2>
          <p>No warehouse purchasing, live chat or Etsy listings.</p>
        </div>
        <a className="site-link limit-link" href={links.limits}>Read the limits<span aria-hidden="true">{'\u00a0→'}</span></a>
      </div>
    </div>
  </section>
}
