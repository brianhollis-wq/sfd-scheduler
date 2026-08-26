/**
 * Required configuration, checked where it is used.
 *
 * Authentication reads three environment variables, and one of them
 * (NEXT_PUBLIC_SUPABASE_ANON_KEY) is new as of the auth work — an existing
 * deployment will not have it. Missing, the Supabase client constructor throws
 * somewhere inside middleware, which turns every page including /login into a
 * blank 500 with a stack trace that names none of this.
 *
 * These helpers throw with the variable's name instead, so the deployment log
 * says what to add.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Authentication cannot start without it — see ` +
      `docs/authentication.md. In Vercel: Project Settings, Environment ` +
      `Variables, then redeploy.`,
    )
  }
  return value
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL')
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}
