# Authentication

Sign-in is a magic link sent to the member's city email address. There are no
passwords to set, reset, or share, and receiving the link proves the person
controls a city mailbox.

## The model

Two things have to be true before a request is allowed:

1. **A valid Supabase auth session.** Proves someone controls that mailbox.
2. **An active row in `app_users`.** Proves the department has granted access.

The second is not implied by the first. An identity can outlive access — someone
transfers out, or an account is created and later revoked. Keeping them separate
means access is withdrawn by setting `is_active = false`, never by deleting the
identity, so the record of what that person did survives.

Roles today are `admin` (full edit) and `viewer` (read the board, change
nothing). `app_users` also carries nullable `scope_type` / `scope_id` columns,
unused now, so the company-officer and battalion-chief tiers can be added as a
policy change rather than a migration.

## Where the checks happen

**`middleware.ts`** refreshes the session cookie on every matched request and
redirects unauthenticated page requests to `/login`, remembering the intended
destination. Refresh is the part that is easy to overlook: access tokens are
short-lived and server components cannot write cookies, so without middleware
people are signed out an hour after signing in with no explanation.

**Every API route and server action checks for itself.** Middleware runs on
matched paths, and a mistake in the matcher would open a route silently. The
route guards are what actually protect the data; middleware is about the
experience of being redirected. This is verified — see below.

| Surface | Requires |
|---|---|
| `POST /api/assignments/publish` | admin |
| `POST /api/parse-pdf` | admin |
| `GET /api/diagnostics/assignments` | admin |
| `GET /api/roster`, `/api/employees/search`, `/api/callback-eligibility`, `/api/mot-eligibility`, `/api/debit-days` | signed in |
| `commitScheduleAction`, `recordCallbackAction`, `setLastCallbackDateAction`, `recordMandateAction`, `setLastMandatoryDateAction` | admin |
| `GET /api/version` | public (build identity) |

The middleware matcher is written as an exclusion rather than a list of
protected paths, so a page added later is protected by default.

## Two deliberate refusals to leak

The login form gives the same answer whether or not the address is on the
allowlist. Reporting "unknown address" would turn it into a way to discover who
works at the department — a roster of firefighters' email addresses.

`/auth/callback` re-checks the allowlist after exchanging the code. A link is
valid for up to an hour, access can be revoked in between, and a revoked member
must not complete a sign-in with a link already sitting in their inbox. If the
allowlist says no, the session just created is torn down.

## Setup

### 1. Run the migration

`db/007_auth_app_users.sql` creates `app_users`, enables RLS on it, and seeds the
first administrator (`bhollis@cityofsalem.net`, linked to employee 3107 by id
and name). Without that seed nobody can
sign in, including whoever runs the file — sign-in requires an active row, and
only the service role may create one.

### 2. Environment variables

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is **new**; the other two already exist.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, the `anon` / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the `service_role` key — server only, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | optional; the production URL, used to build the magic-link redirect when the request carries no `Origin` header |

### 3. Supabase dashboard

Under **Authentication → URL Configuration**, add the callback to the redirect
allowlist or the emailed link will refuse to complete:

```
https://sfd-scheduler.vercel.app/auth/callback
http://localhost:3000/auth/callback
```

Set **Site URL** to the production URL.

Email delivery uses Supabase's built-in sender by default, which is rate-limited
and not intended for production volume. For a department-wide rollout, configure
a real SMTP sender under **Authentication → Emails**.

## Granting access

There is no self-service sign-up, by design. Adding someone is an administrative
act performed with the service role:

The `employees` table has no email column — the personnel master carries city
addresses but the database does not — so `app_users.email` is the only place a
sign-in address is stored, and the employee is identified by id. The name check
is there so a mistyped id cannot quietly attach an account to the wrong person:
if it does not match, the row is still created with no employee link rather
than the wrong one.

```sql
INSERT INTO app_users (email, employee_id, role, invited_by)
SELECT 'jsmith@cityofsalem.net',
       (SELECT e.id FROM employees e
         WHERE e.id = 1234
           AND lower(e.first_name) = 'john'
           AND lower(e.last_name)  = 'smith'),
       'viewer',
       'brian'
ON CONFLICT (email) DO UPDATE
  SET is_active   = true,
      employee_id = COALESCE(app_users.employee_id, EXCLUDED.employee_id);
```

Find the id first if you don't know it:

```sql
SELECT id, first_name, last_name, rank FROM employees
 WHERE lower(last_name) = 'smith' ORDER BY first_name;
```

Revoking:

```sql
UPDATE app_users SET is_active = false WHERE email = 'jsmith@cityofsalem.net';
```

Never `DELETE` — that discards the link between the account and what it did.

## What this does not yet do

**Domain tables are still read and written with the service-role key**, which
bypasses row level security. That is safe today because there is no path to
them that does not pass a guard, and it is verified below. But it means the
database itself is not enforcing the rules — the application is. Moving the
domain tables onto RLS with `auth.uid()` policies is the follow-up, and it is a
prerequisite for members reaching their own data directly.

**Nothing records who changed a row.** The guards resolve the acting user and
hand it to each route, so the information is available; `daily_assignments` and
the OT lists do not yet store it. That should land with the first workflow that
needs an audit trail (leave requests).

## Verification

Run against a built server with no session:

- All 8 API routes return **401** to anonymous callers; `/api/version` returns
  200.
- All 7 pages redirect (**307**) to `/login?next=…` preserving the destination.
- **With `middleware.ts` deleted entirely and the app rebuilt, every API route
  still returns 401** — proving the route guards, not the middleware, are what
  protect the data.

`db/007` was executed against a local PostgreSQL 16 instance with a stub `auth`
schema: it is idempotent across re-runs, and its constraints reject an uppercase
email, an unknown role, a half-populated scope pair, a non-existent employee id,
and a `user_id` absent from `auth.users`.
