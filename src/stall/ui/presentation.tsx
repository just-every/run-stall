import { Authority } from './authority'
import { createContext, useContext, useMemo } from 'react'
export const defaultTimeZone = 'America/Chicago'
export const TimeZone = createContext(defaultTimeZone)
export const People = createContext<Record<string, string>>({})
export const shortId = (id: string) => id.replaceAll('-', '').slice(0, 4).toUpperCase()
export function humanLabel(value: string) {
  // Providers' British field names read in US English ("cancelled" → "canceled", "dispatched" → "shipped").
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(/[._-]/g, ' ').toLowerCase().replace(/\bcancell/g, 'cancel').replace(/\bdispatch(ed)?\b/g, (_, ed) => ed ? 'shipped' : 'shipping')
  return words ? words[0].toUpperCase() + words.slice(1) : 'Not recorded'
}
/** The full timestamp for a hover title: "Oct 17, 2026, 8:56 AM CDT". */
export function businessTime(value: string | number, timeZone = defaultTimeZone) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
}
export function usePerson() {
  const people = useContext(People),actor=useContext(Authority)
  return (id: string) => people[id] ?? (id === 'stripe' ? 'Stripe' : id === 'pier' ? 'Pier' : id.startsWith('agent:') ? 'Shop agent' : actor.role==='member'&&actor.staffRole?'Shop operator':'Former shop operator')
}
const dayKey = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'))
}
const yearOf = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date)
/** "Oct 17, 9:14 AM CDT", with the year when it is not this year's. */
export function shortTime(value: string | number, now = Date.now(), timeZone = defaultTimeZone) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', ...(yearOf(date, timeZone) === yearOf(new Date(now), timeZone) ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
}
/** Use the offset in effect at the event, including daylight saving time. */
export function timeZoneLabel(value: string | number, timeZone = defaultTimeZone) {
 const date=new Date(value)
 return Number.isNaN(date.valueOf())?timeZone:new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'}).formatToParts(date).find(part=>part.type==='timeZoneName')!.value
}
/** A log's time: "8:52 AM" today, then "Oct 15, 11:09 AM". */
export function clockTime(value: string | number, now = Date.now(), timeZone = defaultTimeZone) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Time not recorded'
  return dayKey(date, timeZone) === dayKey(new Date(now), timeZone) ? new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date) : shortTime(date.valueOf(), now, timeZone)
}
/** A compact time that shows the full timestamp on hover. */
export function When({ at, now }: { at: string | number; now?: number }) {
  const { businessTime, shortTime } = useBusinessTime()
  return <time dateTime={String(at)} title={businessTime(at)}>{shortTime(at, now)}</time>
}
/** A table's date column: "Aug 10", with the year when it is not this year's. */
export function shortDate(value: string | number, now = Date.now(), timeZone = defaultTimeZone) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', ...(yearOf(date, timeZone) === yearOf(new Date(now), timeZone) ? {} : { year: 'numeric' }) }).format(date)
}
/** "6 min ago", "3 h ago", "2 days ago" for a time in the past. */
export function ago(value: string | number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).valueOf()) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? '' : 's'} ago`
}
/** A table's time column: the time today, "Yesterday", then "Oct 12". */
export function whenLabel(value: string | number, now = Date.now(), timeZone = defaultTimeZone) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Not recorded'
  if (dayKey(date, timeZone) === dayKey(new Date(now), timeZone)) return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date)
  if (dayKey(date, timeZone) === dayKey(new Date(now), timeZone) - 86400000) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date)
}
/** Bind each formatter to this shop without sharing mutable state between renders. */
export function useBusinessTime() {
  const timeZone = useContext(TimeZone)
  return useMemo(() => ({
    timeZone,
    businessTime: (value: string | number) => businessTime(value, timeZone),
    shortTime: (value: string | number, now?: number) => shortTime(value, now, timeZone),
    timeZoneLabel: (value: string | number) => timeZoneLabel(value, timeZone),
    clockTime: (value: string | number, now?: number) => clockTime(value, now, timeZone),
    shortDate: (value: string | number, now?: number) => shortDate(value, now, timeZone),
    whenLabel: (value: string | number, now?: number) => whenLabel(value, now, timeZone),
  }), [timeZone])
}
export const countryName = (code?: string) => code === 'US' ? 'United States' : code ?? ''
/** "Ana Ruiz" and "Denver, CO" for a person, from the delivery details Stripe collected. */
export function placeLine(address?: { city?: string; state?: string }) { return [address?.city, address?.state].filter(Boolean).join(', ') }
export function initials(name: string) { return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?' }
