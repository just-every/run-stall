import { AnalyticsConsent } from './analytics-consent'
import type { ReactNode } from 'react'
import { humanLabel, shortId, usePerson, When } from './presentation'
import { HydrationUnit } from '../../base/hydration/unit'
import type { Tone } from './order-status'
import { HeaderMenu } from './menus'
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`st-notice ${error ? 'st-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div> }
export function Section({ children, id, title, className = '' }: { children: ReactNode; id?: string; title: string; className?: string }) { return <HydrationUnit><section className={`st-panel st-stack ${className}`} id={id}><h2>{title}</h2>{children}</section></HydrationUnit> }
export function Empty({ children }: { children: ReactNode }) { return <div className="st-empty"><span className="st-empty-mark" aria-hidden="true"><img src="/brand/mark.svg" width="40" height="41" alt="" /></span><div>{children}</div></div> }
function RecordedValue({ value, field = '' }: { value: unknown; field?: string }) {
  const person = usePerson()
  if (value == null) return <>Not recorded</>
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (Array.isArray(value)) return value.length ? <ol>{value.map((item, i) => <li key={i}><RecordedValue value={item} /></li>)}</ol> : <>None</>
  if (typeof value === 'object') return <dl className="st-definition">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{humanLabel(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt><dd><RecordedValue value={item} field={key} /></dd></div>)}</dl>
  const text = String(value)
  return <>{['by', 'preparedBy', 'actor'].includes(field) ? person(text) : /^\d{4}-\d{2}-\d{2}T/.test(text) ? <When at={text} /> : /^[a-f0-9-]{36}$/i.test(text) ? `Record ${shortId(text)}` : ['status', 'state', 'code', 'action', 'severity'].includes(field) ? humanLabel(text) : text}</>
}
export function RecordDetail({ value, label }: { value: unknown; label: string }) { return <details><summary>{label}</summary><RecordedValue value={value} /></details> }
const toneOf = (value: string): Tone => value === 'failed' ? 'bad' : ['Setup required', 'shortfall', 'draft'].includes(value) ? 'need' : undefined
export function Badge({ children, value, tone = toneOf(value) }: { children?: ReactNode; value: string; tone?: Tone }) { return <span className={`st-badge${tone ? ` st-badge-${tone}` : ''}`}>{children ?? humanLabel(value)}</span> }
export function Brand({ href }: { href: string }) { return <a className="st-brand" href={href}><img src="/brand/mark.svg" width="32" height="33" alt="" /><span data-rer-name>Stall</span></a> }
/** The storefront's and order page's header: the lockup and the two doors. */
export function Chrome() { return <div className="st-store-chrome"><HydrationUnit><header className="st-store-header"><Brand href="/shop" /><nav aria-label="Main navigation"><a href="/shop" aria-current="page">Shop</a><a href="/app">Shop desk</a><a href="/order">Order help</a></nav></header></HydrationUnit><HydrationUnit><HeaderMenu /></HydrationUnit><HydrationUnit><AnalyticsConsent /></HydrationUnit></div> }
export function ProviderLinks() { return <p className="st-small">Connect your stock provider and payments before taking orders. <a href="https://github.com/just-every/run-stall/blob/main/docs/CONNECTIONS.md" target="_blank" rel="noreferrer">Pier and Stripe connection guide</a> · <a href="https://docs.stripe.com/checkout/quickstart" target="_blank" rel="noreferrer">Stripe setup guide</a></p> }
