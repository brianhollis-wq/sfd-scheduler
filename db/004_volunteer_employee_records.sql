-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Employee record for the volunteer post
--
-- READ THIS BEFORE RUNNING. It is the only migration that creates a person, and
-- the only one that chooses a key.
--
-- daily_assignments identifies a person solely by employee_id, a foreign key
-- into employees. Someone with no row there cannot be placed on the board at
-- all — there is nowhere to put a name. Two people in the personnel master have
-- no payroll ID:
--
--   Peggy Lowry      volunteer, Training Division   — on the roster (TR-SA)
--   Brian Clothier   contract Medical Director      — not on the roster
--
-- Only Lowry is handled here, because only she is rostered.
--
-- She is identified as VSA-C6, stored as her badge number and shown on the
-- board as her call sign. That cannot be her employees.id: the column is an
-- integer and daily_assignments.employee_id is an integer foreign key into it.
-- So she also gets the numeric key 9843 for the foreign key alone. Real payroll
-- IDs currently run 554-7585, so 9843 is clear of all of them today, though it
-- is not reserved — if payroll IDs climb that far the insert below would fail
-- on a duplicate key rather than overwrite anyone.
--
-- A previous version failed with "null value in column rank violates not-null
-- constraint". It tried to copy a rank from an existing employee whose rank
-- mentioned "civilian", and no such row exists: the personnel master's Rank
-- column ("Civilian Non-Sworn") is a different vocabulary from employees.rank,
-- which uses the app's own codes. Step 1 now shows what those codes actually
-- are so the value below is chosen from real data rather than guessed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: what does this table actually require and allow? ─────────────────

-- 1a. Columns with no default that cannot be null. Every one of these must
--     appear in the INSERT. If this lists anything beyond id, first_name,
--     last_name and rank, add it before running Step 2.
SELECT 'required columns' AS check, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'employees'
   AND is_nullable = 'NO'
   AND column_default IS NULL
 ORDER BY ordinal_position;

-- 1b. THE ONE THAT MATTERS — the rank values actually in use, most common
--     first. Pick the one that fits a non-sworn staff member; it is very
--     likely 'Staff'. If rank is an enum, this shows only values in use, so
--     also run:  SELECT unnest(enum_range(NULL::<enum name>));
SELECT 'rank values' AS check, rank::text AS value, count(*) AS people
  FROM employees
 GROUP BY rank
 ORDER BY count(*) DESC;

-- 1c. Confirm 9843 is free and see where the real IDs end.
SELECT 'id range' AS check,
       min(id) AS lowest,
       max(id) AS highest,
       count(*) FILTER (WHERE id = 9843) AS id_9843_taken
  FROM employees;

-- ── Step 2: create the record ────────────────────────────────────────────────
-- Idempotent.
--
-- rank is taken from an administrative civilian already on the roster — Cepeda,
-- Cardenas, Chambers, Knowles, or one of the EMS support staff — because
-- whatever value they carry is both valid for the column and right for a
-- non-sworn staff member. If none of them are in employees the COALESCE falls
-- back to 'Staff', which is the code the crew board already renders as STAFF.
--
-- If Step 1b showed something different, replace the whole rank expression with
-- that literal.
INSERT INTO employees (id, first_name, last_name, rank, badge_number, is_paramedic)
SELECT 9843,
       'Peggy',
       'Lowry',
       COALESCE(
         (SELECT rank
            FROM employees
           WHERE id IN (2459, 6400, 1948, 6399, 7335, 7338, 7455, 6993)
             AND rank IS NOT NULL
           LIMIT 1),
         'Staff'
       ),
       'VSA-C6',
       false
ON CONFLICT (id) DO NOTHING;

-- ── Step 3: verify ───────────────────────────────────────────────────────────
SELECT 'lowry' AS check, id, first_name, last_name, rank, badge_number
  FROM employees
 WHERE id = 9843;

-- If the INSERT fails on badge_number, that column does not exist here: drop it
-- and its value from the INSERT and re-run. The board takes VSA-C6 from the
-- roster's call sign, not from this row, so nothing is lost.
