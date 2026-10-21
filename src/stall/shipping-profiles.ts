import type { Bindings } from '../auth.server'
import { audit, changed, commit, digest } from './access'
import { fail, integer, requirePerson, text, type Actor } from './model'
import { handleName } from './collections'
import { products } from './store'
import { sellables } from './listing'

export type Rate = { type: 'free' } | { type: 'flat'; cents: number } | { type: 'weight'; tiers: { upToGrams: number; cents: number }[] } | { type: 'price'; tiers: { upToCents: number; cents: number }[] }
export type Service = { code: string; name: string; rate: Rate; handlingCents?: number; surchargeCents?: number }
export type Zone = { name: string; zipPrefixes: string[] }
export type Profile = { name: string; shipFrom?: string; zones: Zone[]; services: Service[]; pickup: boolean; delivery: boolean }
export type StoredProfile = { id: string; value: Profile; revision: string }
export type Pickup = { name: string; address: string; hours?: string; instructions?: string }
export type Delivery = { zipPrefixes: string[]; feeCents: number; minimumCents: number; instructions?: string }
export type Places = { pickup?: { value: Pickup; revision: string }; delivery?: { value: Delivery; revision: string } }

export const generalId = 'general'
export const maxProfiles = 100
const reservedCodes = ['pickup', 'local-delivery']
// A shop that never saved a general profile ships free; saving one records its revision.
const unsavedGeneral: StoredProfile = { id: generalId, revision: 'unsaved', value: { name: 'General', zones: [], services: [{ code: 'standard', name: 'Domestic shipping', rate: { type: 'free' } }], pickup: true, delivery: true } }
const object = (value: unknown, keys: string[], name: string): Record<string, unknown> => {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('SHIPPING_PROFILE', `${name} must use only its documented fields.`, 400)
 return value as Record<string, unknown>
}
const list = (value: unknown, name: string, min: number, max: number) => Array.isArray(value) && value.length >= min && value.length <= max ? value : fail('SHIPPING_PROFILE', `${name} needs between ${min} and ${max} entries.`, 400)
const optional = (value: unknown, name: string, limit: number) => value === undefined || value === '' ? undefined : text(value, name, limit)
const prefixes = (value: unknown, name: string) => {
 const items = list(value, name, 1, 200).map(prefix => typeof prefix === 'string' && /^\d{1,5}$/.test(prefix) ? prefix : fail('SHIPPING_PROFILE', `${name} are ZIP code prefixes of one to five digits.`, 400))
 if (new Set(items).size !== items.length) fail('SHIPPING_PROFILE', `${name} must not repeat a prefix.`, 400)
 return items
}
function tiers<T extends 'upToGrams' | 'upToCents'>(value: unknown, key: T) {
 let last = 0
 return list(value, 'Rate tiers', 1, 20).map(input => {
  const tier = object(input, [key, 'cents'], 'Rate tier'), limit = integer(tier[key], 'Tier limit', 1)
  if (limit <= last) fail('SHIPPING_PROFILE', 'Rate tiers must rise: each limit is above the one before.', 400)
  last = limit
  return { [key]: limit, cents: integer(tier.cents, 'Tier charge in cents', 0, 99999999) } as { [K in T]: number } & { cents: number }
 })
}
function rate(input: unknown): Rate {
 const entry = object(input, ['type', 'cents', 'tiers'], 'Rate')
 if (entry.type === 'free') return { type: 'free' }
 if (entry.type === 'flat') return { type: 'flat', cents: integer(entry.cents, 'Rate cents', 0, 99999999) }
 if (entry.type === 'weight') return { type: 'weight', tiers: tiers(entry.tiers, 'upToGrams') }
 if (entry.type === 'price') return { type: 'price', tiers: tiers(entry.tiers, 'upToCents') }
 return fail('SHIPPING_PROFILE', 'A rate is free, flat, weight-based or price-based.', 400)
}
function service(input: unknown): Service {
 const entry = object(input, ['code', 'name', 'rate', 'handlingCents', 'surchargeCents'], 'Service'), code = handleName(entry.code, 'Service code')
 if (code.length > 40 || reservedCodes.includes(code)) fail('SHIPPING_PROFILE', 'A service code is at most 40 characters and is not pickup or local-delivery.', 400)
 return { code, name: text(entry.name, 'Service name', 80), rate: rate(entry.rate),
  ...(entry.handlingCents !== undefined ? { handlingCents: integer(entry.handlingCents, 'Handling fee in cents', 0, 99999999) } : {}), ...(entry.surchargeCents !== undefined ? { surchargeCents: integer(entry.surchargeCents, 'Surcharge per item in cents', 0, 99999999) } : {}) }
}
export function profileValue(input: unknown): Profile {
 const entry = object(input, ['name', 'shipFrom', 'zones', 'services', 'pickup', 'delivery'], 'Shipping profile')
 const zones = entry.zones === undefined ? [] : list(entry.zones, 'Zones', 0, 20).map((zone): Zone => { const z = object(zone, ['name', 'zipPrefixes'], 'Zone'); return { name: text(z.name, 'Zone name', 60), zipPrefixes: prefixes(z.zipPrefixes, 'Zone ZIP prefixes') } })
 const services = list(entry.services ?? [], 'Services', 0, 20).map(service)
 if (new Set(services.map(item => item.code)).size !== services.length) fail('SHIPPING_PROFILE', 'Each service code may appear once in a profile.', 400)
 if (entry.pickup !== undefined && typeof entry.pickup !== 'boolean' || entry.delivery !== undefined && typeof entry.delivery !== 'boolean') fail('SHIPPING_PROFILE', 'Pickup and local delivery are on or off.', 400)
 const shipFrom = optional(entry.shipFrom, 'Ship-from location', 120)
 const value: Profile = { name: text(entry.name, 'Profile name', 80), ...(shipFrom ? { shipFrom } : {}), zones, services, pickup: entry.pickup !== false, delivery: entry.delivery !== false }
 if (!value.services.length && !value.pickup && !value.delivery) fail('SHIPPING_PROFILE', 'A profile offers at least one shipped service, pickup or local delivery.', 400)
 return value
}
export async function shippingProfiles(db: D1Database): Promise<StoredProfile[]> {
 const rows = (await db.prepare('SELECT * FROM st_shipping_profiles ORDER BY id').all<any>()).results.map((row): StoredProfile => ({ id: row.id, value: JSON.parse(row.value_json), revision: row.revision }))
 return [rows.find(row => row.id === generalId) ?? unsavedGeneral, ...rows.filter(row => row.id !== generalId)]
}
export async function shippingPlaces(db: D1Database): Promise<Places> {
 const places: Places = {}
 for (const row of (await db.prepare('SELECT * FROM st_shipping_places').all<any>()).results) places[row.id as 'pickup' | 'delivery'] = { value: JSON.parse(row.value_json), revision: row.revision }
 return places
}
export async function shippingAssignments(db: D1Database): Promise<Record<string, string>> {
 return Object.fromEntries((await db.prepare('SELECT sku,profile_id FROM st_shipping_assignments ORDER BY sku').all<{ sku: string; profile_id: string }>()).results.map(row => [row.sku, row.profile_id]))
}
export const pickupValue = (input: unknown): Pickup => {
 const entry = object(input, ['name', 'address', 'hours', 'instructions'], 'Pickup place'), hours = optional(entry.hours, 'Opening hours', 200), instructions = optional(entry.instructions, 'Pickup instructions', 500)
 return { name: text(entry.name, 'Pickup name', 120), address: text(entry.address, 'Pickup address', 300), ...(hours ? { hours } : {}), ...(instructions ? { instructions } : {}) }
}
export const deliveryValue = (input: unknown): Delivery => {
 const entry = object(input, ['zipPrefixes', 'feeCents', 'minimumCents', 'instructions'], 'Local delivery'), instructions = optional(entry.instructions, 'Delivery instructions', 500)
 return { zipPrefixes: prefixes(entry.zipPrefixes, 'Delivery area ZIP prefixes'), feeCents: integer(entry.feeCents, 'Delivery fee in cents', 0, 99999999), minimumCents: integer(entry.minimumCents ?? 0, 'Delivery minimum in cents', 0, 99999999), ...(instructions ? { instructions } : {}) }
}

