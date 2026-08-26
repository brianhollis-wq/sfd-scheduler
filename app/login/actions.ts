'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSessionClient, isInvited } from '@/lib/auth/session'

export interface SignInState {
  sent?:  boolean
  error?: string
}

/**
 * Send a sign-in link.
 *
 * Two rules shape this:
 *
 * 1. Only addresses on the allowlist get a link. `shouldCreateUser: false`
 *    would leave that to Supabase, but the allowlist is ours, not Supabase's —
 *    an identity can exist for someone whose access was revoked.
 *
 * 2. The reply never says whether the address is on the list. Saying "unknown
 *    address" turns this form into a way to discover who works here, which is
 *    a roster of firefighters' addresses. Everyone gets the same answer and the
 *    link simply does not arrive.
 */
export async function requestSignInLinkAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!raw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    return { error: 'Enter a valid email address.' }
  }

  // Deliberately not reported to the caller — see rule 2.
  if (!(await isInvited(raw))) {
    return { sent: true }
  }

  const origin = headers().get('origin')
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? 'http://localhost:3000'

  const supabase = createSessionClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: raw,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  })

  if (error) {
    // Log the real reason; show a generic one. A rate-limit message would
    // still tell an outsider the address is real.
    console.error('[auth] signInWithOtp failed:', error.message)
    return { error: 'Could not send the sign-in link. Try again in a minute.' }
  }

  return { sent: true }
}

/** Clear the session and return to the login page. */
export async function signOutAction(): Promise<never> {
  const supabase = createSessionClient()
  await supabase.auth.signOut()
  redirect('/login')
}
