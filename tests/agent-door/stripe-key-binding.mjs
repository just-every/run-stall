import { randomBytes } from 'node:crypto';

// Shared only by this verifier process and its isolated network fixture.
// Each CLI run gets a fresh value; nothing is persisted or logged.
export const stripeKey = `sk_test_${randomBytes(24).toString('hex')}`;
export default () => stripeKey;
