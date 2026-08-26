'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { requestSignInLinkAction, type SignInState } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-[#c9a84c] px-4 py-2.5 text-[#091520] font-mono font-bold text-xs tracking-widest disabled:opacity-50 hover:bg-[#d8b95c] transition-colors"
    >
      {pending ? 'SENDING…' : 'SEND SIGN-IN LINK'}
    </button>
  )
}

export default function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState<SignInState, FormData>(
    requestSignInLinkAction,
    {},
  )

  // The success message is intentionally the same whether or not the address is
  // on the allowlist. See requestSignInLinkAction.
  if (state.sent) {
    return (
      <div className="rounded-lg border border-green-700/40 bg-green-950/20 px-4 py-4 text-center">
        <p className="text-green-300 font-mono text-xs font-bold tracking-widest mb-2">
          CHECK YOUR EMAIL
        </p>
        <p className="text-zinc-400 text-xs leading-relaxed">
          If that address has access, a sign-in link is on its way. The link is
          good for one use.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label
          htmlFor="email"
          className="block text-zinc-500 font-mono text-[10px] tracking-[0.18em] mb-1.5"
        >
          CITY EMAIL
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="name@cityofsalem.net"
          className="w-full rounded-md bg-[#0d1b2a] border border-zinc-700/60 px-3 py-2.5 text-zinc-100 font-mono text-sm placeholder:text-zinc-600 focus:border-[#c9a84c]/60 focus:outline-none"
        />
      </div>

      {state.error && (
        <p className="text-red-400 text-xs font-mono">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  )
}
