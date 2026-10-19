import { Drawing, Heading, Mark, Mug, Section, Seq } from '../parts'
import { danaCart, dollars, mugs, recovery, SEP, usd } from '../kiln'
import '../../styles/sections/sold-out.css'

/** 05 · Friday 10:43 PM, sold out: Dana's cart on its timeline, and the note that brings her back. */
export function SoldOut() {
  const chip = `${recovery.left} carts left${SEP}${recovery.back} came back${SEP}${usd(recovery.cents)}`
  return <Section id="sold-out" className="sold-out">
    <Heading id="sold-out" eyebrow="Friday 10:43 PM · Sold out" title={<>Sold out.<br /> <span className="nowrap">Carts come back</span></>}>
      When a hold runs out, the mug goes back on sale and the shopper gets a note with what is still in stock.
    </Heading>
    <Drawing className="sold-art" label={`Dana R.'s cart: ${danaCart.map(row => `${row.time} ${row.text.replaceAll('\u00a0', ' ')}`).join('; ')}. ${chip.replaceAll('\u00a0', ' ')}. The note to Dana R.: Cobalt sold out, your Fog mug is still here, ${mugs.fog.name} ${dollars(mugs.fog.price)}, Back to your cart.`}>
      <div className="card cart">
        <p className="card-title">Cart{SEP}Dana R.</p>
        <ol className="timeline">{danaCart.map(row => <li key={row.time} className={row.kind}>
          <span className="time">{row.time}</span>
          <span className="node">{row.kind === 'done' ? <Mark kind="done" /> : <i />}</span>
          <span className="what">{row.kind === 'alert' ? <svg className="warn-icon" viewBox="0 0 24 24"><path d="M12 3.2 22 20.5H2z" /><path d="M12 9.5v5M12 17.4v.1" /></svg> : null}{row.text}</span>
        </li>)}</ol>
        <p className="recovered">{chip}</p>
      </div>
      <div className="card note">
        <p className="note-to">To: Dana R.</p>
        <p className="note-subject"><Seq text={`Cobalt sold out${SEP}your Fog mug is still here`} /></p>
        <div className="note-body">
          <Mug glaze="fog" className="note-mug" />
          <div><p>{mugs.fog.name}{SEP}{dollars(mugs.fog.price)}</p><span className="note-button">Back to your cart</span></div>
        </div>
      </div>
    </Drawing>
  </Section>
}
