import { digest } from './access'
import { fail, type Line, type OrderShipping } from './model'
import { products } from './store'
import { sellables } from './listing'
import { profileFor, shippingAssignments, shippingPlaces, shippingProfiles, type Delivery, type Pickup, type Profile, type Service } from './shipping-profiles'

export type QuoteService = { code: string; name: string; kind: 'ship' | 'pickup' | 'delivery'; cents: number; quote: string; detail?: string; place?: Pickup | Delivery }
export type Quote = { postalCode?: string; services: QuoteService[]; notes: string[]; unserved: { sku: string; name: string; profile: string }[]; needsPostalCode: boolean }
type Group = { id: string; revision: string; profile: Profile; lines: Line[]; quantity: number; subtotalCents: number; grams: number | null }
const usd = (cents: number) => '$' + (cents / 100).toFixed(2)
const names = (lines: Line[]) => lines.map(line => line.name).join(', ')

export function postalCodeOf(value: unknown): string | undefined {
 if (value === undefined || value === null || value === '') return undefined
 if (typeof value !== 'string' || !/^\d{5}(-\d{4})?$/.test(value.trim())) fail('SHIPPING_ZIP', 'Enter a five-digit US ZIP code.', 400)
 return value.trim().slice(0, 5)
}
const serves = (profile: Profile, zip: string | undefined) => !profile.zones.length || (zip !== undefined && profile.zones.some(zone => zone.zipPrefixes.some(prefix => zip.startsWith(prefix))))

/** One service's charge for a profile's own items: its rate once for the group, plus handling and a per-item surcharge. */
function charge(service: Service, group: Group): number | string {
 const rate = service.rate
 let base = 0
 if (rate.type === 'flat') base = rate.cents
 else if (rate.type === 'weight') {
  if (group.grams === null) return `${names(group.lines)} has no weight, so ${service.name} cannot be rated.`
  const tier = rate.tiers.find(entry => group.grams! <= entry.upToGrams)
  if (!tier) return `${names(group.lines)} is heavier than ${service.name} carries.`
  base = tier.cents
 } else if (rate.type === 'price') {
  const tier = rate.tiers.find(entry => group.subtotalCents <= entry.upToCents)
  if (!tier) return `${names(group.lines)} is above the ${service.name} price bands.`
  base = tier.cents
 }
 return base + (service.handlingCents ?? 0) + (service.surchargeCents ?? 0) * group.quantity
}

