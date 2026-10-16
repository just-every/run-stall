/// <reference types="vite/client" />
import metadata from '../../package.json'
import { siteDocument } from './shell'

// Markdown stays the source of truth. Vite includes the source at build time;
// the published site contains HTML, never a server-side Markdown loader.
const sources = import.meta.glob<string>('../../docs/**/*.md', { query: '?raw', import: 'default', eager: true })
const repository = metadata.repository.replace(/\/$/, '')
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const plain = (value: string) => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim()
const slug = (value: string) => plain(value).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
type Article = { source: string; path: string; title: string; description: string; markdown: string }

const articles: Article[] = Object.entries(sources).map(([file, markdown]) => {
  const source = file.replace('../../', '')
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]
  if (!title) throw new Error(`Documentation needs a title: ${source}`)
  const description = markdown.split(/\n\s*\n/).find(block => block.trim() && !/^(?:#|```|~~~|\||[-*] |\d+\. )/.test(block.trim())) ?? ''
  return { source, markdown, title: plain(title), description: plain(description), path: `/docs/${source.slice(5, -3).toLowerCase()}` }
}).sort((a, b) => a.path.localeCompare(b.path))
const published = new Map(articles.map(article => [article.source.toLowerCase(), article.path]))

function hrefFor(href: string, article: Article): string {
  if (/^(?:https?:|mailto:)/i.test(href)) return href
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error(`Unsupported docs link: ${href}`)
  if (href.startsWith('#')) return href
  const suffixAt = href.search(/[?#]/)
  const pathname = suffixAt < 0 ? href : href.slice(0, suffixAt)
  const suffix = suffixAt < 0 ? '' : href.slice(suffixAt)
  if (['/', '/run', '/docs'].includes(pathname)) return pathname + suffix
  const segments = pathname.startsWith('/') ? [] : article.source.split('/').slice(0, -1)
  for (const part of decodeURIComponent(pathname).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!segments.length) throw new Error(`Docs link leaves the repository: ${href}`)
      segments.pop()
    } else segments.push(part)
  }
  const source = segments.join('/')
  const page = published.get(source.toLowerCase())
    ?? articles.find(item => item.path === `/${source.toLowerCase()}`)?.path
  if (page) return page + suffix
  if (source.startsWith('docs/') && /\.md$/i.test(source)) throw new Error(`Missing documentation target: ${href} in ${article.source}`)
  return `${repository}/${/\.[a-z\d]+$/i.test(source) ? 'blob' : 'tree'}/main/${segments.map(encodeURIComponent).join('/')}${suffix}`
}

function inline(text: string, article: Article): string {
  const token = /(`+)([^`]+)\1|\[([^\]]+)\]\(([^\s]+?)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|\\([\\`*_{}\[\]()#+.!|>-])/g
  let html = '', cursor = 0
  for (const match of text.matchAll(token)) {
    html += escape(text.slice(cursor, match.index))
    if (match[1]) html += `<code>${escape(match[2])}</code>`
    else if (match[3]) html += `<a href="${escape(hrefFor(match[4], article))}">${inline(match[3], article)}</a>`
    else if (match[5] || match[6]) html += `<strong>${inline(match[5] || match[6], article)}</strong>`
    else if (match[7] || match[8]) html += `<em>${inline(match[7] || match[8], article)}</em>`
    else if (match[9]) html += `<del>${inline(match[9], article)}</del>`
    else html += escape(match[10])
    cursor = match.index! + match[0].length
  }
  return html + escape(text.slice(cursor))
}

function cells(line: string): string[] {
  const values: string[] = []
  let cell = '', code = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '`') code = !code
    if (char === '|' && !code && line[i - 1] !== '\\') { values.push(cell.trim()); cell = '' }
    else cell += char
  }
  values.push(cell.trim())
  if (line.trim().startsWith('|')) values.shift()
  if (line.trim().endsWith('|')) values.pop()
  return values
}

type Heading = { level: number; id: string; title: string }
function render(article: Article): { html: string; headings: Heading[] } {
  const headings: Heading[] = [], seen = new Set<string>()
  const headingId = (title: string) => {
    const base = slug(title)
    let id = base, count = 0
    while (seen.has(id)) id = `${base}-${++count}`
    seen.add(id)
    return id
  }
  const listItem = /^(\s*)([-+*]|\d+\.)\s+(.+)$/
  const blockStart = (line: string) => /^(?:#{1,6}\s|```|~~~|\s*[-+*]\s|\s*\d+\.\s|>\s?|(?:---+|\*\*\*+)\s*$)/.test(line)
  const blocks = (lines: string[]): string => {
    let html = '', i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      const fence = line.match(/^\s*(`{3,}|~{3,})([\w-]*)\s*$/)
      if (fence) {
        const code: string[] = []
        i++
        while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++])
        if (i === lines.length) throw new Error(`Unclosed code block in ${article.source}`)
        i++
        html += `<pre tabindex="0" role="group" aria-label="${escape(`Code: ${code.find(value => value.trim())?.slice(0, 80) ?? fence[2]}`)}"><code${fence[2] ? ` class="language-${escape(fence[2])}"` : ''}>${escape(code.join('\n'))}</code></pre>`
        continue
      }
      const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/)
      if (heading) {
        const level = heading[1].length, title = heading[2], id = headingId(title)
        headings.push({ level, id, title: plain(title) })
        html += `<h${level} id="${escape(id)}">${inline(title, article)}</h${level}>`
        i++; continue
      }
      if (/^(?:---+|\*\*\*+)\s*$/.test(line)) { html += '<hr>'; i++; continue }
      if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1] ?? '')) {
        const headers = cells(line)
        html += `<div class="docs-table" tabindex="0" role="region" aria-label="${escape(`Table: ${headers.map(plain).join(', ')}`)}"><table><thead><tr>${headers.map(cell => `<th scope="col">${inline(cell, article)}</th>`).join('')}</tr></thead><tbody>`
        i += 2
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) html += `<tr>${cells(lines[i++]).map(cell => `<td>${inline(cell, article)}</td>`).join('')}</tr>`
        html += '</tbody></table></div>'; continue
      }
      const item = line.match(listItem)
      if (item) {
        const ordered = /\d/.test(item[2]), tag = ordered ? 'ol' : 'ul', indent = item[1].length
        html += `<${tag}${ordered && Number.parseInt(item[2]) !== 1 ? ` start="${Number.parseInt(item[2])}"` : ''}>`
        while (i < lines.length) {
          const current = lines[i].match(listItem)
          if (!current || current[1].length !== indent || /\d/.test(current[2]) !== ordered) break
          const body = [current[3]], padding = current[0].length - current[3].length
          i++
          while (i < lines.length) {
            if (!lines[i].trim()) {
              if (/^\s+\S/.test(lines[i + 1] ?? '')) { body.push(''); i++; continue }
              i++; break
            }
            if ((lines[i].match(/^\s*/)?.[0].length ?? 0) <= indent) break
            body.push(lines[i++].slice(padding))
          }
          html += `<li>${blocks(body)}</li>`
        }
        html += `</${tag}>`; continue
      }
      if (/^>\s?/.test(line)) {
        const quote: string[] = []
        while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
        html += `<blockquote>${blocks(quote)}</blockquote>`; continue
      }
      const paragraph = [line.trim()]
      i++
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i]) && !(lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ''))) paragraph.push(lines[i++].trim())
      html += `<p>${inline(paragraph.join(' '), article)}</p>`
    }
    return html
  }
  return { html: blocks(article.markdown.replace(/\r\n?/g, '\n').split('\n')), headings }
}

function sidebar(current: string): string {
  const link = (path: string, label: string) => `<a href="${escape(path)}"${path === current ? ' aria-current="page"' : ''}>${escape(label)}</a>`
  return `<aside class="docs-sidebar"><nav aria-label="Documentation"><p class="docs-nav-title">Documentation</p>${link('/docs', 'All guides')}<ul>${articles.map(article => `<li>${link(article.path, article.title)}</li>`).join('')}</ul></nav></aside>`
}

/** Complete documents for /docs and every Markdown file below docs/. */
export function docPages(): { path: string; html: string }[] {
  if (!articles.length) throw new Error('The documentation site has no Markdown sources')
  const pages = articles.map(article => {
    const rendered = render(article)
    const sections = rendered.headings.filter(heading => heading.level === 2)
    const contents = sections.length ? `<nav class="docs-contents" aria-label="On this page"><p>On this page</p><ul>${sections.map(heading => `<li><a href="#${escape(heading.id)}">${escape(heading.title)}</a></li>`).join('')}</ul></nav>` : ''
    const content = rendered.html.replace('</h1>', `</h1>${contents}`)
    const body = `<main id="main" class="docs-layout">${sidebar(article.path)}<article class="docs-article"><a class="docs-back" href="/docs">All guides</a>${content}<p class="docs-source"><a href="${repository}/blob/main/${article.source}">View this guide on GitHub</a></p></article></main>`
    return { path: article.path, html: siteDocument(`${article.title} · Stall docs`, body, article.description) }
  })
  const index = `<main id="main" class="docs-layout">${sidebar('/docs')}<article class="docs-article"><p class="docs-eyebrow">Stall</p><h1>Documentation</h1><div class="docs-guide-list">${articles.map(article => `<a class="docs-guide" href="${article.path}"><h2>${escape(article.title)} <span aria-hidden="true">↗</span></h2><p>${escape(article.description)}</p></a>`).join('')}</div></article></main>`
  return [{ path: '/docs', html: siteDocument('Documentation · Stall', index, 'Guides for running and using Stall.') }, ...pages]
}
