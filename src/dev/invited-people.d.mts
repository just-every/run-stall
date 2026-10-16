import type { Bindings } from '../auth.server'
/** Preserve the seed Worker handler while adding Stall's local-only account entry. */
export function withInvitedPeople<Handler extends ExportedHandler<Bindings>>(worker: Handler): Handler