/** The offered services for a basket: each shipped service must be allowed by every profile in it, priced as the sum of each profile's own charge. */
export async function quoteShipping(db: D1Database, lines: Line[], postalCode?: string): Promise<Quote> {
 const [profiles, assigned, places, catalog] = await Promise.all([shippingProfiles(db), shippingAssignments(db), shippingPlaces(db), products(db)])
 const grams = new Map<string, number | undefined>()
 for (const product of catalog) for (const entry of sellables(product.value)) grams.set(entry.sku, entry.variant?.weightGrams ?? product.value.details?.weightGrams)
 const groups = new Map<string, Group>()
 for (const line of lines) {
  const id = profileFor(assigned, line.sku, line.productSku ?? line.sku), stored = profiles.find(entry => entry.id === id) ?? profiles[0]
  const group = groups.get(stored.id) ?? { id: stored.id, revision: stored.revision, profile: stored.value, lines: [], quantity: 0, subtotalCents: 0, grams: 0 }
  const weight = grams.get(line.sku)
  group.lines.push(line); group.quantity += line.quantity; group.subtotalCents += line.quantity * line.unitCents
  group.grams = group.grams === null || weight === undefined ? null : group.grams + weight * line.quantity
  groups.set(stored.id, group)
 }
 const all = [...groups.values()], notes: string[] = [], unserved: Quote['unserved'] = [], services: Omit<QuoteService, 'quote'>[] = []
 // Shipped services.
 const blocked = all.filter(group => !group.profile.services.length)
 const outside = all.filter(group => group.profile.services.length && !serves(group.profile, postalCode))
 if (blocked.length) notes.push(`${blocked.map(group => names(group.lines)).join(', ')} can only be picked up or delivered locally, so shipped services are not offered.`)
 if (outside.length) {
  if (postalCode) for (const group of outside) for (const line of group.lines) unserved.push({ sku: line.sku, name: line.name, profile: group.profile.name })
  notes.push(postalCode ? `${outside.map(group => names(group.lines)).join(', ')} cannot be shipped to ZIP ${postalCode}.` : 'Enter your ZIP code to see where these items ship.')
 }
 if (!blocked.length && !outside.length) {
  const offered = all.map(group => new Map(group.profile.services.map(service => [service.code, { service, price: charge(service, group) }])))
  for (const [code, first] of offered[0]) {
   const prices = offered.map(map => map.get(code)?.price)
   if (prices.some(price => price === undefined)) continue
   const failed = prices.find(price => typeof price === 'string')
   if (failed) { notes.push(failed as string); continue }
   services.push({ code, name: first.service.name, kind: 'ship', cents: (prices as number[]).reduce((sum, price) => sum + price, 0) })
  }
 }
 // Pickup and local delivery.
 const noPickup = all.filter(group => !group.profile.pickup), noDelivery = all.filter(group => !group.profile.delivery)
 const subtotal = all.reduce((sum, group) => sum + group.subtotalCents, 0)
 if (places.pickup) {
  if (noPickup.length) notes.push(`${noPickup.map(group => names(group.lines)).join(', ')} cannot be picked up.`)
  else services.push({ code: 'pickup', name: 'Local pickup', kind: 'pickup', cents: 0, detail: [places.pickup.value.name, places.pickup.value.address, places.pickup.value.hours, places.pickup.value.instructions].filter(Boolean).join(' · '), place: places.pickup.value })
 }
 if (places.delivery) {
  const area = places.delivery.value
  if (noDelivery.length) notes.push(`${noDelivery.map(group => names(group.lines)).join(', ')} cannot be delivered locally.`)
  else if (postalCode && !area.zipPrefixes.some(prefix => postalCode.startsWith(prefix))) notes.push(`ZIP ${postalCode} is outside the local delivery area.`)
  else if (postalCode && subtotal < area.minimumCents) notes.push(`Add ${usd(area.minimumCents - subtotal)} more to qualify for local delivery.`)
  else if (postalCode) services.push({ code: 'local-delivery', name: 'Local delivery', kind: 'delivery', cents: area.feeCents, ...(area.instructions ? { detail: area.instructions } : {}), place: area })
 }
 const needsPostalCode = !postalCode && (all.some(group => group.profile.zones.length) || Boolean(places.pickup || places.delivery))
 const used = all.map(group => [group.id, group.revision, group.grams, group.subtotalCents, group.lines.map(line => [line.sku, line.quantity])])
 const quoted: QuoteService[] = []
 for (const service of services) quoted.push({ ...service, quote: await digest(JSON.stringify({ postalCode, service, used })) })
 return { ...(postalCode ? { postalCode } : {}), services: quoted, notes, unserved, needsPostalCode }
}

/** The shopper's chosen service, or the one unambiguous service; never a guess between several. */
export async function chooseShipping(db: D1Database, lines: Line[], input: unknown): Promise<{ service: QuoteService; shipping: OrderShipping }> {
 const choice = input === undefined || input === null ? {} : typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : fail('INPUT', 'Shipping is a service code and a ZIP code.', 400)
 if (Object.keys(choice).some(key => !['service', 'postalCode', 'quote'].includes(key))) fail('INPUT', 'Shipping is a service code, a ZIP code and the quote you reviewed.', 400)
 const postalCode = postalCodeOf(choice.postalCode), quote = await quoteShipping(db, lines, postalCode)
 const unavailable = () => quote.unserved.length ? fail('SHIPPING_UNSERVED', quote.notes.join(' ') + ' Remove it from the basket or choose pickup or local delivery.', 409) : fail('SHIPPING_UNAVAILABLE', quote.notes.join(' ') || 'No delivery option is available for this basket.', 409)
 let service: QuoteService | undefined
 if (choice.service !== undefined) service = quote.services.find(entry => entry.code === choice.service) ?? unavailable()
 else if (quote.services.length === 1) service = quote.services[0]
 else if (!quote.services.length) unavailable()
 else fail('SHIPPING_CHOICE', `Choose a delivery option: ${quote.services.map(entry => entry.name).join(', ')}.`, 409)
 if (choice.quote !== undefined && choice.quote !== service!.quote) fail('QUOTE_CHANGED', 'The shipping rates, profiles or basket changed since this quote. Review the new shipping option and total before paying.', 409)
 const profiles = await shippingProfiles(db), assigned = await shippingAssignments(db)
 const used = [...new Set(lines.map(line => profileFor(assigned, line.sku, line.productSku ?? line.sku)))].map(id => profiles.find(entry => entry.id === id) ?? profiles[0])
 return { service: service!, shipping: { service: { code: service!.code, name: service!.name, kind: service!.kind }, ...(postalCode ? { postalCode } : {}), quote: service!.quote, profiles: used.map(entry => ({ id: entry.id, name: entry.value.name, revision: entry.revision })), ...(service!.place ? { place: service!.place } : {}) } }
}
