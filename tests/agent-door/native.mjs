// Only assertions authored in this fixture package qualify for safe diagnostics.
export class NativeAssertionError extends Error {}

export function requireValue(condition, message) {
 if (!condition) throw new NativeAssertionError(message);
}

/** The harness's request function refuses every origin except the actual app. */
export function nativeOwner({ request, origin, cookie }) {
 requireValue(typeof cookie === 'string' && cookie.length > 0, 'Native fixtures require the owner session.');
 return async (path, payload) => {
  const response = await request(new URL(path, origin).href, {
   method: payload === undefined ? 'GET' : 'POST', redirect: 'manual',
   headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
   ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  // Never include provider errors, owner cookies or native records in diagnostics.
  requireValue(response.ok, `Native fixture request failed with HTTP ${response.status}.`);
  const value = await response.json();
  requireValue(value && !value.error, 'Native fixture request did not complete.');
  return value;
 };
}

export async function command(owner, type, payload) {
 const value = await owner('/api/stall/commands', { type, payload });
 requireValue(value.result && typeof value.result === 'object', 'Native command omitted its result.');
 return value.result;
}
