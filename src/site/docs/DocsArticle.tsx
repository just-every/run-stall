import { Dot } from '../shell/Actions'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { DocsNav } from './DocsNav'
import { guides } from './render'

/** One guide: the nav, the article with its sections listed, then the previous and next guides. */
export function DocsArticle({ slug }: { slug: string }) {
  const index = guides.findIndex(guide => guide.slug === slug), guide = guides[index]
  const previous = guides[index - 1], next = guides[index + 1]
  const sections = guide.headings.filter(heading => heading.level === 2)
  return <>
    <SiteHeader current="docs" />
    <main id="main" className="docs site-wrap">
      <DocsNav current={slug} />
      <article className="docs-main">
        <p className="eyebrow">{guide.section}</p>
        <h1>{guide.title}<Dot /></h1>
        {sections.length > 1 && <nav className="docs-contents" aria-label="On this page"><p>On this page</p><ul>{sections.map(heading => <li key={heading.id}><a href={`#${heading.id}`}>{heading.title}</a></li>)}</ul></nav>}
        <div className="prose" dangerouslySetInnerHTML={{ __html: guide.html }} />
        <p className="docs-source"><a href={guide.source}>View this guide on GitHub</a></p>
        <nav className="docs-pager" aria-label="More guides">
          {previous ? <a className="card" href={previous.path}><span>Previous</span>{previous.title}</a> : <span />}
          {next ? <a className="card next" href={next.path}><span>Next</span>{next.title}</a> : <span />}
        </nav>
      </article>
    </main>
    <SiteFooter />
  </>
}
