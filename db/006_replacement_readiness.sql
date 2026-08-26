-- ─────────────────────────────────────────────────────────────────────────────
-- 006 — Readiness assessment for running the schedule without the PDF
--
-- READ ONLY. Every statement is a SELECT; nothing is created, altered or
-- deleted. Safe to run any number of times.
--
-- Run in the Supabase SQL editor and paste the output back. It answers the
-- questions the replacement plan depends on and that cannot be answered from
-- the code alone:
--
--   1. Is the shift rotation one source of truth, and how far forward does it go?
--   2. Is shift_roster complete enough to seed a day without the PDF?
--   3. Do the employee records carry what the seat model needs?
--   4. Is the apparatus table's minimum staffing set?
--   5. Are the overtime lists live?
--
-- Each block is labelled in a `check` column so the results stay readable when
-- pasted back as one run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Table shapes ──────────────────────────────────────────────────────────
-- Listed first because the queries below use only the columns the application
-- reads. Anything extra shows up here rather than being guessed at.
SELECT 'shape' AS check, table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name IN ('shift_calendar', 'shift_rotation', 'shift_roster', 'ot_list_positions')
 ORDER BY table_name, ordinal_position;

-- ── 1. Shift rotation ────────────────────────────────────────────────────────
-- Two tables answer "which shift letter works on date X": the crew board reads
-- shift_rotation, every other page reads shift_calendar. While the PDF carries
-- the truth that only risks a cosmetic mismatch. Generating the schedule makes
-- the rotation the foundation, and a foundation cannot have two answers.
SELECT 'rotation_coverage' AS check,
       'shift_calendar' AS source,
       COUNT(*)          AS rows,
       MIN(shift_date)   AS first_date,
       MAX(shift_date)   AS last_date,
       COUNT(DISTINCT shift_letter) AS distinct_letters
  FROM shift_calendar
UNION ALL
SELECT 'rotation_coverage', 'shift_rotation',
       COUNT(*), MIN(shift_date), MAX(shift_date), COUNT(DISTINCT shift_letter)
  FROM shift_rotation;

-- Dates where the two tables disagree, or where only one of them has an entry.
-- Expect zero rows. Anything here has to be resolved before the rotation can
-- drive the schedule.
--
-- shift_letter is cast to text on both sides because the two tables do not
-- even agree on its type — one is character, the other a shift_letter enum —
-- and comparing them directly is an error, not a mismatch. That divergence is
-- itself part of the answer to "is the rotation one source of truth", and the
-- column types are listed in the shape check above.
--
-- character is blank-padded, so 'A'::character(1) compared as text against an
-- unpadded value would differ on whitespace alone; btrim removes that.
SELECT 'rotation_disagreement' AS check,
       COALESCE(c.shift_date, r.shift_date) AS shift_date,
       btrim(c.shift_letter::text) AS calendar_letter,
       btrim(r.shift_letter::text) AS rotation_letter
  FROM shift_calendar c
  FULL OUTER JOIN shift_rotation r ON r.shift_date::date = c.shift_date::date
 WHERE btrim(c.shift_letter::text) IS DISTINCT FROM btrim(r.shift_letter::text)
 ORDER BY 2
 LIMIT 100;

-- How far forward the rotation is populated from today.
-- shift_date is cast explicitly: the column may be stored as date or as text,
-- and subtracting a date from text is an error rather than a wrong answer.
SELECT 'rotation_runway' AS check,
       MAX(shift_date::date)                  AS last_date,
       MAX(shift_date::date) - CURRENT_DATE   AS days_ahead
  FROM shift_calendar;

-- ── 2. Permanent roster ──────────────────────────────────────────────────────
-- shift_roster is what the schedule builder seeds a day from when no
-- daily_assignments rows exist. If it is thin, the builder cannot stand in for
-- the PDF no matter what else is built.
SELECT 'roster_by_shift' AS check,
       btrim(shift_letter::text) AS shift_letter,
       COUNT(*)                                       AS positions,
       COUNT(employee_id)                             AS filled,
       COUNT(*) - COUNT(employee_id)                  AS vacant,
       COUNT(DISTINCT apparatus_id)                   AS apparatus_covered
  FROM shift_roster
 GROUP BY btrim(shift_letter::text)
 ORDER BY btrim(shift_letter::text);

