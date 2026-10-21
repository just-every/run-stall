import { collections } from './collections'
import { merchandising, type MenuItem } from './merchandising'
import { handleOf } from './listing-checks'
import { listingState } from './listing'
import { products } from './store'

export type Link = { label: string; href: string; children?: Link[] }
/** Menus as links shoppers can follow: a destination that is no longer published is left out, not shown broken. */
export async function menuLinks(db: D1Database): Promise<{ main: Link[]; footer: Link[] }> {
 const [{ value }, lists, listed] = await Promise.all([merchandising(db), collections(db), products(db)])
 const open = new Set(lists.filter(entry => entry.value.published).map(entry => entry.id)), live = new Set(listed.filter(product => listingState(product.value) === 'published').map(product => handleOf(product.value)))
 const link = (item: MenuItem): Link | null => {
  const href = item.to.type === 'link' ? item.to.href : item.to.type === 'collection' ? open.has(item.to.handle) ? `/shop?collection=${encodeURIComponent(item.to.handle)}` : null : live.has(item.to.handle) ? `/shop/${item.to.handle}` : null
  const children = item.children?.map(link).filter((child): child is Link => !!child)
  return href ? { label: item.label, href, ...(children?.length ? { children } : {}) } : null
 }
 const build = (items: MenuItem[]) => items.map(link).filter((entry): entry is Link => !!entry)
 return { main: build(value.menus.main), footer: build(value.menus.footer) }
}
