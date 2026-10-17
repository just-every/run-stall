import { links } from './links'

export const Arrow = () => <svg className="arrow" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 11h14.5M12.5 5.5 18 11l-5.5 5.5" /></svg>

/** The page's one action, Run Stall (the tangerine pill), then the demo and the docs as underlined links. */
export function Actions({ demo = true }: { demo?: boolean }) {
  return <div className="site-actions">
    <a className="site-pill" href={links.run}>Run Stall<Arrow /></a>
    {demo && <a className="site-link" href={links.demo}>Try the demo</a>}
    <a className="site-link" href={links.docs}>Read the docs</a>
  </div>
}

/** A heading's full stop, drawn as the round tangerine dot (the period stays in the text). */
export const Dot = () => <span className="dot">.</span>
