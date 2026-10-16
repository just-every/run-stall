import { authConfig, runtimeBindings } from '../auth.server'
import { AuthStore } from '../modules/operator-auth/accounts/store.mjs'
import { configure } from '../modules/operator-auth/config.mjs'
import { devGate } from '../modules/operator-auth/dev-gate.mjs'
import { managedInstallation } from '../modules/operator-auth/dev/index.mjs'
import { registerDevAdmission } from '../modules/operator-auth/dev-admission.mjs'
import { isActiveOperator } from '../modules/operator-auth/accounts/roles.mjs'
import { hashToken, opaqueToken } from '../modules/operator-auth/crypto.mjs'
import { readCookie, sessionCookie, escapeHtml } from '../modules/operator-auth/http.mjs'
import { safeReturnTo } from '../modules/operator-auth/policy.mjs'
import { acceptDevInvitation } from './invitation.mjs'

// Stall's local-only extension uses Base's key gate and native session store.
// Base's pinned auth copies stay unchanged; production never imports this file.
export function withInvitedPeople(worker) {
 return { ...worker, async fetch(request, original, execution) {
  const env = runtimeBindings(original), url = new URL(request.url)
  const gate = devGate({ key: env.RER_DEV_KEY, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true' })
  if (managedInstallation(env) || !gate || env.RER_DEV_IDENTITY === 'off' || !await gate.admits(request)) return worker.fetch(request, original, execution)
  registerDevAdmission(r => gate.admits(r))
  const config = configure(authConfig(env)), store = new AuthStore(env.DB)
  const hash = token => hashToken(config.SESSION_SECRET, 'session', token)
  if (url.pathname === '/auth/dev/enter' && request.method === 'GET') {
   const as = url.searchParams.get('as') ?? ''
   const person = await store.byEmail(as.toLowerCase())
   if (person && ['active', 'invited'].includes(person.status)) {
    if (person.role !== 'owner' && await store.domainRule(person.email.split('@')[1])) return new Response('Sign-in refused', { status: 403 })
    const headers = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', location: safeReturnTo(url.searchParams.get('returnTo')) })
    if (!(request.headers.get('cookie') ?? '').includes(`${gate.cookieName}=`)) headers.append('set-cookie', await gate.setCookie())
    if (person.status === 'invited') {
     const accepted = await acceptDevInvitation({ operator: person, store, config, hash })
     if (!accepted) return new Response('This invitation is no longer available. Ask the owner to invite you again.', { status: 403 })
     headers.append('set-cookie', sessionCookie(accepted.token, config, config.sessionSeconds))
    } else {
     if (!isActiveOperator(person, config.allowList)) return new Response('Sign-in refused', { status: 403 })
     const cookie = readCookie(request, config), current = cookie ? await store.session(await hash(cookie), Date.now()) : null
     if (current?.kind !== 'dev' || current.operator.id !== person.id) {
      const token = opaqueToken(), session = { id: crypto.randomUUID(), hash: await hash(token), expiresAt: Date.now() + config.sessionSeconds * 1000 }
      const issued = await store.issue({ operatorId: person.id, expectedVersion: person.version, session, now: Date.now(), kind: 'dev' })
      if (!issued) return new Response('The account changed. Try signing in again.', { status: 409 })
      headers.append('set-cookie', sessionCookie(token, config, config.sessionSeconds))
     }
    }
    return new Response(null, { status: 303, headers })
   }
  }
  const response = await worker.fetch(request, original, execution)
  if (request.method !== 'GET' || response.status !== 200 || !['/signin', '/__dev/personas'].includes(url.pathname)) return response
  const people = (await store.statement("SELECT email,display_name AS displayName FROM oa_operators WHERE status IN ('active','invited') ORDER BY display_name,email").all()).results
  const headers = new Headers(response.headers); headers.delete('content-length')
  if (url.pathname === '/__dev/personas') {
   const declared = await response.json()
   const known = new Set(declared.map(person => person.email))
   return Response.json([...declared, ...people.filter(person => !known.has(person.email)).map(person => ({ ...person, as: person.email }))], { headers })
  }
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
  const links = people.filter(person => person.email !== config.OWNER_EMAIL).map(person => `<a class="action" href="/auth/dev/enter?as=${encodeURIComponent(person.email)}&amp;returnTo=${encodeURIComponent(returnTo)}">Continue as ${escapeHtml(person.displayName || person.email)}</a>`).join('')
  const html = await response.text()
  if (!html.includes('</main>')) throw new Error('The local sign-in frame is missing its main element.')
  return new Response(html.replace('</main>', `<div class="stack">${links}</div></main>`), { status: response.status, headers })
 } }
}
