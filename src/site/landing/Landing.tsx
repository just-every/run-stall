// The shared styles load first so each section's own stylesheet can refine them.
import '../styles/site.css'
import '../styles/landing.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { Agent } from './sections/Agent'
import { Closing } from './sections/Closing'
import { Drop } from './sections/Drop'
import { Interlude } from './sections/Interlude'
import { Limits } from './sections/Limits'
import { MonthEnd } from './sections/MonthEnd'
import { MoveIn } from './sections/MoveIn'
import { NewBatch } from './sections/NewBatch'
import { Packing } from './sections/Packing'
import { Returns } from './sections/Returns'
import { SoldOut } from './sections/SoldOut'

/**
 * run-stall.com's homepage on the owner-approved structure (page-s1, 17 Oct 2026): one maker's shop, Fog & Clay,
 * through one kiln batch, from moving in to month end. Hero; Sunday, move in; Friday, the new batch, the drop and
 * sold out; the interlude; Saturday's label run; Tuesday's order agent; the return; month end; the honest limits;
 * the closing with the footer. Painted art appears only in the hero, the interlude and the closing; every screen
 * is HTML and CSS reading the records in kiln.ts.
 */
export function Landing() {
  return <>
    <SiteHeader />
    <main id="main">
      <Hero />
      <MoveIn />
      <NewBatch />
      <Drop />
      <SoldOut />
      <Interlude />
      <Packing />
      <Agent />
      <Returns />
      <MonthEnd />
      <Limits />
      <Closing />
    </main>
    <SiteFooter />
  </>
}
