import type { operationsSnapshot } from '../operations'
import { Notice } from './primitives'
import { humanLabel, shortId, When } from './presentation'
type History=NonNullable<Awaited<ReturnType<typeof operationsSnapshot>>['pierWork']>
export function PierWorkHistory({data}:{data:History}) {
 return <div role="group" aria-label="Pier operation history"><h3>Pier operation history · {data.uncertain} uncertain</h3>
  <p className="st-small">Each attempt keeps its original command ID and commercial intent. Recovery reads the original Pier installation first, then uses Pier’s idempotent command replay to retrieve the durable receipt or commit the first effect if none exists. Changed intent is refused. A response observed records a provider result; it does not claim delivery. Older operations may have no attempt record.</p>
  {data.records.length?<ul className="st-stack">{data.records.map(work=><li key={work.id}><a href={`#orders/${encodeURIComponent(work.orderId)}`}>Order {shortId(work.orderId)}</a> · {humanLabel(work.kind)} · {humanLabel(work.status)} · {work.attempts} command attempt(s) · last attempted <When at={work.attemptedAt} />{work.observedAt&&<> · observed <When at={work.observedAt} /></>}{work.providerId&&<p className="st-reference">{work.providerId}</p>}{work.errorCode&&<p className="st-small">{work.errorCode}. Check the original Pier account and reconcile from the order.</p>}</li>)}</ul>:<p>No Pier command attempt recorded yet.</p>}
  {data.truncated&&<Notice>Showing the latest {data.limit} of {data.total} operations. Download the Pier operations CSV or complete business JSON for the full history.</Notice>}
 </div>
}
