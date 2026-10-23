// One policy for browser transfers and the RER CLI. Credentials, sessions and
// the Pier and Stripe connections saved on Settings never travel; products, orders and import custody do. The destination keeps
// its own claimed owner and authentication records.
export const portabilityPolicy = {
 product: 'commerce/stall',
 // A fresh server's automatic heartbeat is an observation, not merchant data.
 // Restore can replace these last observations while all business tables stay empty-only.
 replaceableTables: ['st_operations'],
 excludeTables: ['st_headless_apps','st_headless_subscriptions','st_headless_limits','st_workflow_authority','st_promotion_authority','st_staff','st_agent_tokens','st_connections','st_guard','rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'],
 // Preserve customer/cart and delivery history without transferring authority.
 exportRow(table,row) {
  if(table==='st_customer_visitor_preferences') return {...row,id_hash:row.id_hash.startsWith('restored:')?row.id_hash:'restored:'+row.id_hash}
  if(table==='st_headless_customers') return {...row,operator_id:'restored:'+row.id}
  if(table==='st_headless_requests') return {...row,key_hash:'restored:'+row.id,commerce_key:'restored:'+row.id,checkout_hash:null,request_digest:''}
  if(table==='st_promotion_allocations') return {...row,customer_key:'restored:'+row.order_id}
  return row
 },
 requiredConfiguration: ['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM','PIER_ORIGIN','PIER_SESSION','PIER_CUSTOMER_ID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
};

export default portabilityPolicy;
