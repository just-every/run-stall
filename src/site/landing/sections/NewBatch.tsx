import { Clock, Drawing, Heading, Mug, Section, Seq, Tick } from '../parts'
import { batch, glazes, mugs, usd } from '../kiln'
import '../../styles/sections/new-batch.css'

/** 03 · Friday 9:40 PM, new batch: Kiln batch 12 in the editor, scheduled for ten. */
export function NewBatch() {
  return <Section id="new-batch" className="new-batch">
    <Drawing className="batch-art" label={`${batch.name}: ${glazes.map(g => `${mugs[g].name} ${usd(mugs[g].price)}, ${mugs[g].stock} in stock`).join('; ')}. Channels: ${batch.channels.join(', ')}. ${batch.publishes}, scheduled.`}>
      <div className="card batch">
        <p className="batch-head"><span className="card-title">{batch.name}</span><span className="count-chip">{glazes.length} products</span></p>
        <ul className="batch-rows">{glazes.map(g => <li key={g}>
          <Mug glaze={g} className="batch-mug" />
          <b className="batch-name">{mugs[g].name}</b>
          <span className="batch-price">{usd(mugs[g].price)}</span>
          <span className="batch-stock">{mugs[g].stock} in stock</span>
          <span className="batch-weight">{mugs[g].weight}</span>
        </li>)}</ul>
        <div className="channels"><b>Channels</b>{batch.channels.map(channel => <span key={channel} className="channel"><span className="box"><Tick /></span>{channel}</span>)}</div>
        <p className="schedule"><Clock /><Seq text={batch.publishes} /><span className="scheduled">Scheduled</span></p>
      </div>
    </Drawing>
    <Heading id="new-batch" eyebrow="Friday 9:40 PM · New batch" title={<>List it tonight.<br /> <span className="nowrap">Open at ten</span></>}>
      Photos, prices and stock for the new batch, set to go live on its own.
    </Heading>
  </Section>
}
