import { Fragment } from 'react'
import { Drawing, Heading, Lights, Mark, Section } from '../parts'
import { importFix, imported, moveInCommands, shop } from '../kiln'
import '../../styles/sections/move-in.css'

/** 02 · Sunday, move in: the Shopify import and the five lines that start Stall. */
export function MoveIn() {
  return <Section id="move-in" className="move-in">
    <div className="move-copy">
      <Heading id="move-in" eyebrow="Sunday · Move in" title={<>Bring the <span className="nowrap">whole shop</span></>}>
        Products, customers, orders and redirects come over from Shopify in one import.
      </Heading>
      <figure className="terminal" aria-label="Start Stall on your own computer">
        <Lights />
        <pre><code>{moveInCommands.map(line => <span className="line" key={line}><span className="prompt" aria-hidden="true">$ </span>{line.split(' ').map((word, i) => <Fragment key={i}>{i ? ' ' : ''}{word.split(/(?<=github\.com\/)/).map((part, j) => <Fragment key={j}>{j ? <wbr /> : null}<span className="nowrap">{part}</span></Fragment>)}</Fragment>)}</span>)}</code></pre>
      </figure>
    </div>
    <Drawing className="move-art" label={`The import from ${shop.shopify}: ${imported.map(row => `${row.count.toLocaleString('en-US')} ${row.label.toLowerCase()}`).join(', ')}. ${importFix.noWeight} products had no weight and were set to ${importFix.setTo}. Imported in ${importFix.took}.`}>
      <div className="card import">
        <p className="card-title">Import from Shopify</p>
        <p className="import-source">{shop.shopify}</p>
        <ul className="import-rows">{imported.map(row => <li key={row.label}><span>{row.label}</span><b>{row.count.toLocaleString('en-US')}</b><Mark kind="done" /></li>)}</ul>
        <p className="import-note warn"><svg className="warn-icon" viewBox="0 0 24 24"><path d="M12 3.2 22 20.5H2z" /><path d="M12 9.5v5M12 17.4v.1" /></svg>{importFix.noWeight} products had no weight</p>
        <p className="import-note fixed"><Mark kind="ok" />Set to {importFix.setTo}{'\u00a0·\u00a0'}fixed</p>
        <span className="import-bar" />
        <p className="card-foot">Imported in {importFix.took}</p>
      </div>
    </Drawing>
  </Section>
}
