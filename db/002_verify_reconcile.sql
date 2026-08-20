-- ─────────────────────────────────────────────────────────────────────────────
-- 002 — Verify 001 landed correctly. Read-only; safe to re-run any time.
--
-- Paste the whole file into the Supabase SQL editor. Each block is labeled and
-- returns its own result set.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Every column both writers emit must exist.
--    Expect 12 rows. A missing name means 001 did not fully apply.
SELECT 'columns' AS check, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'daily_assignments'
   AND column_name IN (
         'shift_date','apparatus_id','employee_id','position','assignment_type',
         'sort_order','note','start_dt','end_dt','hours_scheduled','is_ot','published_by')
 ORDER BY column_name;

-- 2. Backfill sanity. Expect null_position = 0.
SELECT 'backfill' AS check,
       count(*)                                        AS total_rows,
       count(*) FILTER (WHERE position IS NULL)        AS null_position,
       count(*) FILTER (WHERE position = 'CREW')       AS backfilled_position,
       count(*) FILTER (WHERE start_dt IS NULL
                          AND assignment_type NOT IN (
                                'vacation','sick','FMLA','OFLA','PLO',
                                'injury','kelly_day','WOC','AIC','BUM'))
                                                       AS on_duty_missing_times
  FROM daily_assignments;

-- 3. THE IMPORTANT ONE — assignment types outside the app's vocabulary.
--    The publish route rejects these with a 400, so any row listed here is a
--    date that will fail to republish from the schedule builder until the
--    value is corrected or the type is added to
--    lib/schedule/assignment-types.ts. Expect zero rows.
SELECT 'unknown_type' AS check,
       assignment_type,
       count(*)          AS row_count,
       min(shift_date)   AS first_seen,
       max(shift_date)   AS last_seen
  FROM daily_assignments
 WHERE assignment_type NOT IN (
         'regular','callback_voluntary','callback_mandatory','peak_engine','trade','light_duty',
         'vacation','sick','FMLA','OFLA','PLO','injury','kelly_day','WOC','AIC','BUM',
         'ccc_intern')
 GROUP BY assignment_type
 ORDER BY row_count DESC;

-- 4. Which writer produced each recent day, and whether its rows are complete.
--    Imported and published days should now look identical in shape.
SELECT 'by_writer' AS check,
       shift_date,
       coalesce(published_by, '(pre-reconcile)') AS writer,
       count(*)                                  AS rows,
       count(*) FILTER (WHERE start_dt IS NOT NULL) AS with_times,
       count(*) FILTER (WHERE position <> 'CREW')   AS with_real_position,
       count(DISTINCT sort_order)                AS distinct_sort_orders
  FROM daily_assignments
 GROUP BY shift_date, published_by
 ORDER BY shift_date DESC
 LIMIT 20;

-- 5. Light-duty members now on the board — they stay on the roster but no
--    longer count toward any staffing minimum, so this is who the change
--    moved. Expect a small number.
SELECT 'light_duty' AS check, shift_date, apparatus_id, employee_id
  FROM daily_assignments
 WHERE assignment_type = 'light_duty'
 ORDER BY shift_date DESC
 LIMIT 25;
