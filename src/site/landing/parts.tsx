// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/cards.css), never screenshots. The only
// raster images are the three painted bands and the product photos inside the
// shop's own cards.
import type { ReactNode } from 'react'
import { Dot } from '../shell/Actions'

/** One idea: eyebrow, heading with its tangerine full stop and a short paragraph beside its drawing.
 * `flip` puts the drawing first on wide screens. */
export function Feature({ id, eyebrow, title, children, art, label, flip = false }: { id: string; eyebrow: string; title: string; children: ReactNode; art: ReactNode; label: string; flip?: boolean }) {
  return <section id={id} className={`feature${flip ? ' flip' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="feature-copy">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`}>{title}<Dot /></h2>
      <p className="feature-body">{children}</p>
    </div>
    <div className="feature-art" role="img" aria-label={label}><div aria-hidden="true">{art}</div></div>
  </section>
}

/** Two features, the height of one desk page. */
export const Pair = ({ children }: { children: ReactNode }) => <div className="pair site-wrap">{children}</div>

/** A painted band: AVIF, then WebP, at the widths public/site holds. */
export function Painting({ name, widths, sizes, className, eager = false }: { name: string; widths: number[]; sizes: string; className?: string; eager?: boolean }) {
  const set = (ext: string) => widths.map(w => `/site/${name}-${w}.${ext} ${w}w`).join(', ')
  return <picture className={className}>
    <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
    <img src={`/site/${name}-${Math.max(...widths)}.webp`} srcSet={set('webp')} sizes={sizes} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

/** A product photo inside a drawn shop card. */
export const Photo = ({ name, className = 'photo' }: { name: 'mug' | 'bowl' | 'vase' | 'thumb' | 'linen' | 'cart'; className?: string }) => <picture className={className}>
  <source type="image/avif" srcSet={`/site/photo-${name}.avif`} />
  <img src={`/site/photo-${name}.webp`} alt="" loading="lazy" decoding="async" />
</picture>

export const Tick = ({ className = 'tick' }: { className?: string }) => <svg className={className} viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8" /></svg>
export const CheckDot = () => <svg className="check-dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" /></svg>

const PATHS: Record<string, ReactNode> = {
  gift: <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v8.5h14V12M12 8v12.5M12 8C10.5 4 7 4 7 6s3 2 5 2c2 0 5 0 5-2s-3.5-2-5 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6z" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  cart: <><path d="M2.5 4h2.6l2.2 10.5h10.6l2.1-7.5H6.1" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  doc: <><path d="M6.5 3h8l4 4v14h-12z" /><path d="M14.5 3v4h4M9.5 12h6M9.5 16h6" /></>,
  bars: <><rect x="4.5" y="12" width="3.6" height="8" rx="1.2" /><rect x="10.2" y="8" width="3.6" height="12" rx="1.2" /><rect x="15.9" y="4" width="3.6" height="16" rx="1.2" /></>,
  shop: <><path d="M3 4h18v4H3z" /><path d="M4.5 8v12h15V8M4.5 14h15M2.5 20h19" /></>,
  export: <><path d="M12 3.5v11M7.5 10 12 14.5l4.5-4.5" /><path d="M3.5 15v5h17v-5" /></>,
  alert: <><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.2M12 16.8v.1" /></>,
  note: <><rect x="5.5" y="3.5" width="13" height="17" rx="2" /><path d="M9 8.5h6M9 12h6M9 15.5h4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>
