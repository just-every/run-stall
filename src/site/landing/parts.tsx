// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/sections/*.css), never screenshots. The
// only raster images are the painted hero, interlude and closing, and the
// three mug photos inside the shop's own cards.
import type { ReactNode } from 'react'
import { Dot } from '../shell/Actions'
import { SEP, type Glaze } from './kiln'

/** A section's words: the day-and-time eyebrow, the heading with its tangerine full stop, and the line under it. A
 * left-aligned eyebrow wraps between its parts; a centred one is short and set as one run. */
export function Heading({ id, eyebrow, title, children, className = '' }: { id: string; eyebrow: string; title: ReactNode; children?: ReactNode; className?: string }) {
  const centred = className.split(' ').includes('centred')
  return <div className={`heading ${className}`.trim()}>
    <p className="eyebrow">{centred ? eyebrow.replaceAll(' · ', SEP) : <Seq parts={eyebrow.split(' · ')} />}</p>
    <h2 id={`${id}-title`}>{title}<Dot /></h2>
    {children ? <p className="lede">{children}</p> : null}
  </div>
}

/** One step of the story: a section labelled by its heading, its content in the centred column. */
export const Section = ({ id, className, children }: { id: string; className: string; children: ReactNode }) =>
  <section id={id} className={`story ${className}`} aria-labelledby={`${id}-title`}><div className="column">{children}</div></section>

/** A drawing of a screen: the summary for screen readers, the drawing itself hidden from them. */
export const Drawing = ({ label, className, children }: { label: string; className: string; children: ReactNode }) =>
  <div className={className} role="img" aria-label={label}><div className="drawing" aria-hidden="true">{children}</div></div>

/** Parts joined by a separator (" · " unless a stylesheet sets another) that wrap only between parts. The separator in
 * front of a part that starts a line is clipped (styles/landing.css .seq), so no line starts or ends with one. Text is
 * split at SEP; `parts` takes styled pieces. */
export const Seq = ({ text = '', parts = text.split(SEP), className = '' }: { text?: string; parts?: ReactNode[]; className?: string }) =>
  <span className={`seq ${className}`.trim()}><span className="seq-in">{parts.map((part, i) => <span key={i}>{part}</span>)}</span></span>

/** A painted band: AVIF, then WebP, at the widths public/site holds. */
export function Painting({ name, widths, sizes, eager = false }: { name: string; widths: number[]; sizes: string; eager?: boolean }) {
  const set = (ext: string) => widths.map(w => `/site/${name}-${w}.${ext} ${w}w`).join(', ')
  return <picture>
    <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
    <img src={`/site/${name}-${widths.includes(1536) ? 1536 : Math.max(...widths)}.webp`} srcSet={set('webp')} sizes={sizes} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

/** A mug's one photo, the same on every screen. */
export const Mug = ({ glaze, className = '' }: { glaze: Glaze; className?: string }) => <picture className={`mug ${className} ${glaze}`}>
  <source type="image/avif" srcSet={`/site/mug-${glaze}.avif`} />
  <img src={`/site/mug-${glaze}.webp`} alt="" width="252" height="252" loading="lazy" decoding="async" />
</picture>

export const Tick = ({ className = 'tick' }: { className?: string }) => <svg className={className} viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8" /></svg>
/** A filled round mark: tangerine tick, red alert or green tick. */
export const Mark = ({ kind }: { kind: 'done' | 'alert' | 'ok' }) => <svg className={`mark ${kind}`} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" />{kind === 'alert' ? <path d="M12 6.5v7M12 17.2v.1" /> : <path d="m7.2 12.4 3.2 3.2 6.4-6.8" />}</svg>
export const Clock = () => <svg className="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" /><path d="M12 7v5.2l3.4 2" /></svg>
export const Lock = () => <svg className="lock" viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7.5" rx="1.6" /><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" /></svg>
export const Lights = () => <span className="lights"><i /><i /><i /></span>