/** Create or replace a profile, or remove an unused one. Every save mints a new revision that open quotes carry. */
export async function profileCommand(env: Bindings, actor: Actor, type: string, p: any) {
 requirePerson(actor)
 const id = handleName(p.id, 'Profile ID'), all = await shippingProfiles(env.DB), prior = all.find(entry => entry.id === id)
 if (type === 'shipping.profile.delete') {
  if (id === generalId) fail('SHIPPING_PROFILE', 'The general profile stays: every product starts in it.', 409)
  if (!prior || p.revision !== prior.revision) fail('CHANGED', 'Refresh this profile before removing it.')
  const using = Object.values(await shippingAssignments(env.DB)).filter(profile => profile === id).length
  if (using) fail('SHIPPING_PROFILE_USED', `${using} product${using === 1 ? ' is' : 's are'} still assigned to ${prior.value.name}. Move them to another profile first.`, 409)
  await commit(env.DB, actor, [env.DB.prepare('DELETE FROM st_shipping_profiles WHERE id=? AND revision=?').bind(id, prior.revision), changed(env.DB), audit(env.DB, actor, id, 'shipping.profile-removed')])
  return { removed: id }
 }
 if (prior ? p.revision !== prior.revision : p.revision !== undefined) fail('CHANGED', 'Refresh this profile before saving it.')
 if (!prior && all.length >= maxProfiles) fail('SHIPPING_PROFILE', `A shop has the general profile and up to ${maxProfiles - 1} custom profiles.`, 409)
 const value = profileValue(p.value)
 if (all.some(entry => entry.id !== id && entry.value.name.toLowerCase() === value.name.toLowerCase())) fail('SHIPPING_PROFILE', 'Another profile already has that name.', 409)
 const revision = crypto.randomUUID(), saved = prior && prior.revision !== 'unsaved'
 const write = saved ? env.DB.prepare('UPDATE st_shipping_profiles SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value), revision, id, prior.revision) : env.DB.prepare('INSERT INTO st_shipping_profiles VALUES(?,?,?)').bind(id, JSON.stringify(value), revision)
 await commit(env.DB, actor, [write, ...(saved ? [changed(env.DB)] : []), audit(env.DB, actor, id, saved ? 'shipping.profile-saved' : 'shipping.profile-created')])
 return { id, value, revision }
}

export async function placeCommand(env: Bindings, actor: Actor, p: any) {
 requirePerson(actor)
 const kind = p.kind === 'pickup' || p.kind === 'delivery' ? p.kind as 'pickup' | 'delivery' : fail('INPUT', 'A place is the pickup place or the local-delivery area.', 400)
 const prior = (await shippingPlaces(env.DB))[kind]
 if (prior ? p.revision !== prior.revision : p.revision !== undefined) fail('CHANGED', 'Refresh this place before saving it.')
 if (p.value === null) {
  if (!prior) fail('CHANGED', 'This place is already removed.')
  await commit(env.DB, actor, [env.DB.prepare('DELETE FROM st_shipping_places WHERE id=? AND revision=?').bind(kind, prior.revision), changed(env.DB), audit(env.DB, actor, kind, 'shipping.place-removed')])
  return { removed: kind }
 }
 const value = kind === 'pickup' ? pickupValue(p.value) : deliveryValue(p.value), revision = crypto.randomUUID()
 const write = prior ? env.DB.prepare('UPDATE st_shipping_places SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value), revision, kind, prior.revision) : env.DB.prepare('INSERT INTO st_shipping_places VALUES(?,?,?)').bind(kind, JSON.stringify(value), revision)
 await commit(env.DB, actor, [write, ...(prior ? [changed(env.DB)] : []), audit(env.DB, actor, kind, prior ? 'shipping.place-saved' : 'shipping.place-created')])
 return { id: kind, value, revision }
}

/** The product and variant SKUs that exist today, with the names a person recognizes them by. */
export async function assignableSkus(db: D1Database) {
 const found = new Map<string, { name: string; productSku: string }>()
 for (const product of await products(db)) for (const value of [product.value, ...(product.value.draft ? [product.value.draft] : [])])
  for (const entry of sellables(value)) found.set(entry.sku, { name: entry.label ? `${value.name} — ${entry.label}` : value.name, productSku: product.id })
 return found
}
export const profileFor = (assigned: Record<string, string>, sku: string, productSku: string) => assigned[sku] ?? assigned[productSku] ?? generalId

const cell = (value: string) => value.trim()
/** The catalog CSV's shipping column: exactly "SKU,Shipping Profile", one row per SKU. */
export function assignmentRows(csv: unknown): { sku: string; profile: string }[] {
 if (typeof csv !== 'string' || csv.length > 100000) fail('SHIPPING_CSV', 'Supply the CSV as text of at most 100 KB.', 400)
 const lines = csv.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(line => line.trim())
 if (lines.length < 2 || lines.length > 201) fail('SHIPPING_CSV', 'Supply a header and between 1 and 200 rows.', 400)
 const split = (line: string) => { if (line.includes('"')) fail('SHIPPING_CSV', 'SKUs and profile IDs contain no quotation marks or commas.', 400); return line.split(',').map(cell) }
 const [sku, profile] = split(lines[0])
 if (split(lines[0]).length !== 2 || sku !== 'SKU' || profile !== 'Shipping Profile') fail('SHIPPING_CSV', 'Use the exact headers: SKU,Shipping Profile.', 400)
 return lines.slice(1).map((line, index) => { const cells = split(line); if (cells.length !== 2 || !cells[0] || !cells[1]) fail('SHIPPING_CSV', `Row ${index + 2} needs a SKU and a profile ID.`, 400); return { sku: cells[0], profile: cells[1] } })
}

type Change = { sku: string; name: string; from: string; to: string; fromRevision: string | null; toRevision: string }
/** Reviewed bulk assignment: a preview lists each change and a fingerprint; applying needs that exact fingerprint. */
export async function assignCommand(env: Bindings, actor: Actor, p: any) {
 requirePerson(actor)
 const rows = p.csv !== undefined ? assignmentRows(p.csv) : Array.isArray(p.assignments) && p.assignments.length && p.assignments.length <= 200 ? p.assignments.map((row: any) => ({ sku: text(row?.sku, 'SKU', 100), profile: text(row?.profile, 'Profile ID', 80) })) : fail('INPUT', 'Assign between one and 200 SKUs.', 400)
 if (new Set(rows.map((row: { sku: string }) => row.sku)).size !== rows.length) fail('SHIPPING_ASSIGN', 'List each SKU once.', 400)
 const [known, profiles, assigned] = await Promise.all([assignableSkus(env.DB), shippingProfiles(env.DB), shippingAssignments(env.DB)])
 const changes = rows.flatMap((row: { sku: string; profile: string }): Change[] => {
  const item = known.get(row.sku) ?? fail('SHIPPING_ASSIGN', `${row.sku} is not a product or variant SKU in this shop.`, 400)
  const target = profiles.find(entry => entry.id === row.profile) ?? fail('SHIPPING_ASSIGN', `${row.profile} is not a shipping profile.`, 400)
  const from = assigned[row.sku] ?? generalId
  return from === target.id ? [] : [{ sku: row.sku, name: item.name, from, to: target.id, fromRevision: profiles.find(entry => entry.id === from)?.revision ?? null, toRevision: target.revision }]
 })
 const fingerprint = await digest(JSON.stringify(changes))
 if (p.fingerprint === undefined) return { changes, fingerprint, unchanged: rows.length - changes.length }
 if (p.fingerprint !== fingerprint) fail('CHANGED', 'The profiles or assignments changed since this review. Review the new changes before applying.')
 if (!changes.length) fail('SHIPPING_ASSIGN', 'Every listed SKU already has that profile.', 409)
 await commit(env.DB, actor, [...changes.flatMap((change: Change) => [
  change.from === generalId ? env.DB.prepare('INSERT INTO st_shipping_assignments(sku,profile_id) VALUES(?,?)').bind(change.sku, change.to)
   : change.to === generalId ? env.DB.prepare('DELETE FROM st_shipping_assignments WHERE sku=? AND profile_id=?').bind(change.sku, change.from)
   : env.DB.prepare('UPDATE st_shipping_assignments SET profile_id=? WHERE sku=? AND profile_id=?').bind(change.to, change.sku, change.from),
  ...(change.from === generalId ? [] : [changed(env.DB)])]),
  audit(env.DB, actor, 'shipping', 'shipping.assigned')])
 return { changes, fingerprint, applied: changes.length }
}
