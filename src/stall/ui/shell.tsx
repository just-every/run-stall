// The shop desk's frame (the owner's pick): a slim left sidebar with the
// lockup, the installation, the views and a cork footer strip, and a top bar
// with the view's search and the signed-in person's menu.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { Icon, type IconName } from './icons'
import { Tooltip } from './tooltip'
import { Brand } from './primitives'
import { initials } from './presentation'

export const deskViews = [
  { id: 'orders', label: 'Orders', icon: 'orders' },
  { id: 'products', label: 'Products', icon: 'products' },
  { id: 'shopfront', label: 'Collections & search', icon: 'search' },
  { id: 'shipping', label: 'Shipping', icon: 'shipping' },
  { id: 'requests', label: 'Customer requests', icon: 'orders' },
  { id: 'promotions', label: 'Promotions', icon: 'products' },
  { id: 'move-in', label: 'Move in', icon: 'moveIn' },
  { id: 'history', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[]
export type DeskView = typeof deskViews[number]['id']
/** Older links to a settings section open Settings at that section; #orders/<id> and #products/<sku> open that record. */
export const viewOf = (hash: string): DeskView => ['connections', 'portability'].includes(hash) ? 'settings' : deskViews.find(view => view.id === hash.split('/')[0])?.id ?? 'orders'
export const recordOf = (hash: string) => { const [, id] = hash.split('/'); return id ? decodeURIComponent(id) : undefined }

function Account({ name, email, role }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node) || (event as KeyboardEvent).key === 'Escape') setOpen(false) }
    addEventListener('pointerdown', close); addEventListener('keydown', close)
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', close) }
  }, [open])
  return <div className="st-account" ref={root}>
    <Tooltip label="Account menu"><button className="st-account-button" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={() => setOpen(!open)}><span className="st-avatar" aria-hidden="true">{initials(name)}</span><Icon name="down" /></button></Tooltip>
    {open && <div className="st-account-menu"><p><strong>{name}</strong><small>{email} · {role}</small></p><a href="/auth/settings/identity">Account</a><a href="/shop">View shop</a><button className="st-link" onClick={() => void fetch('/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).finally(() => location.assign('/signin?returnTo=%2Fapp'))}>Sign out</button></div>}
  </div>
}

export function DeskShell({ allowedViews, view, counts, host, actor, search, children }: {
  allowedViews?:DeskView[];view: DeskView; counts: Partial<Record<DeskView, number>>; host: string
  actor?: { name: string; email: string; role: string }
  search?: { label: string; value: string; onChange: (value: string) => void }
  children: ReactNode
}) {
  return <div className="st-app st-desk">
    <HydrationUnit><aside className="st-sidebar">
      <Brand href="/app" />
      <div className="st-install"><h2>Shop desk</h2><p>{host || ' '}</p></div>
      <nav className="st-nav" aria-label="Shop desk">{deskViews.filter(item=>!allowedViews||allowedViews.includes(item.id)).map(item => <a key={item.id} href={`#${item.id}`} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{!!counts[item.id] && <span className="st-count">{counts[item.id]}</span>}</a>)}</nav>
      <p className="st-cork"><Icon name="leaf" />Free and open source for makers and small shops.</p>
    </aside></HydrationUnit>
    <div className="st-workspace">
      <HydrationUnit><header className="st-topbar">
        {search ? <label className="st-search"><Icon name="search" /><span className="st-sr-only">{search.label}</span><input type="search" placeholder={`${search.label}…`} value={search.value} onChange={event => search.onChange(event.target.value)} /></label> : <span />}
        {actor && <Account {...actor} />}
      </header></HydrationUnit>
      <main id="main" className="st-main">{children}</main>
    </div>
  </div>
}
