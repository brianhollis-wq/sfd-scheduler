/**
 * Turning an authorization failure into a response.
 *
 * Route handlers all need the same three lines around their guard, and writing
 * them by hand in nine places is how one of them ends up subtly different.
 */

import { NextResponse } from 'next/server'
import {
  requireAdmin, requireUser,
  UnauthenticatedError, ForbiddenError,
  type AppUser,
} from './session'

/**
 * Run a route handler with the caller's authorization already established.
 *
 * Usage:
 *   export const GET = withUser(async (req, user) => { ... })
 *   export const POST = withAdmin(async (req, user) => { ... })
 *
 * The handler receives the resolved user, so anything it writes can record who
 * did it without looking the caller up a second time.
 */
function guarded<T extends Request>(
  resolve: () => Promise<AppUser>,
  handler: (req: T, user: AppUser) => Promise<Response>,
) {
  return async (req: T): Promise<Response> => {
    let user: AppUser
    try {
      user = await resolve()
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 })
      }
      throw err
    }
    return handler(req, user)
  }
}

/** Any signed-in, authorized user may call this. */
export function withUser<T extends Request>(
  handler: (req: T, user: AppUser) => Promise<Response>,
) {
  return guarded<T>(requireUser, handler)
}

/** Only an administrator may call this. */
export function withAdmin<T extends Request>(
  handler: (req: T, user: AppUser) => Promise<Response>,
) {
  return guarded<T>(requireAdmin, handler)
}

/**
 * The server-action equivalent.
 *
 * Actions return result objects rather than HTTP responses, and the pages that
 * call them already render `{ error }`, so a rejection is reported the same way
 * any other failure is instead of throwing into an error boundary.
 *
 * Returns null when the caller may proceed.
 */
export async function adminGate(): Promise<{ error: string } | null> {
  try {
    await requireAdmin()
    return null
  } catch (err) {
    if (err instanceof UnauthenticatedError) return { error: 'Not signed in.' }
    if (err instanceof ForbiddenError)       return { error: err.message }
    throw err
  }
}
