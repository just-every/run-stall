import { origin, session } from './provider-config.mjs';
import { addFixture, execute, ProviderRefusal, snapshot } from './provider-state.mjs';

const refuse = (code, status) => Response.json({ ok: false, error: { code, message: 'The isolated Pier fixture refused the request.' } }, { status });

/** Only Pier's paid/network boundary is replaced; egress stays denied by Base. */
export default {
 async fetch(request, { fixture }) {
  const url = new URL(request.url);
  if (url.origin !== origin || url.search || url.hash) return refuse('ORIGIN', 403);
  if (request.headers.get('cookie') !== session || request.headers.get('origin') !== origin || request.headers.has('authorization')) return refuse('AUTH', 401);
  try {
   addFixture(fixture);
   if (request.method === 'GET' && url.pathname === '/api/pier/state') return Response.json(snapshot());
   if (request.method !== 'POST' || url.pathname !== '/api/pier/commands') return refuse('NOT_FOUND', 404);
   if (!request.headers.get('content-type')?.startsWith('application/json')) return refuse('INPUT', 400);
   let command;
   try { command = await request.json(); } catch { return refuse('INPUT', 400); }
   return Response.json({ ok: true, result: execute(command) });
  } catch (error) {
   if (error instanceof ProviderRefusal) return refuse(error.code, error.status);
   // Unexpected bugs must fail the harness; never fabricate a successful receipt.
   throw error;
  }
 },
};
