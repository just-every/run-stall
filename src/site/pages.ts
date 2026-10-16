// The run site `rer build --site` writes: the homepage with its Run action,
// /run, the not-found page and the public files they use. Every Run page
// string and command is in run.json; nothing here reads installation data.
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild } from '../base/run-site'
import { identity } from '../identity'
import run from './run.json'
import { landingHtml } from './landing'
import { docPages } from './docs'

export function sitePages(): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: landingHtml() },
      { path: '/run', html: runPageHtml(identity, data) },
      { path: '/404', html: siteNotFoundHtml(identity, data) },
      ...docPages(),
    ],
    assets: ['rer-theme.css', 'landing.css', 'docs.css', 'fonts', 'brand'],
  }
}
