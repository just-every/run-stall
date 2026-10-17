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
