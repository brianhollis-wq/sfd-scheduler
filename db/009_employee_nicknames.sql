-- ─────────────────────────────────────────────────────────────────────────────
-- 009 — Nicknames: keep the formal name, show the go-by
--
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- The department calls people by a go-by name that is often not their formal
-- one — Jack Westerman is Wes, John Beaudoin is Alex, Robert Schaffer is Bob.
-- The schedule, the shift list and CrewSense all print the go-by; only the
-- personnel record holds the formal name, and until now that was the only name
-- the application had, so the board showed people by names nobody uses.
--
-- Adding a column rather than editing first_name is deliberate. Payroll, the
-- personnel master and any official record need the formal name, and a member
-- who goes by a nickname for a few years and then stops should not have lost
-- their real one. lib/employees/display.ts shows the nickname when it is set
-- and the formal name otherwise.
--
-- The 13 below were derived by comparing the names CrewSense displays across a
-- full year of schedule data against the formal names in the personnel master,
-- then keeping only the pairs where the display name is a plausible go-by —
-- either a prefix of the formal name (Zach from Zachary) or a known form of it
-- (Bob from Robert). That guard matters: matching on surname alone paired
-- "Grant Schaffer" with Robert Schaffer, who is a battalion chief, while Grant
-- is his son and a CCC intern. It would have put the son's name on the father.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: the column ───────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nickname text;

COMMENT ON COLUMN employees.nickname IS
  'Go-by name. Shown in place of first_name wherever a name is displayed; '
  'null means the member uses their formal first name. Never a substitute for '
  'first_name, which stays the name of record.';

-- ── Step 2: a typo in the personnel master ───────────────────────────────────
-- The master carries "Hernandez Gutierrez, Iri". Her name is Iris, so this is
-- a correction to the formal name, not a nickname.
UPDATE employees
   SET first_name = 'Iris'
 WHERE id = 7284
   AND lower(first_name) = 'iri'
   AND lower(last_name) LIKE 'hernandez%';

-- ── Step 3: the nicknames ────────────────────────────────────────────────────
-- Each row carries the formal first name and surname it was derived from, and
-- the update applies only where the record still matches both. A reused id, or
-- a personnel change since the export, leaves the row untouched rather than
-- renaming the wrong person.
UPDATE employees e
   SET nickname = v.nickname
  FROM (VALUES
    (6365, 'Alex', 'John', 'Beaudoin'),
    (6602, 'Zach', 'Zachary', 'Gescher'),
    (5836, 'TJ', 'Thomas', 'Greenhill'),
    (5932, 'Zach', 'Zachary', 'Hanna'),
    (5333, 'Mike', 'Michael', 'Harlan'),
    (5595, 'Mike', 'Michael', 'Hasson'),
    (6848, 'Brad', 'Bradley', 'Mabie'),
    (7253, 'Lexie', 'Alexis', 'McKinley'),
    (4961, 'Bill', 'William', 'O''Connell'),
    (2844, 'Bob', 'Robert', 'Schaffer'),
    (4966, 'Joey', 'Joseph', 'Weigand'),
    (5942, 'Wes', 'Jack', 'Westerman'),
    (6238, 'Jeff', 'Jeffrey', 'Whitworth')
       ) AS v(id, nickname, expect_first, expect_last)
 WHERE e.id = v.id
   AND lower(e.first_name) = lower(v.expect_first)
   AND regexp_replace(lower(e.last_name), '[\s-]+', ' ', 'g')
     = regexp_replace(lower(v.expect_last), '[\s-]+', ' ', 'g');

-- ── Step 4: verify ───────────────────────────────────────────────────────────
SELECT ord, "check", item, detail FROM (

  SELECT 10 AS ord, 'column' AS "check", 'employees.nickname' AS item,
         COALESCE(MAX(data_type), 'MISSING') AS detail
    FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'employees'
     AND column_name = 'nickname'

  UNION ALL
  SELECT 20, 'total', 'employees with a nickname', COUNT(*)::text
    FROM employees WHERE nickname IS NOT NULL AND btrim(nickname) <> ''

  -- Every nickname now set, so the display can be eyeballed against the roster.
  UNION ALL
  SELECT 30, 'nickname', e.last_name, e.first_name || '  ->  ' || e.nickname
    FROM employees e
   WHERE e.nickname IS NOT NULL AND btrim(e.nickname) <> ''

  -- Rows the update skipped because the record no longer matches what the
  -- export said. Expect none; each one needs checking by hand.
  UNION ALL
  SELECT 40, 'not_applied', v.expect_first || ' ' || v.expect_last,
         'id ' || v.id::text || ' — record does not match, nickname not set'
    FROM (VALUES
    (6365, 'Alex', 'John', 'Beaudoin'),
    (6602, 'Zach', 'Zachary', 'Gescher'),
    (5836, 'TJ', 'Thomas', 'Greenhill'),
    (5932, 'Zach', 'Zachary', 'Hanna'),
    (5333, 'Mike', 'Michael', 'Harlan'),
    (5595, 'Mike', 'Michael', 'Hasson'),
    (6848, 'Brad', 'Bradley', 'Mabie'),
    (7253, 'Lexie', 'Alexis', 'McKinley'),
    (4961, 'Bill', 'William', 'O''Connell'),
    (2844, 'Bob', 'Robert', 'Schaffer'),
    (4966, 'Joey', 'Joseph', 'Weigand'),
    (5942, 'Wes', 'Jack', 'Westerman'),
    (6238, 'Jeff', 'Jeffrey', 'Whitworth')
         ) AS v(id, nickname, expect_first, expect_last)
   WHERE NOT EXISTS (
     SELECT 1 FROM employees e
      WHERE e.id = v.id AND e.nickname IS NOT DISTINCT FROM v.nickname)

  UNION ALL
  SELECT 50, 'iris_correction', 'employee 7284',
         COALESCE((SELECT first_name || ' ' || last_name FROM employees WHERE id = 7284),
                  'no such employee')

) t ORDER BY ord, item;
