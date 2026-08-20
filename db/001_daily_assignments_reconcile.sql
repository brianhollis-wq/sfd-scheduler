-- ─────────────────────────────────────────────────────────────────────────────
-- 001 — Reconcile daily_assignments across both writers
--
-- Run once in the Supabase SQL editor. Every statement is idempotent, so
-- re-running it is safe.
--
-- Background: daily_assignments has two writers — the PDF importer
-- (app/import/actions.ts) and the schedule builder's publish route
-- (app/api/assignments/publish) — and they wrote disjoint column sets:
--
--   importer  → start_dt, end_dt, hours_scheduled, is_ot
--   publisher → position, sort_order, note, published_by
--
-- Both now insert through buildDailyAssignmentRow() in
-- lib/schedule/daily-assignment.ts, which always emits the full set below.
-- This migration guarantees every one of those columns exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- Columns the publish route writes but the importer previously did not.
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS position        text;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS sort_order      smallint NOT NULL DEFAULT 0;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS note            text;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS published_by    text;

-- Columns the importer writes but the publish route previously did not.
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS start_dt        timestamptz;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS end_dt          timestamptz;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS hours_scheduled numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE daily_assignments ADD COLUMN IF NOT EXISTS is_ot           boolean  NOT NULL DEFAULT false;

-- Backfill rows imported before the reconciliation so the schedule builder can
-- re-open them: it labels rows by `position` and orders them by `sort_order`.
UPDATE daily_assignments
   SET position = 'CREW'
 WHERE position IS NULL;

-- Ordering within an apparatus for rows that never had one. Existing non-zero
-- sort_order values are left alone.
WITH ordered AS (
  SELECT id,
         (row_number() OVER (
            PARTITION BY shift_date, apparatus_id
            ORDER BY id
          ) - 1) * 10 AS new_sort_order
    FROM daily_assignments
   WHERE sort_order = 0
)
UPDATE daily_assignments AS da
   SET sort_order = ordered.new_sort_order
  FROM ordered
 WHERE da.id = ordered.id
   AND ordered.new_sort_order <> 0;

-- Now that every row has a position, hold the invariant.
ALTER TABLE daily_assignments ALTER COLUMN position SET DEFAULT 'CREW';
ALTER TABLE daily_assignments ALTER COLUMN position SET NOT NULL;

-- The crew board, MOT and callback eligibility all filter by date; the schedule
-- builder additionally orders by apparatus then sort_order.
CREATE INDEX IF NOT EXISTS daily_assignments_date_idx
    ON daily_assignments (shift_date);

CREATE INDEX IF NOT EXISTS daily_assignments_date_apparatus_idx
    ON daily_assignments (shift_date, apparatus_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Reference: the assignment_type vocabulary both writers emit.
-- Kept in sync with lib/schedule/assignment-types.ts. Deliberately NOT a CHECK
-- constraint or enum — adding a leave code should not require a migration —
-- but the publish route rejects anything outside this set.
--
--   on duty : regular, callback_voluntary, callback_mandatory,
--             peak_engine, trade, light_duty
--   leave   : vacation, sick, FMLA, OFLA, PLO,
--             injury, kelly_day, WOC, AIC, BUM
--   intern  : ccc_intern
-- ─────────────────────────────────────────────────────────────────────────────
