import type { AnalyticsReport, DrillOrder } from '../analytics/report-model'
import { money } from './api'
import { humanLabel, shortId, When } from './presentation'

const amount = (value: number | null) => value === null ? 'Unknown' : money(value)
function OrderDetails({ order }: { order: DrillOrder }) {
 return <details><summary>Order {shortId(order.id)}{order.test ? ' · Test payment' : order.historical ? ' · Historical import' : ''}</summary><div className="st-stack">
  {!order.historical && <a href={`#orders/${encodeURIComponent(order.id)}`}>Open order in desk</a>}
  <dl className="st-definition"><div><dt>Conversion</dt><dd>{order.conversion ? 'Included in new conversion' : 'Excluded from new conversion'}</dd></div><div><dt>Contribution margin</dt><dd>{amount(order.contributionMarginCents)}</dd></div><div><dt>Item cost</dt><dd>{amount(order.itemCostCents)}</dd></div><div><dt>Shipping cost</dt><dd>{amount(order.shippingCostCents)}</dd></div><div><dt>Payment fees</dt><dd>{amount(order.feesCents)}</dd></div><div><dt>Processor</dt><dd>{order.references.processor ?? 'Not recorded'}</dd></div><div><dt>Processor refunds</dt><dd>{order.references.processorRefunds.join(', ') || 'Not recorded'}</dd></div><div><dt>Accounting</dt><dd>{order.references.accounting.join(', ') || 'Not recorded'}</dd></div><div><dt>Tax transaction</dt><dd>{order.references.taxTransaction ?? 'Not recorded'}</dd></div>{order.provenance && <div><dt>Import provenance</dt><dd>{order.provenance.source} · {order.provenance.sourceId} · <When at={order.provenance.importedAt} /></dd></div>}</dl>
  <ul className="st-report-lines">{order.lines.map((line, index) => <li key={`${line.sku}-${index}`}><strong>{line.name}</strong><span>{line.sku} · {line.quantity} sold · {line.refundedQuantity === null ? 'Unknown quantity' : line.refundedQuantity} refunded · {money(line.netSalesCents)} net sales</span></li>)}</ul>
 </div></details>
}
export function AnalyticsOrders({ report }: { report: AnalyticsReport }) {
 return <section className="st-stack" aria-labelledby="report-orders-title"><h2 id="report-orders-title">Contributing orders</h2><div className="st-report-table-wrap" role="region" aria-label="Contributing orders" tabIndex={0}><table><caption className="st-sr-only">Contributing orders</caption><thead><tr>{['Order', 'Order date', 'Customer', 'Channel', 'Net sales', 'Refunds', 'Margin'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
  {report.orders.map(order => <tr key={order.id}><th scope="row"><OrderDetails order={order} /></th><td><When at={order.createdAt} /></td><td>{order.customer ?? 'Unknown'}</td><td>{humanLabel(order.channel)}</td><td className="st-num">{money(order.netSalesCents)}</td><td className="st-num">{money(order.refundsCents)}</td><td className="st-num">{amount(order.contributionMarginCents)}</td></tr>)}{!report.orders.length && <tr><td colSpan={7}>No paid orders match these filters.</td></tr>}
 </tbody></table></div>{report.excludedTestOrders.length > 0 && <details><summary>Excluded test payments · {report.excludedTestOrders.length}</summary><p>Test payments stay outside sales totals, rankings and new conversion.</p>{report.excludedTestOrders.map(order=><OrderDetails key={order.id} order={order}/>)}</details>}</section>
}
