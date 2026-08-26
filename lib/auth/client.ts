/**
 * The browser half of the session.
 *
 * Only needed so sign-out can clear the cookie from the client. Everything that
 * decides access happens on the server — a browser client can be lied to.
 */
'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )  // NEXT_PUBLIC_ values are inlined at build time; a missing one surfaces
     // on the server first, via lib/auth/env.ts.
}
