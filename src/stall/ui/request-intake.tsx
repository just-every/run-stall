import { useEffect, useState } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { errorMessage, request } from './api'
import { Notice } from './primitives'
import { humanLabel, shortId, When } from './presentation'

type Intake = { requests: { id: string; orderId: string; kind: string; createdAt: string }[]; canManage: boolean; limit: number; tasks: { id: string; sourceId: string; eventKey: string; status: string }[] }
export function RequestIntake() {
  const [data, setData] = useState<Intake>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function load() { setBusy(true); setError(''); try { setData(await request<Intake>('/api/stall/workflows')) } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) } }
  useEffect(() => { void load() }, [])
  return <HydrationUnit><section className="st-orders st-stack" aria-labelledby="requests-title">
    <div className="st-view-head"><h1 id="requests-title">Customer requests</h1></div>
    <p>Return and cancellation requests awaiting a person’s review. This list records intake, including requests without an active workflow rule. It records no decision, refund, cancellation or physical receipt.</p>
    <p><a href="#settings">Configure assigned follow-up in Settings → Workflows</a>. Rules create tasks and staff alerts at their next scan. Without a rule there is no assigned task or alert.</p>
    {error && <Notice error>{error}</Notice>}
    <button className="st-secondary" disabled={busy} onClick={() => void load()}>{busy ? 'Refreshing requests…' : 'Refresh requests'}</button>
    {data?.canManage && <><p>Newest {data.limit} requests shown. Every entry still requires human review.</p>
      {!data.requests.length && <p>No customer requests yet.</p>}
      {data.requests.map(item => <article className="st-panel st-stack" aria-label={`Request ${item.id}`} key={item.id}>
        <h2>{humanLabel(item.kind)} request · {shortId(item.id)}</h2>
        <p>Requested <When at={item.createdAt} /></p><p style={{ overflowWrap: 'anywhere' }}>Request reference: {item.id}</p>
        <a style={{ overflowWrap: 'anywhere' }} href={`#orders/${encodeURIComponent(item.orderId)}`}>Open order {item.orderId}</a>
        <p>Intake recorded; no decision recorded here.</p>
        <p>{data.tasks.some(task => task.eventKey === 'request:' + item.id) ? 'Workflow follow-up exists. Open Settings → Workflows to review its status.' : 'No workflow follow-up in the newest tasks. Check Settings → Workflows for assignment and alerts.'}</p>
      </article>)}
    </>}
  </section></HydrationUnit>
}
