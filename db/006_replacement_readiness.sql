-- ─────────────────────────────────────────────────────────────────────────────
-- 006 — Readiness assessment for running the schedule without the PDF
--
-- READ ONLY. One statement, one result set; nothing is created or changed.
-- Safe to run any number of times.
--
-- Written as a single UNION rather than a series of SELECTs because the
-- Supabase SQL editor shows only the last statement's output: an earlier
-- version of this file ran all thirteen checks and displayed one of them.
--
-- Every value is rendered as text so unrelated checks can share a shape. Read
-- it as: check | item | detail.
--
-- It answers what the code cannot:
--   1. Is the shift rotation one source of truth, and how far forward does it go?
--   2. Is shift_roster complete enough to seed a day without the PDF?
--   3. Do the employee records carry what the seat model needs?
--   4. Is minimum staffing set on the apparatus?
--   5. Are the overtime lists live, and who has been writing the board?
-- ─────────────────────────────────────────────────────────────────────────────

WITH min_units(id) AS (
  VALUES ('E-1'),('E-2'),('E-3'),('E-4'),('E-5'),('E-6'),('E-7'),('E-8'),
         ('E-9'),('E-10'),('E-11'),('TR-2'),('TR-4'),('BC-2'),('BC-4'),
         ('M-1'),('M-2'),('M-3'),('M-4'),('M-5'),('M-7'),('M-9'),('M-10')
),
letters(shift_letter) AS (
  SELECT DISTINCT btrim(shift_letter::text) FROM shift_roster
)

