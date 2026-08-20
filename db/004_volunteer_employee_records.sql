-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Employee record for the volunteer post
--
-- READ THIS BEFORE RUNNING. It is the only migration that creates a person.
--
-- daily_assignments identifies a person solely by employee_id, a foreign key
-- into employees. Someone with no row there cannot be placed on the board at
-- all. Two people in the personnel master have no payroll ID:
--
--   Peggy Lowry      volunteer, Training Division   — on the roster (TR-SA)
--   Brian Clothier   contract Medical Director      — not on the roster
--
-- Only Lowry is handled here, because only she is rostered.
--
-- She is identified as VSA-C6, stored as her badge number and shown on the
-- board as her call sign. That cannot be her employees.id: the column is an
-- integer and daily_assignments.employee_id is an integer foreign key into it.
-- So she also gets the numeric key 9843 for the foreign key alone.
--
-- WHY THIS IS NOT A PLAIN INSERT
--
-- Two earlier attempts each failed on a different NOT NULL column — first
-- rank, then classification — because this table has many required columns and
-- listing them by guesswork means one round trip per column.
--
-- So Step 2 does not name them. It copies every column that is required and
-- has no default from an existing employee, then overrides only the four
-- fields that identify the person. Whatever the table requires is satisfied by
-- construction.
--
-- The template is deliberately another administrative civilian — Gina Cepeda,
-- confirmed present — so the copied classification and rank describe a
-- non-sworn staff member rather than a firefighter.
--
-- Only columns that are NOT NULL *and* have no default are copied. Everything
-- optional stays null, so no personal detail — email, phone, address, hire
-- date — is carried across from the template onto Peggy's record.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: look before inserting ────────────────────────────────────────────

-- 1a. Exactly the columns Step 2 will copy. Anything person-specific appearing
--     in this list should be added to the override in Step 2 rather than
--     inherited from the template.
SELECT 'copied from template' AS check, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'employees'
   AND is_nullable = 'NO'
   AND column_default IS NULL
   AND is_generated = 'NEVER'
   AND is_identity  = 'NO'
 ORDER BY ordinal_position;

-- 1b. What the template row holds for those columns.
SELECT 'template' AS check, id, first_name, last_name, rank
  FROM employees
 WHERE id = 2459;

-- 1c. Confirm 9843 is free.
SELECT 'id check' AS check,
       count(*) FILTER (WHERE id = 9843) AS id_9843_taken,
       max(id) AS highest_id
  FROM employees;

-- ── Step 2: create the record ────────────────────────────────────────────────
-- Idempotent, and adapts to whatever this table actually requires.
--
-- The column list is built at run time from information_schema rather than
-- written out here, because a literal list has to be right about every NOT NULL
-- column and a plain "INSERT INTO employees" would try to write generated
-- columns such as full_name. Both of those failed on earlier attempts.
DO $$
DECLARE
  payload  jsonb;
  col_list text;
BEGIN
  IF EXISTS (SELECT 1 FROM employees WHERE id = 9843) THEN
    RAISE NOTICE 'employee 9843 already exists — nothing to do';
    RETURN;
  END IF;

  -- Every column that must be supplied, taken from the template row. Optional
  -- columns are deliberately left out, so no personal detail — email, phone,
  -- address, hire date — is copied from the template onto this record.
  SELECT jsonb_object_agg(kv.key, kv.value)
    INTO payload
    FROM (SELECT to_jsonb(e) AS data FROM employees e WHERE e.id = 2459) AS t,
         jsonb_each(t.data) AS kv
   WHERE kv.key IN (
           SELECT column_name
             FROM information_schema.columns
            WHERE table_schema  = current_schema()
              AND table_name    = 'employees'
              AND is_nullable   = 'NO'
              AND column_default IS NULL
              AND is_generated  = 'NEVER'
              AND is_identity   = 'NO'
         );

  IF payload IS NULL THEN
    RAISE EXCEPTION
      'template employee 2459 (Gina Cepeda) not found — pick another administrative civilian';
  END IF;

  -- Identity of the person being created.
  payload := payload || jsonb_build_object(
               'id',         9843,
               'first_name', 'Peggy',
               'last_name',  'Lowry');

  -- VSA-C6 only if this table has somewhere to put it. The board reads it from
  -- the roster's call sign regardless, so its absence costs nothing.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name   = 'employees'
                AND column_name  = 'badge_number') THEN
    payload := payload || jsonb_build_object('badge_number', 'VSA-C6');
  END IF;

  SELECT string_agg(quote_ident(key), ', ')
    INTO col_list
    FROM jsonb_object_keys(payload) AS key;

  EXECUTE format(
    'INSERT INTO employees (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::employees, $1)',
    col_list
  ) USING payload;

  RAISE NOTICE 'created employee 9843 (Peggy Lowry) with columns: %', col_list;
END $$;

-- ── Step 3: verify ───────────────────────────────────────────────────────────
-- Only columns guaranteed to exist are named here, so this cannot fail on a
-- table shaped differently from the one it was written against.
SELECT 'lowry' AS check, id, first_name, last_name, rank
  FROM employees
 WHERE id = 9843;

-- And the badge, separately, since that column is optional.
SELECT 'badge' AS check, to_jsonb(e) -> 'badge_number' AS badge_number
  FROM employees e
 WHERE e.id = 9843;
