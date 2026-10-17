import { createContext, useContext } from 'react'
// Change this installation setting to the shop's business time zone.
export const businessTimeZone = 'America/Chicago'
export const People = createContext<Record<string, string>>({})
export const shortId = (id: string) => id.replaceAll('-', '').slice(0, 4).toUpperCase()
export function humanLabel(value: string) {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(/[._-]/g, ' ').toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Not recorded'
}
export function businessTime(value: string | number) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(date)
}
export function usePerson() {
  const people = useContext(People)
  return (id: string) => people[id] ?? (id === 'stripe' ? 'Stripe' : id.startsWith('agent:') ? 'Shop agent' : 'Former shop operator')
}
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
/** "Oct 17, 9:14 AM" in the business time zone. */
export function shortTime(value: string | number) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}
/** A table's time column: the time today, "Yesterday", then "Oct 12". */
export function whenLabel(value: string | number, now = Date.now()) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Not recorded'
  if (dayKey(date) === dayKey(new Date(now))) return new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, hour: 'numeric', minute: '2-digit' }).format(date)
  if (dayKey(date) === dayKey(new Date(now - 86400000))) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, month: 'short', day: 'numeric' }).format(date)
}
export const countryName = (code?: string) => code === 'US' ? 'United States' : code ?? ''
/** "Ana Ruiz" and "Denver, CO" for a person, from the delivery details Stripe collected. */
export function placeLine(address?: { city?: string; state?: string }) { return [address?.city, address?.state].filter(Boolean).join(', ') }
export function initials(name: string) { return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?' }
