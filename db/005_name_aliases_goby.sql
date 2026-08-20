-- ─────────────────────────────────────────────────────────────────────────────
-- 005 — Aliases for members the schedule PDF names by a go-by name
--
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- The importer matches people by first and last name, with nickname expansion
-- (Mike → Michael) and the name_aliases table for anything that expansion
-- cannot reach. Three members in the personnel master carry a go-by name that
-- is not a nickname of their formal one:
--
--   Jack Westerman     the PDF writes "Wes Westerman"
--   John Beaudoin      the PDF writes "Alex Beaudoin"
--   Gerardo Oliveros   the PDF writes "JJ Oliveros"
--
-- Nickname expansion cannot help: Wes is not a short form of Jack, nor Alex of
-- John. Without an alias the lookup fails, the row is dropped, and the member
-- simply does not appear — which is what happened to Westerman on Engine 5,
-- where the PDF lists three and the board showed two.
--
-- Both spellings are registered for each, since the PDF is not consistent about
-- which it uses: Thursday's schedule wrote "Gerardo Oliveros" in full.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: check the table shape ────────────────────────────────────────────
SELECT 'columns' AS check, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name   = 'name_aliases'
 ORDER BY ordinal_position;

-- What is already registered for these three.
SELECT 'existing' AS check, a.alias, a.employee_id, e.first_name, e.last_name
  FROM name_aliases a
  LEFT JOIN employees e ON e.id = a.employee_id
 WHERE a.employee_id IN (5942, 6365, 6235)
 ORDER BY a.alias;

-- Confirm the three exist and are who this file thinks they are.
SELECT 'employees' AS check, id, first_name, last_name
  FROM employees
 WHERE id IN (5942, 6365, 6235)
 ORDER BY id;

-- ── Step 2: register the aliases ─────────────────────────────────────────────
-- Skips any employee id that is not present, so a wrong id here cannot create a
-- dangling alias.
INSERT INTO name_aliases (alias, employee_id)
SELECT v.alias, v.employee_id
  FROM (VALUES
          ('Wes Westerman',     5942),   -- Jack Westerman
          ('Jack Westerman',    5942),
          ('Alex Beaudoin',     6365),   -- John Beaudoin
          ('John Beaudoin',     6365),
          ('JJ Oliveros',       6235),   -- Gerardo Oliveros
          ('Gerardo Oliveros',  6235)
       ) AS v(alias, employee_id)
 WHERE EXISTS (SELECT 1 FROM employees e WHERE e.id = v.employee_id)
ON CONFLICT DO NOTHING;

-- ── Step 3: verify ───────────────────────────────────────────────────────────
-- Expect six rows, each resolving to the right person.
SELECT 'resolved' AS check, a.alias, e.first_name, e.last_name
  FROM name_aliases a
  JOIN employees e ON e.id = a.employee_id
 WHERE a.employee_id IN (5942, 6365, 6235)
 ORDER BY e.last_name, a.alias;