SELECT ord, "check", item, detail FROM (

  -- ── 1. Column types ────────────────────────────────────────────────────────
  -- The two rotation tables disagree on shift_letter's type: one is character,
  -- the other a shift_letter enum. Comparing them is an error rather than a
  -- mismatch, which is how the divergence went unnoticed — nothing reads both.
  SELECT 10 AS ord, 'column_types' AS "check",
         (table_name || '.' || column_name) AS item,
         data_type AS detail
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name IN ('shift_calendar','shift_rotation','shift_roster')
     AND column_name IN ('shift_date','shift_letter')

  -- ── 2. Rotation coverage ───────────────────────────────────────────────────
  UNION ALL
  SELECT 20, 'rotation_coverage', 'shift_calendar',
         COUNT(*)::text || ' rows, ' ||
         COALESCE(MIN(shift_date)::text,'—') || ' to ' || COALESCE(MAX(shift_date)::text,'—') ||
         ', ' || COUNT(DISTINCT btrim(shift_letter::text))::text || ' letters'
    FROM shift_calendar

  UNION ALL
  SELECT 21, 'rotation_coverage', 'shift_rotation',
         COUNT(*)::text || ' rows, ' ||
         COALESCE(MIN(shift_date)::text,'—') || ' to ' || COALESCE(MAX(shift_date)::text,'—') ||
         ', ' || COUNT(DISTINCT btrim(shift_letter::text))::text || ' letters'
    FROM shift_rotation

  -- How far forward the rotation is populated. A schedule cannot be generated
  -- past this date.
  UNION ALL
  SELECT 25, 'rotation_runway', 'shift_calendar',
         COALESCE(MAX(shift_date::date)::text,'—') || '  (' ||
         COALESCE((MAX(shift_date::date) - CURRENT_DATE)::text,'—') || ' days ahead)'
    FROM shift_calendar

  -- ── 3. Rotation disagreements ──────────────────────────────────────────────
  -- Expect none. Cast to text because the columns are different types, and
  -- trimmed because character is blank-padded.
  UNION ALL
  SELECT 30, 'rotation_disagreement',
         COALESCE(c.shift_date, r.shift_date)::text,
         'calendar=' || COALESCE(btrim(c.shift_letter::text),'(missing)') ||
         '  rotation=' || COALESCE(btrim(r.shift_letter::text),'(missing)')
    FROM shift_calendar c
    FULL OUTER JOIN shift_rotation r ON r.shift_date::date = c.shift_date::date
   WHERE btrim(c.shift_letter::text) IS DISTINCT FROM btrim(r.shift_letter::text)

  -- ── 4. Permanent roster ────────────────────────────────────────────────────
  -- What the schedule builder seeds a day from when no daily rows exist. If
  -- this is thin, the builder cannot stand in for the PDF.
  UNION ALL
  SELECT 40, 'roster_total', 'shift_roster', COUNT(*)::text || ' rows' FROM shift_roster

  UNION ALL
  SELECT 41, 'roster_by_shift', btrim(shift_letter::text),
         COUNT(*)::text || ' positions, ' ||
         COUNT(employee_id)::text || ' filled, ' ||
         (COUNT(*) - COUNT(employee_id))::text || ' vacant, ' ||
         COUNT(DISTINCT apparatus_id)::text || ' apparatus'
    FROM shift_roster
   GROUP BY btrim(shift_letter::text)

  -- Minimum-staffing apparatus with no roster row on a shift letter: the holes
  -- that would appear on the board on day one.
  UNION ALL
  SELECT 50, 'roster_gap', l.shift_letter || ' ' || u.id, 'no roster row'
    FROM min_units u CROSS JOIN letters l
   WHERE NOT EXISTS (
           SELECT 1 FROM shift_roster r
            WHERE r.apparatus_id = u.id
              AND btrim(r.shift_letter::text) = l.shift_letter)

  UNION ALL
  SELECT 60, 'roster_orphan_apparatus', r.apparatus_id, COUNT(*)::text || ' rows'
    FROM shift_roster r
   WHERE NOT EXISTS (SELECT 1 FROM apparatus a WHERE a.id = r.apparatus_id)
   GROUP BY r.apparatus_id

  UNION ALL
  SELECT 61, 'roster_orphan_employee', r.employee_id::text, COUNT(*)::text || ' rows'
    FROM shift_roster r
   WHERE r.employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = r.employee_id)
   GROUP BY r.employee_id

  -- Every unit carries its own crew, so nobody should hold two seats on one
  -- shift letter.
  UNION ALL
  SELECT 70, 'roster_double_booked',
         btrim(r.shift_letter::text) || ' emp ' || r.employee_id::text,
         string_agg(r.apparatus_id, ', ' ORDER BY r.apparatus_id)
    FROM shift_roster r
   WHERE r.employee_id IS NOT NULL
   GROUP BY btrim(r.shift_letter::text), r.employee_id
  HAVING COUNT(*) > 1

  -- ── 5. Employee records ────────────────────────────────────────────────────
  -- The seat model matches on rank and paramedic certification; a null in
  -- either makes that person unable to hold a seat, so the unit reads short.
  UNION ALL
  SELECT 80, 'employees_total', 'all', COUNT(*)::text FROM employees

  UNION ALL
  SELECT 81, 'employees_by_rank', COALESCE(btrim(rank::text),'(null)'),
         COUNT(*)::text || ' (' ||
         COUNT(*) FILTER (WHERE is_paramedic IS TRUE)::text || ' paramedic, ' ||
         COUNT(*) FILTER (WHERE is_paramedic IS NULL)::text || ' unknown)'
    FROM employees
   GROUP BY COALESCE(btrim(rank::text),'(null)')

  -- Which shift each member belongs to: needed to generate a day from the
  -- rotation rather than read it off the PDF.
  UNION ALL
  SELECT 85, 'employees_by_shift', COALESCE(btrim(shift_assignment::text),'(null)'), COUNT(*)::text
    FROM employees
   GROUP BY COALESCE(btrim(shift_assignment::text),'(null)')

  -- ── 6. Apparatus ───────────────────────────────────────────────────────────
  UNION ALL
  SELECT 90, 'apparatus', COALESCE(btrim(type::text),'(null)'),
         COUNT(*)::text || ' units, ' ||
         COUNT(*) FILTER (WHERE min_staffing IS NULL OR min_staffing = 0)::text ||
         ' missing min_staffing'
    FROM apparatus
   GROUP BY COALESCE(btrim(type::text),'(null)')

  -- ── 7. Overtime lists ──────────────────────────────────────────────────────
  UNION ALL
  SELECT 95, 'ot_lists', list_type || ' FY' || fiscal_year::text,
         COUNT(*)::text || ' entries, ' ||
         COUNT(*) FILTER (WHERE is_active)::text || ' active, last ' ||
         COALESCE(MAX(last_mandatory_date)::text,'never')
    FROM ot_list_positions
   GROUP BY list_type, fiscal_year

  -- ── 8. Who has been writing the board ──────────────────────────────────────
  -- published_by separates a day the PDF importer produced from one the
  -- schedule builder produced. During the parallel run this is the progress
  -- measure; today it should show no builder-written days at all.
  UNION ALL
  SELECT 99, 'assignment_source', shift_date::text || ' ' || COALESCE(published_by,'(null)'),
         COUNT(*)::text || ' rows'
    FROM daily_assignments
   GROUP BY shift_date, published_by

) t
ORDER BY ord, item;
