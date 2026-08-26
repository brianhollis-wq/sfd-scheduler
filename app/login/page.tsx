import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Request a new one below.',
  invalid_link: 'That sign-in link has expired or was already used. Request a new one below.',
  no_access:    'That account does not have access to this application. Contact the staffing office.',
  session:      'Your session ended. Sign in again to continue.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string }
}) {
  // Already signed in — nothing to do here.
  const user = await getCurrentUser()
  if (user) redirect(searchParams.next ?? '/')

  const error = searchParams.error ? ERRORS[searchParams.error] ?? null : null

  return (
    <div className="min-h-screen bg-[#091520] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-[#c9a84c] font-mono font-bold tracking-[0.2em] text-lg">
            SALEM FIRE
          </h1>
          <p className="text-zinc-500 font-mono text-[10px] tracking-[0.18em] mt-1">
            STAFFING SCHEDULE
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3">
            <p className="text-amber-200/90 text-xs font-mono leading-relaxed">{error}</p>
          </div>
        )}

        <LoginForm next={searchParams.next} />

        <p className="text-zinc-600 text-[10px] font-mono text-center mt-6 leading-relaxed">
          Access is granted by the staffing office.
          <br />
          Sign in with your city email address.
        </p>
      </div>
    </div>
  )
}
