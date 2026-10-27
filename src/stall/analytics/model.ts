export type AnalyticsKind='visit'|'product_view'|'add_to_cart'|'checkout'
export type AnalyticsAttribution={source:string;medium:string;campaign?:string;content?:string;referrer?:string;landingPage:string;device:'mobile'|'tablet'|'desktop'|'unknown';region?:string;location?:string;regionSource:'visitor_selected_unverified';consent:'granted';policyVersion:string;attributionModel:'last_non_direct_click';attributionWindowDays:30;attributedAt:string}
export type AnalyticsSnapshot=AnalyticsAttribution&{sessionId:string;visitorHash?:string;restored?:true}
export type AnalyticsSession=AnalyticsAttribution&{privacyHash:string;channel?:'online'|'buy_button'|'checkout_link';restored?:true}
export const analyticsSessionMinutes=30
export const analyticsRetentionDays=30
export const analyticsCookieNames={visitor:'stall_analytics_visitor',session:'stall_analytics_session'} as const
export const analyticsIdentifier=/^[a-f0-9]{64}$/
export function analyticsCookie(request:Request,name:string) { const value=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);return value&&analyticsIdentifier.test(value)?value:undefined }
export const randomAnalyticsId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('')
export function analyticsCookieHeader(name:string,value:string,origin:string,maxAge:number) {return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(origin).protocol==='https:'?'; Secure':''}`}
export function clearAnalyticsCookies(headers:Headers,origin:string) {for(const name of Object.values(analyticsCookieNames))headers.append('set-cookie',analyticsCookieHeader(name,'',origin,0))}

/** Commercial source labels exclude reusable browser correlation identifiers. */
export function analyticsLabels(value:AnalyticsSnapshot|undefined) {if(!value)return undefined;const {visitorHash:_,sessionId:__,...labels}=value;return labels}
