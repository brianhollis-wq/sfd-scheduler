-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Employee records for people with no payroll employee ID
--
-- READ THIS BEFORE RUNNING. Unlike 001 and 003 it invents a key, so it is
-- worth a look rather than a straight paste.
--
-- daily_assignments identifies a person only by employee_id, a foreign key into
-- employees. Someone with no row there cannot be placed on the board at all —
-- there is nowhere to put a name. Two people in the personnel master have no
-- payroll ID:
--
--   Peggy Lowry      volunteer, Training Division   — on the roster (TR-SA)
--   Brian Clothier   contract Medical Director      — not on the roster
--
-- Only Lowry is handled here, because only she is rostered. Clothier needs the
-- same treatment if he is ever added.
--
-- Lowry is identified as VSA-C6. That is stored as her badge number, and shown
-- on the board as her call sign — it cannot be her employees.id, because
-- daily_assignments.employee_id is an integer foreign key into that column and
-- will not hold a string. Changing that would mean altering the key type of
-- both tables and every row already in them, which is not worth doing for one
-- volunteer.
--
-- So she also gets a synthetic numeric key, 90001. Real IDs in the master run
-- 554-7585, so the synthetic range sits clear of any current or future hire. To
-- use a different number, change it here and the employeeId in
-- lib/schedule/admin-roster.ts together.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: check the shape before inserting ─────────────────────────────────
-- Columns that have no default and cannot be null must all appear in the
-- INSERT below. If this lists any beyond the ones used, add them.
SELECT 'required columns' AS check, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'employees'
   AND is_nullable = 'NO'
   AND column_default IS NULL
 ORDER BY ordinal_position;

-- Confirm 90001 is clear and see where the real IDs end.
SELECT 'id range' AS check,
       min(id) AS lowest,
       max(id) AS highest,
       count(*) FILTER (WHERE id >= 90000) AS already_synthetic
  FROM employees;

-- An existing civilian to copy the rank value from, so this file does not have
-- to guess at an enum the way 003 originally did with apparatus status.
SELECT 'civilian sample' AS check, id, first_name, last_name, rank
  FROM employees
 WHERE rank::text ILIKE '%civilian%' OR rank::text ILIKE '%non%sworn%'
 LIMIT 3;

-- ── Step 2: create the record ────────────────────────────────────────────────
-- Idempotent. rank is copied from an existing civilian rather than written as a
-- literal; if the sample query above returned nothing, that subquery is null and
-- this insert will fail rather than write a wrong value — set it explicitly.
INSERT INTO employees (id, first_name, last_name, rank, badge_number, is_paramedic)
SELECT 90001,
       'Peggy',
       'Lowry',
       (SELECT rank FROM employees
         WHERE rank::text ILIKE '%civilian%' OR rank::text ILIKE '%non%sworn%'
         LIMIT 1),
       'VSA-C6',
       false
ON CONFLICT (id) DO NOTHING;

-- ── Step 3: verify ───────────────────────────────────────────────────────────
SELECT 'lowry' AS check, id, first_name, last_name, rank, badge_number
  FROM employees
 WHERE first_name ILIKE 'Peggy' AND last_name ILIKE 'Lowry';

-- If badge_number does not exist on your employees table, drop it from the
-- INSERT above and re-run; the board will still show VSA-C6, which comes from
-- the roster's call sign rather than from this row.
