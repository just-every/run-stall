import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnalyticsReport } from '../analytics/report-model'
import type { Product } from './types'
import { errorMessage, money, request } from './api'
import { Empty, Notice } from './primitives'
import { humanLabel, TimeZone } from './presentation'
import { AnalyticsOrders } from './analytics-orders'
import './analytics.css'

const dimensions = { source: 'Source', medium: 'Medium', campaign: 'UTM campaign', content: 'UTM content', referrer: 'Referrer', landingPage: 'Landing page', device: 'Device', location: 'Location' } as const
type Dimension = keyof typeof dimensions
type Filters = { from: string; to: string; channel: string; product: string; variant: string; customer: string }
const tabs = { sales: 'Sales', traffic: 'Traffic & funnel', best: 'Best sellers', orders: 'Orders' } as const
type Tab = keyof typeof tabs
const amount = (value: number | null) => value === null ? 'Unknown' : money(value)
const count = (value: number | null) => value === null ? 'Unknown' : value.toLocaleString('en-US')
const percent = (value: number | null) => value === null ? 'Unknown' : `${(value * 100).toFixed(2)}%`
function initialDates(timeZone: string): Filters {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
 const part = (type: string) => parts.find(part => part.type === type)!.value
 const to = `${part('year')}-${part('month')}-${part('day')}`
 return { from: new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10), to, channel: '', product: '', variant: '', customer: '' }
}
const queryOf = (filters: Filters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString()
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
 return <div className="st-report-metric" data-metric={label}><dt>{label}</dt><dd>{value}</dd>{note && <p>{note}</p>}</div>
}
function ReportTable({ caption, headings, children }: { caption: string; headings: string[]; children: ReactNode }) {
 return <div className="st-report-table-wrap" role="region" aria-label={caption} tabIndex={0}><table><caption className="st-sr-only">{caption}</caption><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
}
function Sales({ report }: { report: AnalyticsReport }) {
 const totals = report.totals
 const rows: [string, number | null][] = [
  ['Gross item sales', totals.grossSalesCents], ['Discounts', totals.discountsCents], ['Refunds', totals.refundsCents], ['Net item sales', totals.netSalesCents],
  ['Tax collected', totals.taxCents], ['Shipping collected', totals.shippingCollectedCents], ['Net collected', totals.netCollectedCents],
  ['Item cost', totals.itemCostCents], ['Shipping cost', totals.shippingCostCents], ['Payment fees', totals.feesCents], ['Gift liability', totals.giftLiabilityCents], ['Contribution margin', totals.contributionMarginCents],
 ]
 return <section className="st-stack" aria-labelledby="report-sales-title"><h2 id="report-sales-title">Sales & contribution</h2><dl className="st-report-amounts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{amount(value)}</dd></div>)}</dl><details><summary>Margin and missing costs</summary><p>Unknown amounts have no complete recorded evidence. Contribution margin is shown only when the required item costs, shipping costs and payment fees are known. Record actual order costs in <a href="#settings">Settings</a>.</p></details></section>
}
function BestSellers({ report }: { report: AnalyticsReport }) {
 const [level, setLevel] = useState<'products' | 'variants'>('products'), [rank, setRank] = useState<'unitsSold' | 'netSalesCents'>('unitsSold')
 const rows = [...report.bestSellers[level]].sort((a, b) => b[rank] - a[rank] || a.name.localeCompare(b.name))
 return <section className="st-stack" aria-labelledby="report-best-title"><div className="st-row"><h2 id="report-best-title">Best sellers</h2><div className="st-actions"><label>Group by<select value={level} onChange={event => setLevel(event.target.value as typeof level)}><option value="products">Products</option><option value="variants">Variants</option></select></label><label>Rank by<select value={rank} onChange={event => setRank(event.target.value as typeof rank)}><option value="unitsSold">Units sold</option><option value="netSalesCents">Net sales after refunds</option></select></label></div></div>
  <ReportTable caption="Best sellers" headings={['Rank', level === 'products' ? 'Product' : 'Variant', 'Units sold', 'Units refunded', 'Net units', 'Net sales']}>
   {rows.map((row, index) => <tr key={level === 'products' ? row.productSku : row.sku}><td>{index + 1}</td><th scope="row">{row.name}<small>{level === 'products' ? row.productSku : row.sku}</small></th><td className="st-num">{count(row.unitsSold)}</td><td className="st-num">{count(row.unitsRefunded)}</td><td className="st-num">{count(row.netUnits)}</td><td className="st-num">{money(row.netSalesCents)}</td></tr>)}
   {!rows.length && <tr><td colSpan={6}>No sold products match these filters.</td></tr>}
  </ReportTable>
 </section>
}
function Traffic({ report }: { report: AnalyticsReport }) {
 const [dimension, setDimension] = useState<Dimension>('source')
 const funnel: [string, number | null][] = [['Visits', report.funnel.visits], ['Product views', report.funnel.productViews], ['Add to cart', report.funnel.addToCart], ['Checkout', report.funnel.checkouts], ['Paid sessions', report.funnel.payments]]
 return <section className="st-stack" aria-labelledby="report-traffic-title"><h2 id="report-traffic-title">Traffic & funnel</h2><p>{report.policy.traffic}</p><dl className="st-report-funnel">{funnel.map(([label, value]) => <Metric key={label} label={label} value={count(value)} />)}</dl><div className="st-row"><h3>Traffic sources</h3><label>Break down by<select value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>{Object.entries(dimensions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
  <ReportTable caption="Traffic sources" headings={[dimensions[dimension], 'Sessions', 'Paid orders', 'Conversion', 'Net sales']}>
   {report.traffic[dimension].map(row => <tr key={row.value}><th scope="row">{row.value || 'Unknown'}</th><td className="st-num">{count(row.sessions)}</td><td className="st-num">{count(row.paidOrders)}</td><td className="st-num">{percent(row.conversionRate)}</td><td className="st-num">{money(row.netSalesCents)}</td></tr>)}
   {!report.traffic[dimension].length && <tr><td colSpan={5}>No recorded traffic matches these filters.</td></tr>}
  </ReportTable>
 </section>
}

export function Analytics({ products }: { products: Product[] }) {
 const timeZone = useContext(TimeZone), [draft, setDraft] = useState<Filters>(() => initialDates(timeZone)), [applied, setApplied] = useState<Filters>(), [report, setReport] = useState<AnalyticsReport>(), [tab, setTab] = useState<Tab>('sales')
 const [error, setError] = useState(''), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), generation = useRef(0)
 const change = (key: keyof Filters, value: string) => setDraft(current => ({ ...current, [key]: value, ...(key === 'product' ? { variant: '' } : {}) }))
 async function load(filters: Filters) {
  const current = ++generation.current
  setBusy(true); setError('')
  try { const result = await request<AnalyticsReport>(`/api/stall/analytics/report?${queryOf(filters)}`); if (current === generation.current) { setReport(result); setApplied(filters) } }
  catch (error) { if (current === generation.current) setError(errorMessage(error)) }
  finally { if (current === generation.current) setBusy(false) }
 }
 useEffect(() => { void load(draft); return () => { generation.current++ } }, [])
 async function download() {
  if (!applied || exporting) return
  setExporting(true); setError('')
  try {
   const response = await fetch(`/api/stall/analytics/report.csv?${queryOf(applied)}`, { credentials: 'same-origin', cache: 'no-store' })
   if (!response.ok) { const failure: any = await response.json().catch(() => null); throw new Error(typeof failure?.error === 'string' ? failure.error : failure?.error?.message ?? 'The report export could not be downloaded.') }
   const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
   link.href = url; link.download = `stall-reports-${applied.from}-${applied.to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) { setError(errorMessage(error)) } finally { setExporting(false) }
 }
 const variants = products.filter(product => !draft.product || product.value.sku === draft.product).flatMap(product => [{ sku: product.value.sku, name: product.value.name }, ...(product.value.details?.variants ?? []).map(variant => ({ sku: variant.sku, name: `${product.value.name} · ${Object.values(variant.options).join(' · ')}` }))])
 return <section className="st-analytics st-stack" aria-label="Sales reports">
  <div className="st-row"><h1>Reports</h1><button className="st-secondary" disabled={!report || busy || exporting} onClick={() => void download()}>{exporting ? 'Preparing CSV…' : 'Download CSV'}</button></div>
  <details className="st-report-filters"><summary>Filters</summary><form className="st-stack" aria-label="Report filters" onSubmit={event => { event.preventDefault(); void load(draft) }}><div className="st-report-filter-grid">
   <label>From<input required type="date" value={draft.from} max={draft.to || undefined} onChange={event => change('from', event.target.value)} /></label><label>Through<input required type="date" value={draft.to} min={draft.from || undefined} onChange={event => change('to', event.target.value)} /></label>
   <label>Channel<select value={draft.channel} onChange={event => change('channel', event.target.value)}><option value="">All channels</option><option value="online">Online store</option><option value="manual">Manual</option><option value="buy_button">Buy Button</option><option value="checkout_link">Checkout link</option></select></label>
   <label>Product<select value={draft.product} onChange={event => change('product', event.target.value)}><option value="">All products</option>{products.map(product => <option key={product.id} value={product.value.sku}>{product.value.name} · {product.value.sku}</option>)}</select></label>
   <label>Variant SKU<input list="report-variants" value={draft.variant} onChange={event => change('variant', event.target.value)} placeholder="All variants" /><datalist id="report-variants">{variants.map(variant => <option key={variant.sku} value={variant.sku}>{variant.name}</option>)}</datalist></label><label>Customer<input type="search" value={draft.customer} onChange={event => change('customer', event.target.value)} placeholder="Name or email" /></label>
  </div><p>Both dates included · {timeZone}</p><div className="st-actions"><button disabled={busy}>{busy ? 'Loading reports…' : 'Apply filters'}</button><button type="button" className="st-secondary" disabled={busy} onClick={() => { const reset = initialDates(timeZone); setDraft(reset); void load(reset) }}>Reset filters</button></div></form></details>
  {applied && <div className="st-report-applied" role="group" aria-label="Applied report filters"><span>{applied.from} – {applied.to} · {report?.period.timeZone ?? timeZone}</span>{(['channel', 'product', 'variant', 'customer'] as const).filter(key => applied[key]).map(key => <span key={key}>{humanLabel(key)}: {key === 'channel' ? humanLabel(applied[key]) : applied[key]}</span>)}</div>}
  {error && <Notice error>{error}</Notice>}{busy && <p role="status">Loading reports…</p>}
  {report && <>
   <dl className="st-report-metrics"><Metric label="Net sales" value={money(report.totals.netSalesCents)} note="After discounts and refunds" /><Metric label="Paid orders" value={count(report.totals.paidOrders)} /><Metric label="Conversion" value={percent(report.totals.conversionRate)} note={`${count(report.totals.conversionOrders)} eligible paid orders · ${count(report.totals.sessions)} observed ${report.totals.sessions === 1 ? 'session' : 'sessions'}`} /><Metric label="Contribution margin" value={amount(report.totals.contributionMarginCents)} note={report.totals.contributionMarginCents === null ? 'Cost evidence incomplete' : 'From recorded costs'} /></dl>
   <nav className="st-report-tabs" aria-label="Report sections">{Object.entries(tabs).map(([key, label]) => <button key={key} className="st-secondary" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key as Tab)}>{label}</button>)}</nav>
   {tab === 'sales' && <Sales report={report} />}{tab === 'traffic' && <Traffic report={report} />}{tab === 'best' && <BestSellers report={report} />}{tab === 'orders' && <AnalyticsOrders report={report} />}
   <details className="st-report-policy"><summary>Attribution, exclusions & unknowns</summary><ReportPolicy report={report} /></details>
  </>}
  {!report && !busy && !error && <Empty><h2>No report loaded</h2><p>Choose a date range to inspect recorded sales and traffic.</p></Empty>}
 </section>
}

function ReportPolicy({ report }: { report: AnalyticsReport }) { return <dl className="st-definition">{Object.entries(report.policy).map(([key, value]) => <div key={key}><dt>{humanLabel(key)}</dt><dd>{value}</dd></div>)}</dl> }
