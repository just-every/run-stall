import { Drawing, Heading, Mark, Section, Seq } from '../parts'
import { agentLog, SEP, theoOrder } from '../kiln'
import '../../styles/sections/agent.css'

/** 08 · Tuesday 2:14 PM, the order agent: Theo's broken Cobalt, his choice, your tap, the reship. */
export function Agent() {
  return <Section id="order-agent" className="agent">
    <Heading id="order-agent" eyebrow="Tuesday 2:14 PM · The order agent" title={<>Broken in transit.<br /> Reshipped in <span className="nowrap">19 minutes</span></>}>
      The order agent reads the carrier exception, checks live stock, offers the customer a real choice, and you tap Ship.
    </Heading>
    <Drawing className="agent-art" label={`The order agent's log for order #${theoOrder.order}, ${theoOrder.name}: ${agentLog.map(row => `${row.time} ${row.text.replaceAll('\u00a0', ' ')}`).join('; ')}. Stock, label, refund and claim recorded.`}>
      <div className="card log">
        <p className="log-head"><span className="card-title">Order #{theoOrder.order}{SEP}{theoOrder.name}</span><span className="count-chip">Agent</span></p>
        <ol className="log-rows">{agentLog.map(row => <li key={row.time} className={row.kind}>
          <span className="time">{row.time}</span>
          <span className="node">{row.kind === 'alert' ? <Mark kind="alert" /> : row.kind === 'reply' ? <span className="avatar">T</span> : row.kind === 'step' ? <i /> : <Mark kind="done" />}</span>
          <span className="what"><Seq text={row.text} /></span>
        </li>)}</ol>
        <p className="card-foot">Stock, label, refund and claim recorded{SEP}4 records</p>
      </div>
    </Drawing>
  </Section>
}
