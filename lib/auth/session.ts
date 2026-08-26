/**
 * Who is making this request, and what are they allowed to do.
 *
 * Three clients now exist and they are not interchangeable:
 *
 *   createAdminClient()   lib/supabase/admin.ts — service-role key. Bypasses
 *                         row level security entirely. Used for all domain
 *                         data. It has no idea who the caller is, which is
 *                         exactly why every entry point must consult this file
 *                         before using it.
 *   createServerClient()  below — the caller's own session, read from cookies.
 *                         Used only to answer "who is this".
 *   createBrowserClient() lib/auth/client.ts — the browser half of the same
 *                         session, needed so signing out clears the cookie.
 *
 * The authorization model is deliberately not "is there a session". Having an
 * auth.users identity proves someone controls a mailbox; it does not mean the
 * department has given them access. An active row in app_users does. Access is
 * revoked by deactivating that row, never by deleting the identity, so the
 * record of what a person did survives their leaving.
 */

import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
import { supabaseUrl, supabaseAnonKey } from './env'
import { displayName } from '@/lib/employees/display'

export type AppRole = 'admin' | 'viewer'

export interface AppUser {
  email:      string
  userId:     string
  employeeId: number | null
  role:       AppRole
  /** Display name from the linked employee record, when there is one. */
  fullName:   string | null
}

/**
 * A Supabase client bound to the caller's cookies.
 *
 * Server components cannot write cookies, so the setters swallow the error
 * Next.js throws there. Session refresh happens in middleware, which can write
 * them; without that this would silently stop refreshing and people would be
 * logged out an hour later with no explanation.
 */
export function createSessionClient() {
  const cookieStore = cookies()

  return createServerClient(
    supabaseUrl(),
    supabaseAnonKey(),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try { cookieStore.set({ name, value, ...options }) } catch { /* read-only in RSC */ }
        },
        remove(name: string, options: CookieOptions) {
          try { cookieStore.set({ name, value: '', ...options }) } catch { /* read-only in RSC */ }
        },
      },
    },
  )
}

/**
 * The signed-in, authorized user, or null.
 *
 * Uses getUser() rather than getSession(). getSession() returns whatever the
 * cookie claims without verifying it, which is fine for rendering and not fine
 * for a decision about access; getUser() checks the token against the auth
 * server.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = createSessionClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user?.email) return null

  return lookupAppUser(user.email, user.id)
}

/**
 * Resolve an email to its authorization record.
 *
 * Read with the service role because app_users denies reads under RLS to
 * everyone but the row's owner, and this has to work on the sign-in path
 * before a session exists.
 *
 * On first successful sign-in the auth id is written back, which is what turns
 * an invitation into an account. Any mismatch — a deactivated row, no row at
 * all — returns null, and every caller treats null as "not allowed".
 */
export async function lookupAppUser(
  email: string,
  userId?: string,
): Promise<AppUser | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from(TABLES.appUsers)
    .select('email, user_id, employee_id, role, is_active')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (error || !data || !data.is_active) return null

  const row = data as {
    email: string; user_id: string | null; employee_id: number | null
    role: string; is_active: boolean
  }

  // First sign-in: bind the identity to the invitation.
  if (userId && row.user_id !== userId) {
    await admin.from(TABLES.appUsers).update({ user_id: userId }).eq('email', row.email)
  }

  let fullName: string | null = null
  if (row.employee_id != null) {
    const { data: emp } = await admin
      .from(TABLES.employees)
      .select('first_name, last_name, nickname')
      .eq('id', row.employee_id)
      .maybeSingle()
    if (emp) {
      fullName = displayName(emp as { first_name: string; last_name: string; nickname: string | null })
    }
  }

  return {
    email:      row.email,
    userId:     userId ?? row.user_id ?? '',
    employeeId: row.employee_id,
    role:       row.role === 'admin' ? 'admin' : 'viewer',
    fullName,
  }
}

/** Is this address allowed to be sent a sign-in link at all? */
export async function isInvited(email: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from(TABLES.appUsers)
    .select('email')
    .eq('email', email.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}

// ── Guards ────────────────────────────────────────────────────────────────────
//
// Thrown rather than returned so a caller cannot forget to check the result and
// carry on with the service-role client. Route handlers convert these to 401
// and 403; pages let middleware redirect instead.

export class UnauthenticatedError extends Error {
  constructor() { super('Not signed in'); this.name = 'UnauthenticatedError' }
}
export class ForbiddenError extends Error {
  constructor(message = 'Not permitted') { super(message); this.name = 'ForbiddenError' }
}

/** Any signed-in, authorized user. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthenticatedError()
  return user
}

/** A user who may change data. */
export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser()
  if (user.role !== 'admin') throw new ForbiddenError('Administrator access required')
  return user
}
