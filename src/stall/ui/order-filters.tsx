import { useEffect, useId, useState } from 'react'
import type { Order } from './types'
import { errorMessage, request } from './api'

export type OrderFilters = { from: string; to: string; sku: string; overdue: boolean; channel:string }
export const noFilters: OrderFilters = { from: '', to: '', sku: '', overdue: false, channel:'' }
const active = (filters: OrderFilters) => Object.values(filters).some(Boolean)

/** The ids the shop's order search door returns for these filters, or null when none are set. */
export function useFilteredIds(filters: OrderFilters, orders: Order[]) {
  const [found, setFound] = useState<{ ids: Set<string> | null; error: string }>({ ids: null, error: '' })
  const revisions = orders.map(order => order.revision).join()
  useEffect(() => {
    if (!active(filters)) { setFound({ ids: null, error: '' }); return }
    let current = true
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries({ from: filters.from, to: filters.to, sku: filters.sku, channel:filters.channel, overdue: filters.overdue ? 'partial' : '' })) if (value) query.set(key, value)
    request<{ orders: { id: string }[] }>(`/api/stall/orders?${query}`)
      .then(result => { if (current) setFound({ ids: new Set(result.orders.map(order => order.id)), error: '' }) })
      .catch(error => { if (current) setFound({ ids: new Set(), error: errorMessage(error) }) })
    return () => { current = false }
  }, [filters, revisions])
  return found
}

export function OrderFilterBar({ filters, skus, timeZone, change }: { filters: OrderFilters; skus: string[]; timeZone: string; change: (filters: OrderFilters) => void }) {
  const id = useId()
  return <form className="st-filters" aria-label="Order filters" onSubmit={event => event.preventDefault()}>
    <label htmlFor={`${id}-from`}>Placed from</label><input id={`${id}-from`} type="date" value={filters.from} onChange={event => change({ ...filters, from: event.target.value })} />
    <label htmlFor={`${id}-to`}>Placed to</label><input id={`${id}-to`} type="date" value={filters.to} onChange={event => change({ ...filters, to: event.target.value })} />
    <label htmlFor={`${id}-sku`}>Item SKU</label><select id={`${id}-sku`} value={filters.sku} onChange={event => change({ ...filters, sku: event.target.value })}><option value="">Any item</option>{skus.map(sku => <option key={sku} value={sku}>{sku}</option>)}</select>
    <label htmlFor={`${id}-channel`}>Channel</label><select id={`${id}-channel`} value={filters.channel} onChange={event=>change({...filters,channel:event.target.value})}><option value="">All channels</option><option value="online">Online store</option><option value="manual">Manual</option><option value="checkout_link">Checkout link</option><option value="buy_button">Buy Button</option></select>
    <label className="st-check"><input type="checkbox" checked={filters.overdue} onChange={event => change({ ...filters, overdue: event.target.checked })} /> Overdue partly shipped</label>
    <small>Dates are {timeZone} calendar days, both included. Overdue means Pier's latest dispatch is over 7 days old.</small>
    {active(filters) && <button type="button" className="st-secondary" onClick={() => change(noFilters)}>Clear filters</button>}
  </form>
}
