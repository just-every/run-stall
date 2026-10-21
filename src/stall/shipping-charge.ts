import type { Bindings } from '../auth.server'
import { fail, integer, requirePerson, type Actor } from './model'
import { profileCommand, generalId, shippingProfiles, type Profile } from './shipping-profiles'

/** The simple case Settings edits: the general profile is one flat "Domestic shipping" service with no zones. */
export function simpleFlatCents(profile: Profile): number | null {
 const [only] = profile.services
 if (profile.services.length !== 1 || only.code !== 'standard' || profile.zones.length || only.handlingCents || only.surchargeCents) return null
 return only.rate.type === 'flat' ? only.rate.cents : only.rate.type === 'free' ? 0 : null
}
export async function generalFlatCents(db: D1Database): Promise<number | null> {
 return simpleFlatCents((await shippingProfiles(db))[0].value)
}
/** Set the general profile's one flat charge; each checkout keeps its own immutable amount. */
export async function configureShipping(env: Bindings, actor: Actor, p: any) {
 requirePerson(actor)
 if (actor.role !== 'owner') fail('FORBIDDEN', 'Only the owner may configure shipping.', 403)
 const shippingCents = integer(p.shippingCents, 'Shipping cents', 0, 99999999), general = (await shippingProfiles(env.DB))[0]
 if (simpleFlatCents(general.value) === null) fail('SHIPPING_PROFILE', 'The general profile has its own services. Edit its rates under Shipping profiles.', 409)
 await profileCommand(env, actor, 'shipping.profile.save', { id: generalId, revision: general.revision, value: { ...general.value, services: [{ code: 'standard', name: 'Domestic shipping', rate: { type: 'flat', cents: shippingCents } }] } })
 return { shippingCents }
}
