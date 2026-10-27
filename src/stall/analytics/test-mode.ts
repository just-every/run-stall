import type { Bindings } from '../../auth.server'
import type { Order } from '../model'
/** Provider mode and native demo authority are server observations. */
export function analyticsTestMode(env:Bindings) {return env.RER_DEMO==='1'||/^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY??'')}
export function analyticsTestOrder(order:Order&{test?:boolean}) {return order.analyticsExcluded==='test'||order.test===true||order.payment?.source!=='staff'&&/^cs_test_/.test(order.payment?.sessionId??order.checkout?.id??'')}
export function analyticsTestSession(db:D1Database,order:Order) {return order.analytics?.sessionId?[db.prepare("UPDATE st_analytics_sessions SET value_json=json_set(value_json,'$.test',json('true')) WHERE id=?").bind(order.analytics.sessionId)]:[]}
