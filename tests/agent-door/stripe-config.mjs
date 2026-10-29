export const stripeOrigin = 'https://api.stripe.com';
export const taxAddress = { line1: '1 Fixture Street', city: 'Austin', state: 'TX', postal_code: '78702', country: 'US' };
export const paidAddress = { ...taxAddress, line1: '9 Different Street' };
export const shipFrom = { ...taxAddress, line1: '1200 Cedar Avenue' };
