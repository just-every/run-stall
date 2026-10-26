export async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', extra: Record<string, string> = {}): Promise<T> {
  let response: Response
  try { response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
  catch { throw new Error('Could not reach Stall. Check your connection and try again.') }
  const data: unknown = await response.json().catch(() => null)
  const failure = data && typeof data === 'object' && 'error' in data ? data.error : null
  const detail = typeof failure === 'string' ? failure : failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string' ? failure.message : null
  if (!response.ok || failure) throw new Error(detail ?? `Request failed (${response.status}). Try again.`)
  if (data === null) throw new Error('Stall returned an unreadable response. Try again.')
  return data as T
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
