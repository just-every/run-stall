import { Dot } from '../shell/Actions'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { DocsNav } from './DocsNav'
import { guides } from './render'

/** /docs: what each guide covers, as cards, beside the guide list. */
export function DocsIndex() {
  return <>
    <SiteHeader current="docs" />
    <main id="main" className="docs site-wrap">
      <DocsNav />
      <div className="docs-main">
        <p className="eyebrow">Stall docs</p>
        <h1>Run your shop<Dot /></h1>
        <p className="docs-lede">Guides for what Stall does today: start it, publish products, take and ship orders, move in from Shopify and keep a backup.</p>
        <ol className="docs-cards">{guides.map((guide, i) => <li key={guide.slug}><a className="card docs-card" href={guide.path}><span className="docs-card-num">{String(i + 1).padStart(2, '0')}</span><h2>{guide.title}</h2><p>{guide.description}</p></a></li>)}</ol>
      </div>
    </main>
    <SiteFooter />
  </>
}
