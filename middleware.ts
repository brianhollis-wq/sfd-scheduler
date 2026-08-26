/**
 * Session refresh and the first line of the access gate.
 *
 * Two jobs, and the first is easy to overlook:
 *
 * 1. Refresh the Supabase session cookie. Access tokens are short-lived, and
 *    server components cannot write cookies — only middleware can. Without
 *    this, people are signed out an hour after signing in with no explanation.
 *
 * 2. Send unauthenticated requests to /login, remembering where they were
 *    going so the link returns them there.
 *
 * This is a gate, not *the* gate. Middleware runs on matched paths and can be
 * bypassed by a mistake in the matcher, so every API route and server action
 * checks for itself as well (see lib/auth/session.ts). Defence here is about
 * the experience of being redirected; defence there is what actually protects
 * the data.
 *
 * Note this only asks whether a valid auth session exists. Whether that person
 * is on the allowlist is answered by getCurrentUser(), which reads app_users —
 * a database round trip that has no business running on every asset request.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/** Paths reachable without signing in. */
const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/api/version',    // build identity, deliberately public
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    },
  )

  // Refreshes the token and writes the new cookie through the setters above.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    // API callers get a status code; a redirect to an HTML login page would
    // arrive at fetch() as a confusing 200 full of markup.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search   = ''
    url.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  /**
   * Everything except Next.js internals and static assets. Written as an
   * exclusion rather than a list of protected paths on purpose: a new page
   * added later is protected by default, where a list would leave it open
   * until somebody remembered to add it.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
