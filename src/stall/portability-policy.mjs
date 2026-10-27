// One policy for browser transfers and the RER CLI. Credentials, sessions and
// the Pier and Stripe connections saved on Settings never travel; products, orders and import custody do. The destination keeps
// its own claimed owner and authentication records.
const inert=value=>value.startsWith('restored:')?value:'restored:'+value
export const portabilityPolicy = {
 product: 'commerce/stall',
 // A fresh server's automatic heartbeat is an observation, not merchant data.
 // Restore can replace these last observations while all business tables stay empty-only.
 replaceableTables: ['st_operations'],
 excludeTables: ['st_review_state','st_customer_order_history_state','st_customer_registrations','st_customer_registration_limits','st_guest_order_links','st_headless_apps','st_headless_subscriptions','st_headless_limits','st_workflow_authority','st_promotion_authority','st_staff','st_agent_tokens','st_connections','st_guard','st_email_changes','st_email_link_sessions','rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'],
 // Preserve customer/cart and delivery history without transferring authority.
 exportRow(table,row) {
  if(table==='st_analytics_visitors')return {...row,id_hash:inert(row.id_hash),privacy_hash:inert(row.privacy_hash)}
  if(table==='st_analytics_sessions') {const value=JSON.parse(row.value_json);return {...row,visitor_hash:inert(row.visitor_hash),value_json:JSON.stringify({...value,privacyHash:inert(value.privacyHash),restored:true})}}
  if(table==='st_orders') {const value=JSON.parse(row.value_json);if(value.analytics)return {...row,value_json:JSON.stringify({...value,analytics:{...value.analytics,visitorHash:undefined,restored:true}})} }
  if(table==='st_analytics_cost_preferences')return {...row,enabled:0}
  if(table==='st_analytics_history_previews')return {...row,by_actor:inert(row.by_actor)}
  if(table==='st_buy_links')return {...row,restored:1}
  if(table==='st_merch_proposals') { const value=JSON.parse(row.value_json); return {...row,value_json:JSON.stringify({...value,status:'restored',approval:undefined})} }
  if(['st_tax_commerce','st_tax_quotes','st_tax_transactions'].includes(table)) return {...row,restored:1}
  if(table==='st_tax_exemptions') return {...row,restored:1}
  if(table==='st_tax_previews') return {...row,restored:1}
  if(table==='st_shop_carts') return {...row,...(row.guest_hash?{guest_hash:'restored:'+row.id}:{}),checkout_key:'restored:'+row.id,checkout_intent:null,review_digest:null}
  if(table==='st_customer_visitor_preferences') return {...row,id_hash:row.id_hash.startsWith('restored:')?row.id_hash:'restored:'+row.id_hash}
  if(table==='st_headless_customers') return {...row,operator_id:'restored:'+row.id}
  if(table==='st_headless_requests') return {...row,key_hash:'restored:'+row.id,commerce_key:'restored:'+row.id,checkout_hash:null,request_digest:''}
  if(table==='st_promotion_allocations') return {...row,customer_key:'restored:'+row.order_id}
  if(table==='st_uploads') return {...row,client:null}
  return row
 },
 requiredConfiguration: ['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM','PIER_ORIGIN','PIER_SESSION','PIER_CUSTOMER_ID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
};

export default portabilityPolicy;
