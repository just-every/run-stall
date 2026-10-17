import { links } from './links'

/** The mark beside the "Stall" wordmark in the heading face. */
export function Lockup({ size = 34 }: { size?: number }) {
  return <a className="site-brand" href={links.home}><img src="/brand/mark.svg" alt="" width={size} height={size} /><span>Stall</span></a>
}
