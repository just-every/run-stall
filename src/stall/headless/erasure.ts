/** Run before the native commerce contact scrub, inside its guarded transaction.
 * Match both the verified current account and historical commerce ownership, so
 * changing a native email does not leave an old basket or request fingerprint. */
export function headlessErasureStatements(db:D1Database,email:string):D1PreparedStatement[] {
 return [db.prepare(`DELETE FROM st_headless_customers WHERE lower(email)=? OR operator_id IN (SELECT id FROM oa_operators WHERE lower(email)=?) OR id IN (SELECT h.customer_id FROM st_headless_orders h JOIN st_orders o ON o.id=h.order_id WHERE lower(json_extract(o.value_json,'$.customerEmail'))=?)`).bind(email,email,email)]
}
