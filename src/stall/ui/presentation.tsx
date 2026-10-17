import { createContext, useContext } from 'react'
// Change this installation setting to the shop's business time zone.
export const businessTimeZone = 'America/Chicago'
export const People = createContext<Record<string, string>>({})
export const shortId = (id: string) => id.replaceAll('-', '').slice(0, 4).toUpperCase()
export function humanLabel(value: string) {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(/[._-]/g, ' ').toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Not recorded'
}
/** The full timestamp for a hover title: "Oct 17, 2026, 8:56 AM CDT". */
export function businessTime(value: string | number) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
}
export function usePerson() {
  const people = useContext(People)
  return (id: string) => people[id] ?? (id === 'stripe' ? 'Stripe' : id.startsWith('agent:') ? 'Shop agent' : 'Former shop operator')
}
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const yearOf = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, year: 'numeric' }).format(date)
/** "Oct 17, 9:14 AM" in the business time zone, with the year when it is not this year's. */
export function shortTime(value: string | number, now = Date.now()) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, month: 'short', day: 'numeric', ...(yearOf(date) === yearOf(new Date(now)) ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' }).format(date)
}
/** A log's time: "8:52 AM" today, then "Oct 15, 11:09 AM". */
export function clockTime(value: string | number, now = Date.now()) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Time not recorded'
  return dayKey(date) === dayKey(new Date(now)) ? new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, hour: 'numeric', minute: '2-digit' }).format(date) : shortTime(date.valueOf(), now)
}
/** A compact time that shows the full timestamp on hover. */
export function When({ at, now }: { at: string | number; now?: number }) {
  return <time dateTime={String(at)} title={businessTime(at)}>{shortTime(at, now)}</time>
}
/** A table's date column: "Aug 10", with the year when it is not this year's. */
export function shortDate(value: string | number, now = Date.now()) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, month: 'short', day: 'numeric', ...(yearOf(date) === yearOf(new Date(now)) ? {} : { year: 'numeric' }) }).format(date)
}
/** "6 min ago", "3 h ago", "2 days ago" for a time in the past. */
export function ago(value: string | number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).valueOf()) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? '' : 's'} ago`
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
