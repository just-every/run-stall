import { Clock, Drawing, Heading, Lights, Lock, Mug, Section } from '../parts'
import { batch, checkout, dollars, glazes, mugs, opening, shop, usd } from '../kiln'
import '../../styles/sections/drop.css'

/** 04 · Friday 10:00 PM, the drop: the collection page, lapped by a checkout holding its mug. */
export function Drop() {
  const line = mugs[checkout.glaze]
  return <Section id="drop" className="drop">
    <Heading id="drop" eyebrow="Friday 10:00 PM · The drop" title="Held while they pay" className="centred">
      Apple Pay, Google Pay, cards and codes. Each mug is held for ten minutes at checkout.
    </Heading>
    <Drawing className="drop-art" label={`${shop.domain}/collections/kiln-batch-12 at the opening minute: ${glazes.map(g => `${mugs[g].name} ${dollars(mugs[g].price)}, ${opening[g]} left`).join('; ')}. A checkout for one ${line.name}: ${usd(checkout.lines)}, code ${checkout.code} ${usd(-checkout.discount)}, ${checkout.service} ${usd(checkout.shipping)}, sales tax ${usd(checkout.tax)}, total ${usd(checkout.total)}, held for ${checkout.held}.`}>
      <div className="card store">
        <div className="browser-bar"><Lights /><span className="address"><Lock />{shop.domain}/collections/kiln-batch-12</span></div>
        <p className="store-title">{batch.name}</p>
        <ul className="store-grid">{glazes.map(g => <li key={g} className="store-item">
          <Mug glaze={g} className="store-mug" />
          <p className="store-line"><b>{mugs[g].name}</b><span>{dollars(mugs[g].price)}</span></p>
          <p className="store-left">{opening[g]} left</p>
        </li>)}</ul>
      </div>
      <div className="card pay">
        <p className="card-title">Checkout</p>
        <p className="pay-item"><Mug glaze={checkout.glaze} className="pay-thumb" /><b>{line.name}{'\u00a0×\u00a0'}1</b><span>{usd(checkout.lines)}</span></p>
        <dl className="pay-rows">
          <div><dt>Code {checkout.code}</dt><dd>{usd(-checkout.discount)}</dd></div>
          <div><dt>{checkout.service}</dt><dd>{usd(checkout.shipping)}</dd></div>
          <div><dt>{checkout.taxLabel}</dt><dd>{usd(checkout.tax)}</dd></div>
        </dl>
        <p className="pay-total"><b>Total</b><b>{usd(checkout.total)}</b></p>
        <span className="pay-button">Pay with Apple Pay</span>
        <p className="held"><Clock />Held for you{'\u00a0·\u00a0'}{checkout.held}</p>
      </div>
    </Drawing>
  </Section>
}
