// One policy for browser transfers and the RER CLI. Credentials, sessions and
// the Pier and Stripe connections saved on Settings never travel; products, orders and import custody do. The destination keeps
// its own claimed owner and authentication records.
export const portabilityPolicy = {
 product: 'commerce/stall',
 // A fresh server's automatic heartbeat is an observation, not merchant data.
 // Restore can replace these last observations while all business tables stay empty-only.
 replaceableTables: ['st_operations'],
 excludeTables: ['st_agent_tokens','st_connections','st_guard','rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'],
 requiredConfiguration: ['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM','PIER_ORIGIN','PIER_SESSION','PIER_CUSTOMER_ID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
};
