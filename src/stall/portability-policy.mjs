// One policy for browser transfers and the RER CLI. Credentials and sessions
// never travel; products, orders and import custody do. The destination keeps
// its own claimed owner and authentication records.
export const portabilityPolicy = {
 product: 'commerce/stall',
 excludeTables: ['st_agent_tokens','st_guard','rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'],
 requiredConfiguration: ['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM','PIER_ORIGIN','PIER_SESSION','PIER_CUSTOMER_ID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
};
