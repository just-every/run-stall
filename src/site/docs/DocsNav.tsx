import { links } from '../shell/links'
import { guides } from './render'

const sections = [...new Set(guides.map(guide => guide.section))]

/** The guides by section; the current page is marked. */
export function DocsNav({ current }: { current?: string }) {
  return <nav className="docs-nav" aria-label="Guides">
    <a className="docs-nav-home" href="/docs" aria-current={current ? undefined : 'page'}>All guides</a>
    {sections.map(section => <div key={section}>
      <p className="docs-nav-section">{section}</p>
      <ul>{guides.filter(guide => guide.section === section).map(guide => <li key={guide.slug}><a href={guide.path} aria-current={guide.slug === current ? 'page' : undefined}>{guide.title}</a></li>)}</ul>
    </div>)}
    <div>
      <p className="docs-nav-section">Project</p>
      <ul><li><a href={links.contract}>Contract</a></li></ul>
    </div>
  </nav>
}
