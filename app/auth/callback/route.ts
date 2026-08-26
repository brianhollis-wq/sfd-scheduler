/**
 * GET /auth/callback
 *
 * Where the emailed link lands. Exchanges the one-time code for a session
 * cookie, then checks the allowlist again.
 *
 * The second check is not redundant. A link is valid for minutes to an hour;
 * access can be revoked in between, and a revoked member must not be able to
 * complete a sign-in with a link already in their inbox. If the allowlist says
 * no, the session just created is torn down again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSessionClient, lookupAppUser } from '@/lib/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url  = new URL(req.url)
  const code = url.searchParams.get('code')
  // Only same-origin paths are honoured, so a crafted link cannot use this as
  // an open redirect.
  const raw  = url.searchParams.get('next') ?? '/'
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = createSessionClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user?.email) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', url.origin))
  }

  const appUser = await lookupAppUser(data.user.email, data.user.id)
  if (!appUser) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=no_access', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
