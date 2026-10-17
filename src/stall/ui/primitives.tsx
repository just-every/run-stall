import type { ReactNode } from 'react'
import { businessTime, humanLabel, shortId, usePerson } from './presentation'
import { HydrationUnit } from '../../base/hydration/unit'
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`st-notice ${error ? 'st-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div> }
export function Section({ children, id, title }: { children: ReactNode; id?: string; title: string }) { return <HydrationUnit><section className="st-panel st-stack" id={id}><h2>{title}</h2>{children}</section></HydrationUnit> }
export function Empty({ children }: { children: ReactNode }) { return <div className="st-empty"><svg viewBox="0 0 140 90" aria-hidden="true"><path d="M4 9q0 43 48 40" fill="none" stroke="var(--st-twine)" strokeWidth="3"/><g transform="rotate(-15 88 49)"><path d="m48 31 17-14h60v57H65L48 60Z" fill="var(--st-kraft)"/><circle cx="63" cy="44" r="5" fill="var(--st-paper)" stroke="var(--st-kraft-deep)"/></g></svg><div>{children}</div></div> }
function RecordedValue({ value, field = '' }: { value: unknown; field?: string }) {
  const person = usePerson()
  if (value == null) return <>Not recorded</>
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (Array.isArray(value)) return value.length ? <ol>{value.map((item, i) => <li key={i}><RecordedValue value={item} /></li>)}</ol> : <>None</>
  if (typeof value === 'object') return <dl className="st-definition">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{humanLabel(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt><dd><RecordedValue value={item} field={key} /></dd></div>)}</dl>
  const text = String(value)
  return <>{['by', 'preparedBy', 'actor'].includes(field) ? person(text) : /^\d{4}-\d{2}-\d{2}T/.test(text) ? businessTime(text) : /^[a-f0-9-]{36}$/i.test(text) ? `Record ${shortId(text)}` : ['status', 'state', 'code', 'action', 'severity'].includes(field) ? humanLabel(text) : text}</>
}
export function RecordDetail({ value, label }: { value: unknown; label: string }) { return <details><summary>{label}</summary><RecordedValue value={value} /></details> }
export function Badge({ children, value }: { children?: ReactNode; value: string }) { return <span className={`st-badge ${['Setup required','shortfall','failed'].includes(value) ? 'st-badge-outline' : ''} ${value === 'failed' ? 'st-badge-danger' : ''}`}>{children ?? humanLabel(value)}</span> }
export function Chrome({ desk = false }: { desk?: boolean }) { return <HydrationUnit><header className="st-header"><a className="st-brand" href={desk ? '/app' : '/shop'}><img src="/brand/mark.svg" width="30" height="30" alt="" /><span data-rer-name>Stall</span></a><nav aria-label="Main navigation"><a href="/shop" aria-current={!desk ? 'page' : undefined}>Shop</a><a href="/app" aria-current={desk ? 'page' : undefined}>Shop desk</a>{desk && <a href="/auth/settings/identity">Account</a>}</nav></header></HydrationUnit> }
export function ProviderLinks() { return <p className="st-small">Connect your stock provider and payments before taking orders. <a href="https://github.com/just-every/run-stall/blob/main/docs/CONNECTIONS.md" target="_blank" rel="noreferrer">Pier and Stripe connection guide</a> · <a href="https://docs.stripe.com/checkout/quickstart" target="_blank" rel="noreferrer">Stripe setup guide</a></p> }
