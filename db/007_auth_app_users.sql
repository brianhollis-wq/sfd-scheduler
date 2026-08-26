-- ─────────────────────────────────────────────────────────────────────────────
-- 007 — Authentication: who may sign in, and what they may do
--
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- Until now the application had no identity at all: one service-role key, no
-- login, every request fully privileged. That is workable for a board one
-- person drives and unworkable for a system of record, where a row has to
-- record who changed it.
--
-- This file adds the authorization side. Authentication itself is Supabase
-- Auth (magic link to the member's city address) — auth.users is managed by
-- Supabase and is not created here.
--
-- app_users is the allowlist. Being in auth.users is not enough to use the
-- application; an active app_users row is what grants access. That separation
-- is deliberate:
--
--   * Access can be revoked without deleting an identity, so the audit trail
--     of what that person did survives.
--   * Sign-in is refused for anyone not on the roster even if they somehow
--     obtain an auth identity.
--   * The link to employees.id is what lets a future leave request or trade
--     be attributed to a member rather than to an email address.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: the table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  -- Email is the identity the magic link is sent to, and the join key back to
  -- auth.users. Lowercased by a constraint below rather than by trusting every
  -- call site to do it.
  email         text PRIMARY KEY,

  -- Filled in the first time this person completes a sign-in. Null means
  -- invited but never signed in, which is a useful state to be able to see.
  user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Who this login *is*. Null is allowed for an administrator who is not on
  -- the department roster; every firefighter account should have one.
  employee_id   integer REFERENCES employees(id) ON DELETE SET NULL,

  -- 'admin'  — full edit: publish schedules, import, record callbacks
  -- 'viewer' — read the board and the schedule, change nothing
  --
  -- Deliberately text with a CHECK rather than an enum. The officer and
  -- battalion-chief tiers are coming (see docs/replacing-crewsense.md) and
  -- widening a CHECK is a one-line ALTER, while adding an enum value is not
  -- reversible.
  role          text NOT NULL DEFAULT 'viewer',

  -- Scope for the tiers that do not exist yet: a company officer over one
  -- apparatus, a BC over a battalion. Null means unscoped, which is what both
  -- current roles are. Present now so adding those tiers is a policy change
  -- rather than a migration.
  scope_type    text,
  scope_id      text,

  -- Revocation without deletion. A member who leaves is deactivated, not
  -- removed, so their name still resolves on the days they worked.
  is_active     boolean NOT NULL DEFAULT true,

  invited_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Constraints added separately so re-running the file over an existing table
-- converges on the same shape.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_email_lowercase') THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_email_lowercase
      CHECK (email = lower(email));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_role_known') THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_role_known
      CHECK (role IN ('admin', 'viewer'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_scope_paired') THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_scope_paired
      CHECK ((scope_type IS NULL) = (scope_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_users_user_id_idx     ON app_users (user_id);
CREATE INDEX IF NOT EXISTS app_users_employee_id_idx ON app_users (employee_id);

-- ── Step 2: row level security ───────────────────────────────────────────────
-- The application reads this table with the service-role key, which bypasses
-- RLS. The policy matters anyway: it means that if the anon key is ever used
-- against this table — from the browser, or by a future client-side feature —
-- a signed-in person can see their own row and nothing else. The allowlist
-- must never be enumerable.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_users_self_read ON app_users;
CREATE POLICY app_users_self_read ON app_users
  FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT, UPDATE or DELETE policy is defined, so under RLS nobody may write
-- this table. Membership changes go through the service role deliberately —
-- granting access is an administrative act, not a self-service one.

-- ── Step 3: keep updated_at honest ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_users_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_touch ON app_users;
CREATE TRIGGER app_users_touch
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION app_users_touch_updated_at();

-- ── Step 4: seed the first administrator ─────────────────────────────────────
-- Without this nobody can sign in, including whoever runs this file: sign-in
-- requires an active app_users row, and only the service role may create one.
--
-- Linked to the employee record by email where the address matches, so the
-- account is attributed to a person rather than standing alone.
-- The employee link is resolved by address first and falls back to the id from
-- the personnel master, checked against the name so a reused id cannot attach
-- this account to the wrong person. If neither matches, the account is still
-- created — it just is not tied to an employee record yet.
INSERT INTO app_users (email, employee_id, role, invited_by)
SELECT 'bhollis@cityofsalem.net',
       COALESCE(
         (SELECT e.id FROM employees e
           WHERE lower(e.email) = 'bhollis@cityofsalem.net' LIMIT 1),
         (SELECT e.id FROM employees e
           WHERE e.id = 3107
             AND lower(e.first_name) = 'brian'
             AND lower(e.last_name)  = 'hollis' LIMIT 1)
       ),
       'admin',
       'db/007'
ON CONFLICT (email) DO UPDATE
  SET role        = 'admin',
      is_active   = true,
      employee_id = COALESCE(app_users.employee_id, EXCLUDED.employee_id);

-- ── Step 5: verify ───────────────────────────────────────────────────────────
SELECT 'columns' AS check, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'app_users'
 ORDER BY ordinal_position;

SELECT 'rls' AS check, relname, relrowsecurity
  FROM pg_class WHERE relname = 'app_users';

SELECT 'policies' AS check, policyname, cmd
  FROM pg_policies
 WHERE schemaname = current_schema() AND tablename = 'app_users';

-- Expect one admin. employee_id null means no employees row carries that
-- address — the account still works, it is just not tied to a person yet.
SELECT 'accounts' AS check, a.email, a.role, a.is_active, a.employee_id,
       e.first_name, e.last_name
  FROM app_users a
  LEFT JOIN employees e ON e.id = a.employee_id
 ORDER BY a.email;