-- Minimum-staffing apparatus with no roster row on a given shift letter. These
-- are the holes that would appear on the board on day one.
WITH min_units(id) AS (
  VALUES ('E-1'),('E-2'),('E-3'),('E-4'),('E-5'),('E-6'),('E-7'),('E-8'),
         ('E-9'),('E-10'),('E-11'),('TR-2'),('TR-4'),('BC-2'),('BC-4'),
         ('M-1'),('M-2'),('M-3'),('M-4'),('M-5'),('M-7'),('M-9'),('M-10')
),
letters(shift_letter) AS (
  SELECT DISTINCT btrim(shift_letter::text) FROM shift_roster
)
SELECT 'roster_gaps' AS check, l.shift_letter, u.id AS apparatus_id
  FROM min_units u
 CROSS JOIN letters l
 WHERE NOT EXISTS (
         SELECT 1 FROM shift_roster r
          WHERE r.apparatus_id = u.id
            AND btrim(r.shift_letter::text) = l.shift_letter
       )
 ORDER BY l.shift_letter, u.id;

-- Roster rows pointing at an apparatus that does not exist.
SELECT 'roster_orphan_apparatus' AS check, r.apparatus_id, COUNT(*) AS rows
  FROM shift_roster r
 WHERE NOT EXISTS (SELECT 1 FROM apparatus a WHERE a.id = r.apparatus_id)
 GROUP BY r.apparatus_id
 ORDER BY r.apparatus_id;

-- Roster rows pointing at an employee that does not exist.
SELECT 'roster_orphan_employee' AS check, r.employee_id, COUNT(*) AS rows
  FROM shift_roster r
 WHERE r.employee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = r.employee_id)
 GROUP BY r.employee_id
 ORDER BY r.employee_id;

-- Anyone rostered to two apparatus on the same shift letter. Every unit carries
-- its own crew, so this should be empty.
SELECT 'roster_double_booked' AS check,
       btrim(r.shift_letter::text) AS shift_letter, r.employee_id, COUNT(*) AS rows,
       string_agg(r.apparatus_id, ', ' ORDER BY r.apparatus_id) AS apparatus
  FROM shift_roster r
 WHERE r.employee_id IS NOT NULL
 GROUP BY btrim(r.shift_letter::text), r.employee_id
HAVING COUNT(*) > 1
 ORDER BY 2, 3;

-- ── 3. Employee records ──────────────────────────────────────────────────────
-- The seat model matches on rank and on paramedic certification. A null in
-- either makes that person unable to hold a seat, so the unit reads short.
SELECT 'employees_total' AS check, COUNT(*) AS rows FROM employees;

SELECT 'employees_by_rank' AS check,
       COALESCE(rank::text, '(null)') AS rank,
       COUNT(*)                       AS rows,
       COUNT(*) FILTER (WHERE is_paramedic IS TRUE)  AS paramedic,
       COUNT(*) FILTER (WHERE is_paramedic IS NULL)  AS paramedic_unknown
  FROM employees
 GROUP BY rank
 ORDER BY rank;

-- Which shift each member belongs to. Needed to generate a day from the
-- rotation rather than read it off the PDF.
SELECT 'employees_by_shift' AS check,
       COALESCE(btrim(shift_assignment::text), '(null)') AS shift_assignment,
       COUNT(*) AS rows
  FROM employees
 GROUP BY COALESCE(btrim(shift_assignment::text), '(null)')
 ORDER BY 2;

-- ── 4. Apparatus ─────────────────────────────────────────────────────────────
SELECT 'apparatus' AS check,
       COALESCE(type::text, '(null)')   AS type,
       COUNT(*)                          AS rows,
       COUNT(*) FILTER (WHERE min_staffing IS NULL OR min_staffing = 0) AS missing_min_staffing
  FROM apparatus
 GROUP BY type
 ORDER BY type;

-- ── 5. Overtime lists ────────────────────────────────────────────────────────
-- The callback and mandatory-OT pages already keep these ordered. Confirms they
-- hold live data for the current fiscal year rather than a stale import.
SELECT 'ot_lists' AS check,
       list_type,
       fiscal_year,
       COUNT(*)                                    AS entries,
       COUNT(*) FILTER (WHERE is_active)           AS active,
       MAX(last_mandatory_date)                    AS most_recent_callback
  FROM ot_list_positions
 GROUP BY list_type, fiscal_year
 ORDER BY fiscal_year DESC, list_type;

-- ── 6. What the board is running on today ────────────────────────────────────
-- published_by distinguishes a day that came from the PDF importer from one the
-- schedule builder produced. During the parallel run this is how progress is
-- measured.
SELECT 'assignment_sources' AS check,
       shift_date,
       COALESCE(published_by, '(null)') AS published_by,
       COUNT(*) AS rows
  FROM daily_assignments
 GROUP BY shift_date, published_by
 ORDER BY shift_date DESC, published_by
 LIMIT 60;
