// Where the run site's links go. The run site never links an instance-only route (/signin, /setup, /app).
import run from '../run.json'

export const links = {
  home: '/',
  run: '/run',
  docs: '/docs',
  contract: '/contract',
  source: run.repository,
  licence: `${run.repository}/blob/main/LICENSE`,
  demo: 'https://demo.run-stall.com/',
  // The contract's Honest boundaries: what Stall leaves to Pier, the help desk and the merchant.
  limits: `${run.repository}/blob/main/CONTRACT.md#honest-boundaries`,
}
