import { useEffect, useState } from 'react'
import { request } from './api'

export interface Link { label: string; href: string; children?: Link[] }
type Menus = { main: Link[]; footer: Link[] }
let cached: Promise<Menus> | null = null
const load = () => (cached ??= request<{ menus: Menus }>('/api/stall/menus').then(result => result.menus, () => ({ main: [], footer: [] })))
function useMenu(name: keyof Menus) { const [links, setLinks] = useState<Link[]>([]); useEffect(() => { void load().then(menus => setLinks(menus[name])) }, [name]); return links }
export function HeaderMenu() {
  const links = useMenu('main')
  if (!links.length) return null
  return <nav className="st-menu" aria-label="Shop menu"><ul>{links.map(link => <li key={link.href + link.label}>{link.children?.length ? <details><summary>{link.label}</summary><ul><li><a href={link.href}>All {link.label}</a></li>{link.children.map(child => <li key={child.href + child.label}><a href={child.href}>{child.label}</a></li>)}</ul></details> : <a href={link.href}>{link.label}</a>}</li>)}</ul></nav>
}
export function FooterMenu() {
  const links = useMenu('footer')
  if (!links.length) return null
  return <footer className="st-footer-menu"><nav aria-label="Footer menu"><ul>{links.map(link => <li key={link.href + link.label}><a href={link.href}>{link.label}</a>{link.children?.length ? <ul>{link.children.map(child => <li key={child.href + child.label}><a href={child.href}>{child.label}</a></li>)}</ul> : null}</li>)}</ul></nav></footer>
}
