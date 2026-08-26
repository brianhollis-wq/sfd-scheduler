/**
 * Who is signed in, and the way out.
 *
 * Rendered from the root layout so it is present on every page, and skipped on
 * the login route where there is nothing to report. It reads the session
 * itself rather than taking it as a prop, so no page has to remember to pass
 * one down.
 */

import { getCurrentUser } from '@/lib/auth/session'
import { signOutAction } from '@/app/login/actions'

export default async function SessionBar() {
  const user = await getCurrentUser()
  if (!user) return null

  return (
    <div className="border-b border-zinc-800/60 bg-[#060f18]">
      <div className="mx-auto max-w-[1600px] px-4 py-1.5 flex items-center justify-end gap-3">
        <span className="text-zinc-500 font-mono text-[10px] tracking-wider">
          {user.fullName ?? user.email}
        </span>
        {user.role === 'admin' && (
          <span className="text-[9px] font-mono font-bold tracking-widest text-[#c9a84c] border border-[#c9a84c]/30 bg-[#c9a84c]/10 rounded px-1.5 py-0.5">
            ADMIN
          </span>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-zinc-500 hover:text-zinc-300 font-mono text-[10px] tracking-wider underline underline-offset-2 transition-colors"
          >
            SIGN OUT
          </button>
        </form>
      </div>
    </div>
  )
}
