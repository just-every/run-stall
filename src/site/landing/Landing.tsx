import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { Closing } from './sections/Closing'
import { Details } from './sections/Details'
import { Growth } from './sections/Growth'
import { Interlude } from './sections/Interlude'
import { Ownership } from './sections/Ownership'
import { Selling } from './sections/Selling'
import { Service } from './sections/Service'
import { Shipping } from './sections/Shipping'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'

/**
 * run-stall.com's homepage, built from the design desk's approved page (17 Oct 2026, hero round 4 D, page v4) in
 * its order: hero; storefront and checkout; shipping and sales tax; the interlude; the order agent and returns;
 * abandoned carts and moving in; ownership; the quiet details; the closing with the footer.
 * Painted art appears only in the hero, the interlude and the closing; every card is HTML and CSS.
 */
export function Landing() {
  return <>
    <SiteHeader />
    <main id="main">
      <Hero />
      <Selling />
      <Shipping />
      <Interlude />
      <Service />
      <Growth />
      <Ownership />
      <Details />
      <Closing />
    </main>
    <SiteFooter />
  </>
}
