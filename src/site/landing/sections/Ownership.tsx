import { Fragment } from 'react'
import { Dot } from '../../shell/Actions'
import { links } from '../../shell/links'
import run from '../../run.json'
import { Icon } from '../parts'

/** Desk page 7: ownership. The terminal shows the one line that clones, installs and starts Stall. */
export function Ownership() {
  return <section id="ownership" className="ownership site-wrap" aria-labelledby="ownership-title">
    <div className="feature-copy">
      <p className="eyebrow">Ownership</p>
      <h2 id="ownership-title">Yours, start to finish<Dot /></h2>
      <p className="feature-body"><a href={links.run}>Run Stall</a> on your own computer or server. Your shop, your customers, your data.</p>
      <ul className="owned">
        <li><Icon name="shop" />Your own shop</li>
        <li><Icon name="user" />Your own customers</li>
        <li><Icon name="export" />Export any time</li>
      </ul>
    </div>
    <div className="terminal-wrap">
      <figure className="terminal" aria-label="Start Stall with one line">
        <span className="lights" aria-hidden="true"><i /><i /><i /></span>
        <pre><code><span className="prompt" aria-hidden="true">$ </span>{run.clone.split(' ').map((word, i) => <Fragment key={i}>{i ? ' ' : ''}<span className="nowrap">{word}</span></Fragment>)}{'\n'}<span className="comment"># clones, installs and starts Stall on your computer</span></code></pre>
      </figure>
      <svg className="sold" viewBox="0 0 210 170" aria-hidden="true">
        <path className="string" d="M196 6c-14 10-16 22-30 30-10 6-22 4-30 14" />
        <g transform="rotate(-24 104 104)"><path className="tag" d="M44 70h108l26 34-26 34H44a10 10 0 0 1-10-10V80a10 10 0 0 1 10-10z" /><circle className="eyelet" cx="160" cy="104" r="7" /><text x="96" y="115" className="tag-text">SOLD</text></g>
      </svg>
    </div>
  </section>
}
