import { withDemo } from './modules/demo/index.mjs'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { stallResponse, stallScheduled } from './stall/api'
import { toolsResponse } from './stall/tools'
import { databaseReadiness } from './stall/operations'
import { seedDemo } from './demo'
import { unknownProductPage } from './stall/shop-pages'
import { agentResponse, stallBusinessSettings } from './stall/agent-door'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', async (context) => {
  const database = await databaseReadiness(context.env)
  return context.json({ ...deploymentHealth(context.env), ok: database.ok, status: database.ok ? 'ok' : 'unavailable', database: { ok: database.ok, checkedAt: database.checkedAt } }, database.ok ? 200 : 503)
})

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo<Bindings, ExportedHandler<Bindings>>({
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const business = await stallBusinessSettings(env).handle(request)
    if (business) return business
    const door = await agentResponse(request,env)
    if (door) return door
    const tools = await toolsResponse(request, env)
    if (tools) return tools
    const stall = await stallResponse(request, env)
    if (stall) return stall
    const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => {
      const document = noTransform(await start.fetch(request))
      return await unknownProductPage(request, runtimeBindings(env)) ? new Response(document.body, { status: 404, headers: document.headers }) : document
    }))
  },
  // Every minute: confirm Checkout payments Stripe has taken but no webhook reported.
  async scheduled(_event, env, execution) { execution.waitUntil(stallScheduled(env)) },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
